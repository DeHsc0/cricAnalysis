import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
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

const deleteTournamentSchema = z.object({
  tournamentId: z.string().uuid("Invalid tournament ID"),
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
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (listed.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key));

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

async function handleDeleteTournament(req: NextRequest) {
  const payload = extractAnalyst(req);

  if (!payload) {
    return NextResponse.json(
      { success: false, message: "Missing or invalid token" },
      { status: 401 },
    );
  }

  if (payload.role !== "video_analyst") {
    return NextResponse.json(
      { success: false, message: "Only video analysts can delete tournaments" },
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

  const parsed = deleteTournamentSchema.safeParse(body);
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

  const { tournamentId } = parsed.data;

  try {
    const analystId = await resolveAnalystId(payload);

    if (!analystId) {
      return NextResponse.json(
        { success: false, message: "Analyst not found" },
        { status: 404 },
      );
    }

    const tournamentRes = await pool.query(
      `SELECT id, name, analyst_id
       FROM tournaments
       WHERE id = $1`,
      [tournamentId],
    );

    if (tournamentRes.rowCount === 0) {
      return NextResponse.json(
        { success: false, message: "Tournament not found" },
        { status: 404 },
      );
    }

    const tournament = tournamentRes.rows[0] as {
      id: string;
      name: string;
      analyst_id: string;
    };

    if (String(tournament.analyst_id) !== analystId) {
      return NextResponse.json(
        { success: false, message: "You are not authorised to delete this tournament" },
        { status: 403 },
      );
    }

    const playersInTournamentRes = await pool.query(
      `SELECT DISTINCT
         mp.player_id,
         u.name AS player_name
       FROM matches m
       JOIN match_players mp ON mp.match_id = m.id
       JOIN users u ON u.id = mp.player_id
       WHERE m.tournament_id = $1`,
      [tournamentId],
    );

    const playersInTournament = playersInTournamentRes.rows as Array<{
      player_id: string;
      player_name: string;
    }>;

    const videoKeysRes = await pool.query(
      `SELECT s3_key
       FROM videos
       WHERE tournament_id = $1`,
      [tournamentId],
    );

    const videoKeys = videoKeysRes.rows
      .map((row) => String(row.s3_key ?? ""))
      .filter((key) => key.length > 0);

    const deleteTournamentRes = await pool.query(
      `DELETE FROM tournaments
       WHERE id = $1`,
      [tournamentId],
    );

    if ((deleteTournamentRes.rowCount ?? 0) === 0) {
      return NextResponse.json(
        { success: false, message: "Tournament not found" },
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
          message: "Tournament deleted. S3 cleanup skipped because bucket is not configured.",
          deletedTournamentId: tournamentId,
          warning:
            "Deleting a tournament removes all its matches and videos from CDN. Tournament folders for players in that tournament should also be removed.",
          cdnCleanup: {
            deletedObjects: 0,
            failedObjects: 0,
            failedTargets: ["S3 bucket is not configured"],
          },
        },
        { status: 200 },
      );
    }

    const tournamentFolder = sanitizePathSegment(tournament.name);

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

    for (const player of playersInTournament) {
      const playerFolder = buildPlayerFolderSegment(
        String(player.player_name),
        String(player.player_id),
      );

      const tournamentPrefix = `${playerFolder}/${tournamentFolder}/`;
      const cleanupResult = await deletePrefix(bucket, tournamentPrefix);

      deletedObjects += cleanupResult.deletedObjects;
      failedObjects += cleanupResult.failedObjects;

      if (cleanupResult.failedObjects > 0) {
        failedTargets.push(tournamentPrefix);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message:
          failedObjects > 0
            ? "Tournament deleted, but some CDN objects could not be removed"
            : "Tournament deleted successfully",
        deletedTournamentId: tournamentId,
        warning:
          "Deleting a tournament removes all matches and videos under that tournament from CDN for the players who were part of matches in this tournament.",
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
  return handleDeleteTournament(req);
}

export async function DELETE(req: NextRequest) {
  return handleDeleteTournament(req);
}
