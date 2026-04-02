import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import pool from "@/lib/db";
import s3Client from "@/lib/s3";

interface TokenPayload {
  id?: string;
  username: string;
  role: "player" | "admin" | "video_analyst";
  iat: number;
}

const deleteMatchSchema = z.object({
  matchId: z.string().uuid("Invalid match ID"),
});

function extractAnalyst(req: NextRequest): TokenPayload | null {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;

  try {
    return jwt.verify(token, process.env.JWT_SECRET || "") as TokenPayload;
  } catch {
    return null;
  }
}

async function resolveAnalystId(payload: TokenPayload): Promise<string | null> {
  if (payload.id) return payload.id;

  const userRes = await pool.query(
    "SELECT id FROM users WHERE username = $1 LIMIT 1",
    [payload.username],
  );

  return userRes.rows[0]?.id ?? null;
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

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

async function deleteKeys(bucket: string, keys: string[]) {
  let deletedObjects = 0;
  let failedObjects = 0;

  for (const keyBatch of chunkArray(keys, 1000)) {
    const response = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keyBatch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );

    deletedObjects += response.Deleted?.length ?? 0;
    failedObjects += response.Errors?.length ?? 0;
  }

  return { deletedObjects, failedObjects };
}

async function deletePrefix(bucket: string, prefix: string) {
  let continuationToken: string | undefined = undefined;
  let deletedObjects = 0;
  let failedObjects = 0;

  do {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (listed.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);

    if (keys.length > 0) {
      const deletionResult = await deleteKeys(bucket, keys);
      deletedObjects += deletionResult.deletedObjects;
      failedObjects += deletionResult.failedObjects;
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return { deletedObjects, failedObjects };
}

async function handleDeleteMatch(req: NextRequest) {
  const payload = extractAnalyst(req);

  if (!payload) {
    return NextResponse.json(
      { success: false, message: "Missing or invalid token" },
      { status: 401 },
    );
  }

  if (payload.role !== "video_analyst") {
    return NextResponse.json(
      { success: false, message: "Only video analysts can delete matches" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = deleteMatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Validation failed",
        error: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  const { matchId } = parsed.data;

  try {
    const analystId = await resolveAnalystId(payload);

    if (!analystId) {
      return NextResponse.json(
        { success: false, message: "Analyst not found" },
        { status: 404 },
      );
    }

    const matchContextRes = await pool.query(
      `SELECT
         m.id AS match_id,
         m.name AS match_name,
         m.tournament_id,
         t.name AS tournament_name,
         t.analyst_id
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE m.id = $1`,
      [matchId],
    );

    if (matchContextRes.rowCount === 0) {
      return NextResponse.json(
        { success: false, message: "Match not found" },
        { status: 404 },
      );
    }

    const matchContext = matchContextRes.rows[0] as {
      match_id: string;
      match_name: string;
      tournament_id: string;
      tournament_name: string;
      analyst_id: string;
    };

    if (String(matchContext.analyst_id) !== analystId) {
      return NextResponse.json(
        { success: false, message: "You are not authorised to delete this match" },
        { status: 403 },
      );
    }

    const playersInMatchRes = await pool.query(
      `SELECT
         mp.player_id,
         u.name AS player_name
       FROM match_players mp
       JOIN users u ON u.id = mp.player_id
       WHERE mp.match_id = $1`,
      [matchId],
    );

    const playersInMatch = playersInMatchRes.rows as Array<{
      player_id: string;
      player_name: string;
    }>;

    const playerIds = playersInMatch.map((player) => String(player.player_id));

    const playersWithOtherMatchesSet = new Set<string>();
    if (playerIds.length > 0) {
      const playersWithOtherMatchesRes = await pool.query(
        `SELECT DISTINCT mp.player_id
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
         WHERE m.tournament_id = $1
           AND mp.match_id <> $2
           AND mp.player_id = ANY($3::uuid[])`,
        [matchContext.tournament_id, matchId, playerIds],
      );

      for (const row of playersWithOtherMatchesRes.rows) {
        playersWithOtherMatchesSet.add(String(row.player_id));
      }
    }

    const videoKeysRes = await pool.query(
      `SELECT s3_key
       FROM videos
       WHERE match_id = $1`,
      [matchId],
    );

    const videoKeys = videoKeysRes.rows
      .map((row) => String(row.s3_key ?? ""))
      .filter((key) => key.length > 0);

    const deleteMatchRes = await pool.query(
      `DELETE FROM matches
       WHERE id = $1`,
      [matchId],
    );

    if ((deleteMatchRes.rowCount ?? 0) === 0) {
      return NextResponse.json(
        { success: false, message: "Match not found" },
        { status: 404 },
      );
    }

    const bucket =
      process.env.AWS_BUCKET_NAME ||
      process.env.AWS_S3_BUCKET_NAME ||
      process.env.S3_BUCKET_NAME;

    if (!bucket) {
      return NextResponse.json(
        {
          success: true,
          message: "Match deleted. S3 cleanup skipped because bucket is not configured.",
          deletedMatchId: matchId,
          warning:
            "Deleting a match removes all CDN videos for that match. If this was a player's only match in the tournament, the tournament folder should also be removed.",
          cdnCleanup: {
            deletedObjects: 0,
            failedObjects: 0,
            failedTargets: ["S3 bucket is not configured"],
          },
        },
        { status: 200 },
      );
    }

    const tournamentFolder = sanitizePathSegment(matchContext.tournament_name);
    const matchFolder = sanitizePathSegment(matchContext.match_name);

    let deletedObjects = 0;
    let failedObjects = 0;
    const failedTargets: string[] = [];

    if (videoKeys.length > 0) {
      const directDelete = await deleteKeys(bucket, videoKeys);
      deletedObjects += directDelete.deletedObjects;
      failedObjects += directDelete.failedObjects;

      if (directDelete.failedObjects > 0) {
        failedTargets.push("videos-table-s3-keys");
      }
    }

    for (const player of playersInMatch) {
      const playerFolder = buildPlayerFolderSegment(
        String(player.player_name),
        String(player.player_id),
      );

      const matchPrefix = `${playerFolder}/${tournamentFolder}/${matchFolder}/`;
      const matchCleanup = await deletePrefix(bucket, matchPrefix);

      deletedObjects += matchCleanup.deletedObjects;
      failedObjects += matchCleanup.failedObjects;

      if (matchCleanup.failedObjects > 0) {
        failedTargets.push(matchPrefix);
      }
    }

    for (const player of playersInMatch) {
      const playerId = String(player.player_id);
      if (playersWithOtherMatchesSet.has(playerId)) continue;

      const playerFolder = buildPlayerFolderSegment(
        String(player.player_name),
        playerId,
      );

      const tournamentPrefix = `${playerFolder}/${tournamentFolder}/`;
      const tournamentCleanup = await deletePrefix(bucket, tournamentPrefix);

      deletedObjects += tournamentCleanup.deletedObjects;
      failedObjects += tournamentCleanup.failedObjects;

      if (tournamentCleanup.failedObjects > 0) {
        failedTargets.push(tournamentPrefix);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message:
          failedObjects > 0
            ? "Match deleted, but some CDN objects could not be removed"
            : "Match deleted successfully",
        deletedMatchId: matchId,
        warning:
          "Deleting a match removes all CDN videos for that match. If this was a player's only match in the tournament, that player's tournament folder is also removed from CDN.",
        cdnCleanup: {
          deletedObjects,
          failedObjects,
          failedTargets,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return handleDeleteMatch(req);
}

export async function DELETE(req: NextRequest) {
  return handleDeleteMatch(req);
}
