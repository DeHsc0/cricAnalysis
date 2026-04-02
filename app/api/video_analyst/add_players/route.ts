
import { z } from "zod";
import pool from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { CopyObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "@/lib/s3";

interface TokenPayload {
  username: string;
  role: "player" | "admin" | "video_analyst";
  iat: number;
}

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 ._-]/g, "")
    .trim();

  return cleaned.length > 0 ? cleaned : "untitled";
}

function buildPlayerFolderSegment(playerName: string, playerId: string): string {
  return `${sanitizePathSegment(playerName)}_${playerId}`;
}

const PlayersSchema = z.object({
  matchId: z.string().uuid("Invalid match ID"),
  playerIdsToAdd: z
    .array(z.string().uuid("Invalid player ID"))
    .default([])
    .optional(),
  playerIdsToRevoke : z
    .array(z.string().uuid("Invalid player ID"))
    .default([])
    .optional(),
  grantPlayerIds: z.array(z.string().uuid("Invalid player ID")).optional(),
  revokePlayerIds: z.array(z.string().uuid("Invalid player ID")).optional(),
}).transform((data) => {
  const addIds = [...(data.playerIdsToAdd ?? []), ...(data.grantPlayerIds ?? [])];
  const revokeIds = [...(data.playerIdsToRevoke ?? []), ...(data.revokePlayerIds ?? [])];

  return {
    matchId: data.matchId,
    playerIdsToAdd: Array.from(new Set(addIds)),
    playerIdsToRevoke: Array.from(new Set(revokeIds)),
  };
});

function extractAnalyst(req: NextRequest): TokenPayload | null {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const payload = extractAnalyst(req);

  if (!payload) {
    return NextResponse.json(
      { error: "Missing or invalid token" },
      { status: 401 }
    );
  }

  if (payload.role !== "video_analyst") {
    return NextResponse.json(
      { error: "Only video analysts can add players to a match" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PlayersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { matchId, playerIdsToAdd , playerIdsToRevoke } = parsed.data;

  if (playerIdsToAdd.length === 0 && playerIdsToRevoke.length === 0) {
    return NextResponse.json(
      { error: "Nothing to process. Provide player IDs to add and/or revoke." },
      { status: 422 }
    );
  }

  try {
    // ── Query 1: resolve analyst + match + tournament + ownership in one shot ──
    // Joins users → video_analysts to get the analyst's ID, then joins matches
    // and tournaments so we can do the ownership check without a second query.
    const ctxRes = await pool.query(
      `SELECT
         va.user_id           AS analyst_id,
         t.analyst_id         AS tournament_analyst_id,
         t.gender             AS tournament_gender,
         t.name               AS tournament_name,
         t.category           AS tournament_category,
         m.name               AS match_name 
       FROM users u
       JOIN video_analysts va  ON va.user_id    = u.id
       JOIN matches m          ON m.id          = $2
       JOIN tournaments t      ON t.id          = m.tournament_id
       WHERE u.username = $1`,
      [payload.username, matchId]
    );

    console.log("ctxRes" , ctxRes.rows , "-----------------------------------------------------------------------------------------")

    // If the analyst account doesn't exist the join returns 0 rows.
    if (ctxRes.rowCount === 0) {
      // Distinguish "match not found" from "analyst not found" with a cheap
      // targeted query only on the failure path (not the hot path).
      const matchExists = await pool.query(
        `SELECT 1 FROM matches WHERE id = $1`,
        [matchId]
      );
      if (matchExists.rowCount === 0) {
        return NextResponse.json({ error: "Match not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Analyst account not found" },
        { status: 403 }
      );
    }

    const {
      analyst_id,
      tournament_analyst_id,
      tournament_gender,
      tournament_category,
    } = ctxRes.rows[0];

    if (tournament_analyst_id !== analyst_id) {
      return NextResponse.json(
        { error: "You are not authorised to modify this match" },
        { status: 403 }
      );
    }

    const matchDetails = {
      matchName : ctxRes.rows[0].match_name,
      tournamentName : ctxRes.rows[0].tournament_name,
    };
    const tournamentFolder = sanitizePathSegment(matchDetails.tournamentName);
    const matchFolder = sanitizePathSegment(matchDetails.matchName);

    const bucketName = process.env.AWS_BUCKET_NAME || "cricket8759";

    let newPlayerIds: string[] = [];
    let copiedVideos = 0;
    const copyFailedTargets: string[] = [];
    const invalidPlayers: Array<{ user_id: string; gender: string; category: string }> = [];
    const alreadyAdded = new Set<string>();
    const missingAddIds: string[] = [];

    if (playerIdsToAdd.length > 0) {
      const playersRes = await pool.query(
        `SELECT
           p.user_id, 
           u.name               AS player_name,
           p.gender,
           p.category,
           (mp.player_id IS NOT NULL) AS already_in_match
         FROM players p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN match_players mp
           ON mp.match_id = $1 AND mp.player_id = p.user_id
         WHERE p.user_id = ANY($2::uuid[])`,
        [matchId, playerIdsToAdd]
      );

      const foundIds = new Set(playersRes.rows.map((r) => r.user_id));
      for (const id of playerIdsToAdd) {
        if (!foundIds.has(id)) missingAddIds.push(id);
      }

      for (const p of playersRes.rows) {
        if (p.gender !== tournament_gender || p.category !== tournament_category) {
          invalidPlayers.push({ user_id: p.user_id, gender: p.gender, category: p.category });
          continue;
        }

        if (p.already_in_match) {
          alreadyAdded.add(p.user_id);
          continue;
        }

        newPlayerIds.push(p.user_id);
      }

      if (newPlayerIds.length > 0) {
        const newPlayerIdSet = new Set(newPlayerIds);
        const newPlayers = playersRes.rows
          .filter((p) => newPlayerIdSet.has(p.user_id))
          .map((p) => ({ id: String(p.user_id), name: String(p.player_name) }));

        const values = newPlayerIds.map((_, i) => `($1, $${i + 2})`).join(", ");
        await pool.query(
          `INSERT INTO match_players (match_id, player_id) VALUES ${values} RETURNING *`,
          [matchId, ...newPlayerIds]
        );

        for (const player of newPlayers) {
          const key = `${buildPlayerFolderSegment(player.name, player.id)}/${tournamentFolder}/${matchFolder}/`;

          await s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME || "cricket8759",
            Key: key,
            Body: "",
          }));
        }

        // Copy existing match videos into each newly added player's folder.
        const existingVideosRes = await pool.query(
          `SELECT file_name, s3_key
           FROM videos
           WHERE match_id = $1
           ORDER BY created_at ASC`,
          [matchId],
        );

        if ((existingVideosRes.rowCount ?? 0) > 0) {
          const sourceCandidatesByFileName = new Map<string, string[]>();

          for (const row of existingVideosRes.rows) {
            const fileName = String(row.file_name ?? "");
            const s3Key = String(row.s3_key ?? "");

            if (!fileName || !s3Key) continue;

            const existing = sourceCandidatesByFileName.get(fileName) ?? [];
            if (!existing.includes(s3Key)) {
              existing.push(s3Key);
              sourceCandidatesByFileName.set(fileName, existing);
            }
          }

          for (const player of newPlayers) {
            for (const [fileName, sourceCandidates] of sourceCandidatesByFileName.entries()) {
              let copied = false;

              for (const sourceKey of sourceCandidates) {
                const sourceFileName = sourceKey.split("/").pop() || fileName;
                const destinationKey = `${buildPlayerFolderSegment(player.name, player.id)}/${tournamentFolder}/${matchFolder}/${sourceFileName}`;

                if (destinationKey === sourceKey) {
                  copied = true;
                  break;
                }

                try {
                  const encodedSourceKey = encodeURIComponent(sourceKey).replace(/%2F/g, "/");

                  await s3Client.send(new CopyObjectCommand({
                    Bucket: bucketName,
                    CopySource: `${bucketName}/${encodedSourceKey}`,
                    Key: destinationKey,
                  }));

                  copiedVideos += 1;
                  copied = true;
                  break;
                } catch {
                  // Try next source candidate for the same logical file.
                }
              }

              if (!copied) {
                copyFailedTargets.push(`${buildPlayerFolderSegment(player.name, player.id)}/${tournamentFolder}/${matchFolder}/${fileName}`);
              }
            }
          }
        }
      }
    }

    let revokedPlayerIds: string[] = [];
    const revokeMissingFromMatch: string[] = [];

    if (playerIdsToRevoke.length > 0) {
      const revokeCandidatesRes = await pool.query(
        `SELECT
           mp.player_id,
           u.name AS player_name
         FROM match_players mp
         JOIN users u ON u.id = mp.player_id
         WHERE mp.match_id = $1 AND mp.player_id = ANY($2::uuid[])`,
        [matchId, playerIdsToRevoke]
      );

      const revokeFoundSet = new Set(revokeCandidatesRes.rows.map((r) => r.player_id));

      for (const id of playerIdsToRevoke) {
        if (!revokeFoundSet.has(id)) {
          revokeMissingFromMatch.push(id);
        }
      }

      revokedPlayerIds = Array.from(revokeFoundSet);

      if (revokedPlayerIds.length > 0) {
        await pool.query(
          `DELETE FROM match_players
           WHERE match_id = $1 AND player_id = ANY($2::uuid[])`,
          [matchId, revokedPlayerIds]
        );

        // Delete only match-level content for revoked players.
        // Never delete tournament-level folders to avoid removing other match content.
        for (const row of revokeCandidatesRes.rows) {
          const prefix = `${buildPlayerFolderSegment(String(row.player_name), String(row.player_id))}/${tournamentFolder}/${matchFolder}/`;
          let continuationToken: string | undefined = undefined;

          do {
            const listed = (await s3Client.send(new ListObjectsV2Command({
              Bucket: bucketName,
              Prefix: prefix,
              ContinuationToken: continuationToken,
            }))) as {
              Contents?: Array<{ Key?: string }>;
              IsTruncated?: boolean;
              NextContinuationToken?: string;
            };

            const objects: Array<{ Key: string }> = [];
            for (const item of listed.Contents ?? []) {
              if (item.Key) {
                objects.push({ Key: item.Key });
              }
            }

            if (objects.length > 0) {
              await s3Client.send(new DeleteObjectsCommand({
                Bucket: bucketName,
                Delete: { Objects: objects },
              }));
            }

            continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
          } while (continuationToken);
        }
      }
    }

    const responseBody: Record<string, unknown> = {
      added: newPlayerIds.length,
      alreadyInMatch: alreadyAdded.size,
      revoked: revokedPlayerIds.length,
      addNotFound: missingAddIds,
      revokeNotInMatch: revokeMissingFromMatch,
      grantIds: newPlayerIds,
      revokeIds: revokedPlayerIds,
      copiedVideos,
      copyFailedTargets,
    };

    if (invalidPlayers.length > 0) {
      responseBody.rejected = {
        reason: "gender/category mismatch with tournament",
        expectedGender: tournament_gender,
        expectedCategory: tournament_category,
        players: invalidPlayers.map((p) => ({
          id: p.user_id,
          gender: p.gender,
          category: p.category,
        })),
      };
    }

    if (
      newPlayerIds.length === 0 &&
      revokedPlayerIds.length === 0 &&
      alreadyAdded.size === 0 &&
      missingAddIds.length === 0 &&
      revokeMissingFromMatch.length === 0
    ) {
      return NextResponse.json(
        { error: "No changes were applied", ...responseBody },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { message: "Players processed", ...responseBody },
      { status: 200 }
    );
  } catch (err) {
    console.error("Add players error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}