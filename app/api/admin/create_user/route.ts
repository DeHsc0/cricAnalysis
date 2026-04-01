
import pool from "@/lib/db"
import s3Client from "@/lib/s3"
import { TokenPayload } from "@/types/auth"
import { createPlayerSchema } from "@/types/zod"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { NextRequest, NextResponse } from "next/server"

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
    let createdBy: string | null = null
    const token = req.cookies.get("token")?.value

    if (token) {
      try {
        const verified = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret")
        const payload = (typeof verified === "string" ? JSON.parse(verified) : verified) as TokenPayload

        if (payload.id) {
          createdBy = payload.id
        } else if (payload.username) {
          const creatorRes = await pool.query(
            `SELECT id FROM users WHERE username = $1 LIMIT 1`,
            [payload.username]
          )
          createdBy = creatorRes.rows[0]?.id ?? null
        }
      } catch {
        createdBy = null
      }
    }

    if (role === "player") {

      const { rows } = await pool.query(
        `WITH new_user AS (
           INSERT INTO users (username, password, name, role, created_by)
           VALUES ($1, $2, $3, 'player', $6)
           RETURNING id
         ),
         new_player AS (
           INSERT INTO players (user_id, gender, category)
           SELECT id, $4, $5 FROM new_user
         )
         SELECT va.user_id, u.name
         FROM video_analysts va
         JOIN users u ON u.id = va.user_id
         WHERE va.gender = $4 AND va.category = $5`,
        [username, hashedPassword, name, gender, category, createdBy]
      )

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME || "cricket8759",
        Key: `${name}/`,
        Body: "",
      }))

      return NextResponse.json({
        message: "Player created",
        success: true,
        assignedTo: rows,
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