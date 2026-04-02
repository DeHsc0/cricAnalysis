
import pool from "@/lib/db"
import s3Client from "@/lib/s3"
import { TokenPayload } from "@/types/auth"
import { createPlayerSchema } from "@/types/zod"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { NextRequest, NextResponse } from "next/server"

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 ._-]/g, "")
    .trim()

  return cleaned.length > 0 ? cleaned : "untitled"
}

function buildPlayerFolderName(playerName: string, playerId: string): string {
  return `${sanitizePathSegment(playerName)}_${playerId}`
}

export async function POST(req: NextRequest) {
  const data = await req.json()
  const parsedData = createPlayerSchema.safeParse(data)

  if (!parsedData.success || parsedData.data.role === "admin") {
    return NextResponse.json({
      message: "Validation Error",
      error: parsedData.error?.flatten(),
      success: false,
    }, { status: 400 })
  }

  const { username, password, name, gender, category, role } = parsedData.data
  
  const hashedPassword = await bcrypt.hash(password, 12)

  try {
    const token = req.cookies.get("token")?.value

    if (!token) {
      return NextResponse.json({
        message: "Unauthorized",
        success: false,
      }, { status: 401 })
    }

    let createdBy: string

    try {
      const verified = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret")
      const payload = (typeof verified === "string" ? JSON.parse(verified) : verified) as TokenPayload

      if (!payload.id || payload.role !== "admin") {
        return NextResponse.json({
          message: "Only admins can create users",
          success: false,
        }, { status: 403 })
      }

      const creatorRes = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'admin' LIMIT 1`,
        [payload.id]
      )

      if ((creatorRes.rowCount ?? 0) === 0) {
        return NextResponse.json({
          message: "Admin account not found",
          success: false,
        }, { status: 403 })
      }

      createdBy = creatorRes.rows[0].id
    } catch {
      return NextResponse.json({
        message: "Invalid or expired token",
        success: false,
      }, { status: 401 })
    }

    if (role === "player") {

      const createdPlayerRes = await pool.query(
        `WITH new_user AS (
           INSERT INTO users (username, password, name, role, created_by)
           VALUES ($1, $2, $3, 'player', $6)
           RETURNING id
         ),
         new_player AS (
           INSERT INTO players (user_id, gender, category)
           SELECT id, $4, $5 FROM new_user
           RETURNING user_id
         )
         SELECT user_id
         FROM new_player`,
        [username, hashedPassword, name, gender, category, createdBy]
      )

      const createdPlayerId = createdPlayerRes.rows[0]?.user_id as string | undefined

      if (!createdPlayerId) {
        return NextResponse.json({
          message: "Unable to create player",
          success: false,
        }, { status: 500 })
      }

      const assignedAnalystsRes = await pool.query(
        `SELECT va.user_id, u.name
         FROM video_analysts va
         JOIN users u ON u.id = va.user_id
         WHERE va.gender = $1 AND va.category = $2`,
        [gender, category],
      )

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME || "cricket8759",
        Key: `${buildPlayerFolderName(name, createdPlayerId)}/`,
        Body: "",
      }))

      return NextResponse.json({
        message: "Player created",
        success: true,
        assignedTo: assignedAnalystsRes.rows,
      }, { status: 201 })

    } else {

      const { rows } = await pool.query(
        `WITH new_user AS (
           INSERT INTO users (username, password, name, role, created_by)
           VALUES ($1, $2, $3, 'video_analyst', $6)
           RETURNING id
         ),
         new_analyst AS (
           INSERT INTO video_analysts (user_id, gender, category)
           SELECT id, $4, $5 FROM new_user
         )
         SELECT p.user_id, u.name
         FROM players p
         JOIN users u ON u.id = p.user_id
         WHERE p.gender = $4 AND p.category = $5`,
        [username, hashedPassword, name, gender, category, createdBy]
      )

      return NextResponse.json({
        message: "Video Analyst created",
        success: true,
        assignedPlayers: rows,
      }, { status: 201 })

    }

  } catch (error) {
    return NextResponse.json({
      message: "Internal error",
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}