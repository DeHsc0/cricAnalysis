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
import type { TokenPayload } from "@/types/auth";

const deleteUserSchema = z.object({
  userId: z.string().uuid("Invalid userId"),
});

type TargetUserRole = "player" | "video_analyst" | "admin";

type TargetUser = {
  id: string;
  name: string;
  role: TargetUserRole;
  created_by: string | null;
};

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 ._-]/g, "")
    .trim();

  return cleaned.length > 0 ? cleaned : "untitled";
}

function buildPlayerFolderName(playerName: string, playerId: string): string {
  return `${sanitizePathSegment(playerName)}_${playerId}`;
}

function getTokenPayload(req: NextRequest): TokenPayload | null {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");

    if (typeof verified === "string") {
      return JSON.parse(verified) as TokenPayload;
    }

    return verified as TokenPayload;
  } catch {
    return null;
  }
}

async function resolveRequesterId(payload: TokenPayload): Promise<string | null> {
  if (payload.id) return payload.id;

  const userRes = await pool.query(
    "SELECT id FROM users WHERE username = $1 LIMIT 1",
    [payload.username],
  );

  return userRes.rows[0]?.id ?? null;
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

async function cleanupPlayerCdn(
  bucket: string | undefined,
  playerName: string,
  playerId: string,
  videoKeys: string[],
) {
  if (!bucket) {
    return {
      deletedObjects: 0,
      failedObjects: 0,
      failedTargets: ["S3 bucket is not configured"],
    };
  }

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

  const playerPrefix = `${buildPlayerFolderName(playerName, playerId)}/`;
  const folderCleanup = await deletePrefix(bucket, playerPrefix);

  deletedObjects += folderCleanup.deletedObjects;
  failedObjects += folderCleanup.failedObjects;

  if (folderCleanup.failedObjects > 0) {
    failedTargets.push(playerPrefix);
  }

  return { deletedObjects, failedObjects, failedTargets };
}

async function cleanupAnalystCdn(
  bucket: string | undefined,
  videoKeys: string[],
  tournamentFolderPrefixes: string[],
) {
  if (!bucket) {
    return {
      deletedObjects: 0,
      failedObjects: 0,
      failedTargets: ["S3 bucket is not configured"],
    };
  }

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

  for (const prefix of tournamentFolderPrefixes) {
    const cleanupResult = await deletePrefix(bucket, prefix);
    deletedObjects += cleanupResult.deletedObjects;
    failedObjects += cleanupResult.failedObjects;

    if (cleanupResult.failedObjects > 0) {
      failedTargets.push(prefix);
    }
  }

  return { deletedObjects, failedObjects, failedTargets };
}

export async function POST(req: NextRequest) {
  const tokenPayload = getTokenPayload(req);

  if (!tokenPayload) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing or invalid token",
      },
      { status: 401 },
    );
  }

  if (tokenPayload.role !== "admin") {
    return NextResponse.json(
      {
        success: false,
        message: "Only admins can delete users",
      },
      { status: 403 },
    );
  }

  const adminId = await resolveRequesterId(tokenPayload);

  if (!adminId) {
    return NextResponse.json(
      {
        success: false,
        message: "Admin account not found",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid JSON body",
      },
      { status: 400 },
    );
  }

  const parsed = deleteUserSchema.safeParse(body);

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

  const { userId } = parsed.data;

  if (userId === adminId) {
    return NextResponse.json(
      {
        success: false,
        message: "Admin cannot delete own account from this route",
      },
      { status: 403 },
    );
  }

  try {
    const targetRes = await pool.query(
      `SELECT id, name, role, created_by
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId],
    );

    if ((targetRes.rowCount ?? 0) === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "User not found",
        },
        { status: 404 },
      );
    }

    const target = targetRes.rows[0] as TargetUser;

    if (target.role === "admin") {
      return NextResponse.json(
        {
          success: false,
          message: "Deleting admins is not allowed",
        },
        { status: 400 },
      );
    }

    if (target.created_by !== adminId) {
      return NextResponse.json(
        {
          success: false,
          message: "You can only delete users created by your account",
        },
        { status: 403 },
      );
    }

    const bucket =
      process.env.AWS_BUCKET_NAME ||
      process.env.AWS_S3_BUCKET_NAME ||
      process.env.S3_BUCKET_NAME;

    if (target.role === "player") {
      const playerVideoKeysRes = await pool.query(
        `SELECT s3_key
         FROM videos
         WHERE player_id = $1`,
        [target.id],
      );

      const playerVideoKeys = playerVideoKeysRes.rows
        .map((row) => String(row.s3_key ?? ""))
        .filter((key) => key.length > 0);

      await pool.query("BEGIN");

      try {
        const deletePlayerRes = await pool.query(
          `DELETE FROM users
           WHERE id = $1 AND role = 'player' AND created_by = $2`,
          [target.id, adminId],
        );

        if ((deletePlayerRes.rowCount ?? 0) === 0) {
          await pool.query("ROLLBACK");
          return NextResponse.json(
            {
              success: false,
              message: "Player not found or not deletable",
            },
            { status: 404 },
          );
        }

        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }

      const cdnCleanup = await cleanupPlayerCdn(
        bucket,
        target.name,
        target.id,
        playerVideoKeys,
      );

      return NextResponse.json(
        {
          success: true,
          message:
            cdnCleanup.failedObjects > 0
              ? "Player deleted, but some CDN objects could not be removed"
              : "Player deleted successfully",
          deletedUser: {
            id: target.id,
            name: target.name,
            role: target.role,
          },
          dbCleanup: {
            deletedRoleRows: ["users", "players", "match_players", "videos"],
          },
          cdnCleanup,
        },
        { status: 200 },
      );
    }

    const tournamentsRes = await pool.query(
      `SELECT id, name
       FROM tournaments
       WHERE analyst_id = $1`,
      [target.id],
    );

    const tournaments = tournamentsRes.rows as Array<{ id: string; name: string }>;
    const tournamentIds = tournaments.map((tournament) => String(tournament.id));

    const matchesCountRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM matches m
       JOIN tournaments t ON t.id = m.tournament_id
       WHERE t.analyst_id = $1`,
      [target.id],
    );

    const matchesCount = Number(matchesCountRes.rows[0]?.total ?? 0);

    const tournamentFolderPrefixesSet = new Set<string>();

    if (tournamentIds.length > 0) {
      const tournamentPlayerRes = await pool.query(
        `SELECT DISTINCT
           mp.player_id,
           u.name AS player_name,
           t.name AS tournament_name
         FROM tournaments t
         JOIN matches m ON m.tournament_id = t.id
         JOIN match_players mp ON mp.match_id = m.id
         JOIN users u ON u.id = mp.player_id
         WHERE t.id = ANY($1::uuid[])`,
        [tournamentIds],
      );

      for (const row of tournamentPlayerRes.rows) {
        const playerFolder = buildPlayerFolderName(
          String(row.player_name),
          String(row.player_id),
        );

        const tournamentFolder = sanitizePathSegment(String(row.tournament_name));
        tournamentFolderPrefixesSet.add(`${playerFolder}/${tournamentFolder}/`);
      }
    }

    let videoKeysRes;

    if (tournamentIds.length > 0) {
      videoKeysRes = await pool.query(
        `SELECT DISTINCT s3_key
         FROM videos
         WHERE uploaded_by = $1
            OR tournament_id = ANY($2::uuid[])`,
        [target.id, tournamentIds],
      );
    } else {
      videoKeysRes = await pool.query(
        `SELECT DISTINCT s3_key
         FROM videos
         WHERE uploaded_by = $1`,
        [target.id],
      );
    }

    const analystVideoKeys = videoKeysRes.rows
      .map((row) => String(row.s3_key ?? ""))
      .filter((key) => key.length > 0);

    await pool.query("BEGIN");

    let deletedTournaments = 0;

    try {
      await pool.query(
        `DELETE FROM videos
         WHERE uploaded_by = $1`,
        [target.id],
      );

      const deleteTournamentRes = await pool.query(
        `DELETE FROM tournaments
         WHERE analyst_id = $1`,
        [target.id],
      );

      deletedTournaments = deleteTournamentRes.rowCount ?? 0;

      const deleteAnalystRes = await pool.query(
        `DELETE FROM users
         WHERE id = $1 AND role = 'video_analyst' AND created_by = $2`,
        [target.id, adminId],
      );

      if ((deleteAnalystRes.rowCount ?? 0) === 0) {
        await pool.query("ROLLBACK");
        return NextResponse.json(
          {
            success: false,
            message: "Video analyst not found or not deletable",
          },
          { status: 404 },
        );
      }

      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }

    const cdnCleanup = await cleanupAnalystCdn(
      bucket,
      analystVideoKeys,
      Array.from(tournamentFolderPrefixesSet),
    );

    return NextResponse.json(
      {
        success: true,
        message:
          cdnCleanup.failedObjects > 0
            ? "Video analyst deleted, but some CDN objects could not be removed"
            : "Video analyst deleted successfully",
        deletedUser: {
          id: target.id,
          name: target.name,
          role: target.role,
        },
        dbCleanup: {
          deletedTournaments,
          deletedMatches: matchesCount,
          deletedRoleRows: ["users", "video_analysts", "tournaments", "matches", "match_players", "videos"],
        },
        cdnCleanup,
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

export async function DELETE(req: NextRequest) {
  return POST(req);
}
