import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import pool from "@/lib/db";
import s3Client from "@/lib/s3";

type TokenPayload = {
  id?: string;
  username: string;
  role: "player" | "admin" | "video_analyst";
  iat: number;
};

const paramsSchema = z.object({
  videoId: z.string().uuid("Invalid videoId"),
});

type RouteParams = {
  params: Promise<{ videoId: string }>;
};

function getTokenPayload(req: NextRequest): TokenPayload | null {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET || "");

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

export async function GET(req: NextRequest, { params }: RouteParams) {
  const parsedParams = paramsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Validation failed",
        error: parsedParams.error.flatten(),
      },
      { status: 422 },
    );
  }

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

  if (tokenPayload.role !== "player") {
    return NextResponse.json(
      {
        success: false,
        message: "Only players can access videos from this route",
      },
      { status: 403 },
    );
  }

  const requesterId = await resolveRequesterId(tokenPayload);

  if (!requesterId) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid player context",
      },
      { status: 401 },
    );
  }

  const { videoId } = parsedParams.data;

  try {
    const videoRes = await pool.query(
      `SELECT
         id,
         player_id,
         file_name,
         file_type,
         s3_key
       FROM videos
       WHERE id = $1`,
      [videoId],
    );

    if (videoRes.rowCount === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Video not found",
        },
        { status: 404 },
      );
    }

    const video = videoRes.rows[0] as {
      id: string;
      player_id: string;
      file_name: string;
      file_type: string;
      s3_key: string;
    };

    if (String(video.player_id) !== requesterId) {
      return NextResponse.json(
        {
          success: false,
          message: "You are not authorised to access this video",
        },
        { status: 403 },
      );
    }

    const bucket =
      process.env.AWS_BUCKET_NAME ||
      process.env.AWS_S3_BUCKET_NAME ||
      process.env.S3_BUCKET_NAME;

    if (!bucket) {
      return NextResponse.json(
        {
          success: false,
          message: "S3 bucket is not configured",
        },
        { status: 500 },
      );
    }

    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: video.s3_key,
        ResponseContentType: video.file_type,
      }),
      { expiresIn: 15 * 60 },
    );

    return NextResponse.json(
      {
        success: true,
        message: "Playback URL generated",
        video: {
          id: video.id,
          file_name: video.file_name,
          file_type: video.file_type,
          url,
          expires_in_seconds: 15 * 60,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Failed to generate playback URL",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
