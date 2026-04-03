import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import pool from "@/lib/db";
import s3Client from "@/lib/s3";
import type { TokenPayload } from "@/types/auth";

const MEN_CATEGORIES = new Set(["under_14", "under_16", "under_19", "under_23", "ranji"]);
const WOMEN_CATEGORIES = new Set(["under_16", "under_19", "under_23", "senior"]);

const editUserSchema = z
  .object({
    userId: z.string().uuid("Invalid userId"),
    username: z
      .string()
      .trim()
      .min(4, "Username must be at least 4 characters")
      .max(50, "Username must be at most 50 characters")
      .optional(),
    password: z.string().min(1, "Password is required").optional(),
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(100, "Name must be at most 100 characters")
      .optional(),
    role: z.enum(["player", "video_analyst"]).optional(),
    gender: z.enum(["men", "women"]).optional(),
    category: z
      .string()
      .trim()
      .min(1, "Category is required")
      .max(20, "Category must be at most 20 characters")
      .optional(),
  })
  .superRefine((data, ctx) => {
    const hasEditableField =
      data.username !== undefined ||
      data.password !== undefined ||
      data.name !== undefined ||
      data.role !== undefined ||
      data.gender !== undefined ||
      data.category !== undefined;

    if (!hasEditableField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Provide at least one field to update",
      });
    }
  });

type EditableRole = "player" | "video_analyst";

type TargetUser = {
  id: string;
  username: string;
  name: string;
  role: "player" | "video_analyst" | "admin";
  created_by: string | null;
  player_gender: "men" | "women" | null;
  player_category: string | null;
  analyst_gender: "men" | "women" | null;
  analyst_category: string | null;
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

function isCategoryAllowed(gender: "men" | "women", category: string): boolean {
  if (gender === "men") {
    return MEN_CATEGORIES.has(category);
  }

  return WOMEN_CATEGORIES.has(category);
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

function buildCopySource(bucket: string, key: string): string {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${bucket}/${encodedKey}`;
}

async function copyPrefix(
  bucket: string,
  sourcePrefix: string,
  destinationPrefix: string,
) {
  if (sourcePrefix === destinationPrefix) {
    return { copiedObjects: 0 };
  }

  let continuationToken: string | undefined = undefined;
  let copiedObjects = 0;

  do {
    const listed: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: sourcePrefix,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (listed.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);

    for (const sourceKey of keys) {
      if (!sourceKey.startsWith(sourcePrefix)) continue;

      const suffix = sourceKey.slice(sourcePrefix.length);
      const destinationKey = `${destinationPrefix}${suffix}`;

      await s3Client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: buildCopySource(bucket, sourceKey),
          Key: destinationKey,
        }),
      );

      copiedObjects += 1;
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return { copiedObjects };
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

async function handleEditUser(req: NextRequest) {
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
        message: "Only admins can edit users",
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

  const parsed = editUserSchema.safeParse(body);

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

  const {
    userId,
    username,
    password,
    name,
    role,
    gender,
    category,
  } = parsed.data;

  try {
    const targetRes = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.name,
         u.role,
         u.created_by,
         p.gender AS player_gender,
         p.category AS player_category,
         va.gender AS analyst_gender,
         va.category AS analyst_category
       FROM users u
       LEFT JOIN players p ON p.user_id = u.id
       LEFT JOIN video_analysts va ON va.user_id = u.id
       WHERE u.id = $1
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
          message: "Editing admins is not allowed from this route",
        },
        { status: 400 },
      );
    }

    if (target.created_by !== adminId) {
      return NextResponse.json(
        {
          success: false,
          message: "You can only edit users created by your account",
        },
        { status: 403 },
      );
    }

    const currentRole = target.role as EditableRole;
    const currentGender =
      currentRole === "player"
        ? target.player_gender
        : target.analyst_gender;
    const currentCategory =
      currentRole === "player"
        ? target.player_category
        : target.analyst_category;

    if (!currentGender || !currentCategory) {
      return NextResponse.json(
        {
          success: false,
          message: "Role profile not found for this user",
        },
        { status: 404 },
      );
    }

    const effectiveRole = (role ?? currentRole) as EditableRole;
    const effectiveGender = (gender ?? currentGender) as "men" | "women";
    const effectiveCategory = category ?? currentCategory;
    const effectiveName = name ?? target.name;

    const shouldRenamePlayerFolder =
      currentRole === "player" &&
      effectiveRole === "player" &&
      effectiveName !== target.name;

    const oldPlayerPrefix = `${buildPlayerFolderName(target.name, target.id)}/`;
    const newPlayerPrefix = `${buildPlayerFolderName(effectiveName, target.id)}/`;
    const shouldRenamePlayerPrefix =
      shouldRenamePlayerFolder &&
      oldPlayerPrefix !== newPlayerPrefix;

    const renameBucket = shouldRenamePlayerPrefix
      ? process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET_NAME
      : undefined;

    if (shouldRenamePlayerPrefix && !renameBucket) {
      return NextResponse.json(
        {
          success: false,
          message: "S3 bucket is not configured for player folder rename",
        },
        { status: 500 },
      );
    }

    if (!isCategoryAllowed(effectiveGender, effectiveCategory)) {
      return NextResponse.json(
        {
          success: false,
          message: `Category ${effectiveCategory} is invalid for gender ${effectiveGender}`,
        },
        { status: 422 },
      );
    }

    if (currentRole === "video_analyst" && effectiveRole === "player") {
      const dependencyRes = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM tournaments WHERE analyst_id = $1) AS tournaments_count,
           (SELECT COUNT(*)::int FROM videos WHERE uploaded_by = $1) AS uploaded_videos_count`,
        [target.id],
      );

      const tournamentsCount = Number(dependencyRes.rows[0]?.tournaments_count ?? 0);
      const uploadedVideosCount = Number(dependencyRes.rows[0]?.uploaded_videos_count ?? 0);

      if (tournamentsCount > 0 || uploadedVideosCount > 0) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Cannot change role to player while analyst still has tournaments or uploaded videos",
            dependencies: {
              tournamentsCount,
              uploadedVideosCount,
            },
          },
          { status: 409 },
        );
      }
    }

    let playerVideoKeys: string[] = [];
    let copiedPlayerObjects = 0;

    if (currentRole === "player" && effectiveRole === "video_analyst") {
      const playerVideoKeysRes = await pool.query(
        `SELECT s3_key
         FROM videos
         WHERE player_id = $1`,
        [target.id],
      );

      playerVideoKeys = playerVideoKeysRes.rows
        .map((row) => String(row.s3_key ?? ""))
        .filter((key) => key.length > 0);
    }

    const hashedPassword = password ? await bcrypt.hash(password, 12) : undefined;

    await pool.query("BEGIN");

    try {
      if (currentRole === "player" && effectiveRole === "video_analyst") {
        await pool.query(
          `DELETE FROM players
           WHERE user_id = $1`,
          [target.id],
        );

        await pool.query(
          `INSERT INTO video_analysts (user_id, gender, category)
           VALUES ($1, $2, $3)`,
          [target.id, effectiveGender, effectiveCategory],
        );
      } else if (currentRole === "video_analyst" && effectiveRole === "player") {
        await pool.query(
          `DELETE FROM video_analysts
           WHERE user_id = $1`,
          [target.id],
        );

        await pool.query(
          `INSERT INTO players (user_id, gender, category)
           VALUES ($1, $2, $3)`,
          [target.id, effectiveGender, effectiveCategory],
        );
      } else if (effectiveRole === "player") {
        await pool.query(
          `UPDATE players
           SET gender = $2, category = $3
           WHERE user_id = $1`,
          [target.id, effectiveGender, effectiveCategory],
        );
      } else {
        await pool.query(
          `UPDATE video_analysts
           SET gender = $2, category = $3
           WHERE user_id = $1`,
          [target.id, effectiveGender, effectiveCategory],
        );
      }

      const setClauses = ["updated_at = CURRENT_TIMESTAMP"];
      const params: string[] = [];
      let parameterIndex = 1;

      if (username !== undefined) {
        setClauses.push(`username = $${parameterIndex}`);
        params.push(username);
        parameterIndex += 1;
      }

      if (name !== undefined) {
        setClauses.push(`name = $${parameterIndex}`);
        params.push(name);
        parameterIndex += 1;
      }

      if (hashedPassword !== undefined) {
        setClauses.push(`password = $${parameterIndex}`);
        params.push(hashedPassword);
        parameterIndex += 1;
      }

      if (effectiveRole !== currentRole) {
        setClauses.push(`role = $${parameterIndex}`);
        params.push(effectiveRole);
        parameterIndex += 1;
      }

      params.push(target.id);

      await pool.query(
        `UPDATE users
         SET ${setClauses.join(", ")}
         WHERE id = $${parameterIndex}`,
        params,
      );

      if (shouldRenamePlayerPrefix && renameBucket) {
        const copyResult = await copyPrefix(
          renameBucket,
          oldPlayerPrefix,
          newPlayerPrefix,
        );

        copiedPlayerObjects = copyResult.copiedObjects;

        await pool.query(
          `UPDATE videos
           SET s3_key = $3 || substring(s3_key from char_length($2) + 1)
           WHERE player_id = $1
             AND s3_key LIKE $2 || '%'`,
          [target.id, oldPlayerPrefix, newPlayerPrefix],
        );
      }

      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }

    let cdnCleanup:
      | {
          deletedObjects: number;
          failedObjects: number;
          failedTargets: string[];
        }
      | undefined;
    let cdnFolderRename:
      | {
          from: string;
          to: string;
          copiedObjects: number;
          deletedOldObjects: number;
          failedDeletes: number;
          warning: string | null;
        }
      | undefined;

    if (currentRole === "player" && effectiveRole === "video_analyst") {
      const bucket =
        process.env.AWS_BUCKET_NAME ||
        process.env.AWS_S3_BUCKET_NAME ||
        process.env.S3_BUCKET_NAME;

      cdnCleanup = await cleanupPlayerCdn(bucket, target.name, target.id, playerVideoKeys);
    }

    if (shouldRenamePlayerPrefix && renameBucket) {
      const oldPrefixDeletion = await deletePrefix(renameBucket, oldPlayerPrefix);

      cdnFolderRename = {
        from: oldPlayerPrefix,
        to: newPlayerPrefix,
        copiedObjects: copiedPlayerObjects,
        deletedOldObjects: oldPrefixDeletion.deletedObjects,
        failedDeletes: oldPrefixDeletion.failedObjects,
        warning:
          oldPrefixDeletion.failedObjects > 0
            ? "Some objects in the old player folder could not be deleted"
            : null,
      };
    }

    const responseMessage =
      cdnFolderRename?.warning
        ? "User updated and player folder renamed, but old folder cleanup was partial"
        : "User updated successfully";

    return NextResponse.json(
      {
        success: true,
        message: responseMessage,
        user: {
          id: target.id,
          username: username ?? target.username,
          name: effectiveName,
          role: effectiveRole,
          gender: effectiveGender,
          category: effectiveCategory,
        },
        roleTransition:
          currentRole === effectiveRole
            ? null
            : {
                from: currentRole,
                to: effectiveRole,
              },
        cdnCleanup,
        cdnFolderRename,
      },
      { status: 200 },
    );
  } catch (error) {
    const maybeError = error as { code?: string };

    if (maybeError.code === "23505") {
      return NextResponse.json(
        {
          success: false,
          message: "Username already exists",
        },
        { status: 409 },
      );
    }

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
  return handleEditUser(req);
}

export async function PATCH(req: NextRequest) {
  return handleEditUser(req);
}
