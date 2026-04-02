import jwt from "jsonwebtoken"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import pool from "@/lib/db"

type TokenPayload = {
  id?: string
  username: string
  role: "player" | "admin" | "video_analyst"
  iat: number
}

const saveVideoSchema = z
  .object({
    playerId: z.string().uuid("Invalid player ID"),
    fileName: z.string().min(1, "File name is required"),
    fileType: z.string().min(1, "File type is required"),
    s3Key: z.string().min(1, "s3Key is required"),
    tournamentId: z.string().uuid("Invalid tournament ID").nullable().optional(),
    matchId: z.string().uuid("Invalid match ID").nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.matchId && !data.tournamentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tournamentId"],
        message: "tournamentId is required when matchId is provided",
      })
    }

    if (!data.matchId && data.tournamentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tournamentId"],
        message: "tournamentId must be null for adhoc uploads",
      })
    }
  })

const payloadSchema = z.object({
  videos: z.array(saveVideoSchema).min(1, "At least one video is required"),
})

function getTokenPayload(req: NextRequest): TokenPayload | null {
  const token = req.cookies.get("token")?.value
  if (!token) return null

  try {
    return jwt.verify(token, process.env.JWT_SECRET || "") as TokenPayload
  } catch {
    return null
  }
}

async function resolveAnalystId(payload: TokenPayload): Promise<string | null> {
  if (payload.id) return payload.id

  const userRes = await pool.query("SELECT id FROM users WHERE username = $1 LIMIT 1", [payload.username])
  return userRes.rows[0]?.id ?? null
}

export async function POST(req: NextRequest) {
  const payload = getTokenPayload(req)

  if (!payload) {
    return NextResponse.json({ success: false, message: "Missing or invalid token" }, { status: 401 })
  }

  if (payload.role !== "video_analyst") {
    return NextResponse.json({ success: false, message: "Only video analysts can save videos" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = payloadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        message: "Validation failed",
        error: parsed.error.flatten(),
      },
      { status: 422 },
    )
  }

  try {
    const analystId = await resolveAnalystId(payload)

    if (!analystId) {
      return NextResponse.json({ success: false, message: "Analyst not found" }, { status: 404 })
    }

    const analystRes = await pool.query(
      `SELECT gender, category
       FROM video_analysts
       WHERE user_id = $1`,
      [analystId],
    )

    if (analystRes.rowCount === 0) {
      return NextResponse.json({ success: false, message: "Video analyst profile not found" }, { status: 403 })
    }

    const analystGender = analystRes.rows[0].gender as string
    const analystCategory = analystRes.rows[0].category as string

    const videos = parsed.data.videos
    const playerIds = Array.from(new Set(videos.map((v) => v.playerId)))

    const playersRes = await pool.query(
      `SELECT user_id, gender, category
       FROM players
       WHERE user_id = ANY($1::uuid[])`,
      [playerIds],
    )

    const playersById = new Map<string, { gender: string; category: string }>(
      playersRes.rows.map((row) => [row.user_id as string, { gender: row.gender as string, category: row.category as string }]),
    )

    const missingPlayerIds = playerIds.filter((id) => !playersById.has(id))
    if (missingPlayerIds.length > 0) {
      return NextResponse.json(
        { success: false, message: "Some players do not exist", missingPlayerIds },
        { status: 404 },
      )
    }

    const unauthorizedPlayers = playerIds.filter((id) => {
      const player = playersById.get(id)
      if (!player) return true
      return player.gender !== analystGender || player.category !== analystCategory
    })

    if (unauthorizedPlayers.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Some players are outside analyst gender/category scope",
          unauthorizedPlayers,
        },
        { status: 403 },
      )
    }

    const videosWithMatch = videos.filter((v) => Boolean(v.matchId && v.tournamentId))

    if (videosWithMatch.length > 0) {
      const matchIds = Array.from(new Set(videosWithMatch.map((v) => v.matchId).filter((id): id is string => Boolean(id))))

      const matchesRes = await pool.query(
        `SELECT m.id AS match_id, m.tournament_id, t.analyst_id
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
         WHERE m.id = ANY($1::uuid[])`,
        [matchIds],
      )

      const matchById = new Map<string, { tournament_id: string; analyst_id: string }>(
        matchesRes.rows.map((row) => [row.match_id as string, { tournament_id: row.tournament_id as string, analyst_id: row.analyst_id as string }]),
      )

      const missingMatchIds = matchIds.filter((id) => !matchById.has(id))
      if (missingMatchIds.length > 0) {
        return NextResponse.json(
          { success: false, message: "Some matches do not exist", missingMatchIds },
          { status: 404 },
        )
      }

      const invalidOwnershipOrTournament = videosWithMatch.filter((video) => {
        const context = matchById.get(video.matchId as string)
        if (!context) return true
        if (context.analyst_id !== analystId) return true
        return context.tournament_id !== video.tournamentId
      })

      if (invalidOwnershipOrTournament.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Some videos have invalid tournament/match mapping or unauthorized ownership",
            invalid: invalidOwnershipOrTournament.map((video) => ({
              playerId: video.playerId,
              tournamentId: video.tournamentId,
              matchId: video.matchId,
            })),
          },
          { status: 403 },
        )
      }

      const membershipRes = await pool.query(
        `SELECT match_id, player_id
         FROM match_players
         WHERE match_id = ANY($1::uuid[])
           AND player_id = ANY($2::uuid[])`,
        [matchIds, playerIds],
      )

      const membershipSet = new Set<string>(
        membershipRes.rows.map((row) => `${String(row.match_id)}:${String(row.player_id)}`),
      )

      const videosWithoutMembership = videosWithMatch.filter(
        (video) => !membershipSet.has(`${video.matchId}:${video.playerId}`),
      )

      if (videosWithoutMembership.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Some players are not assigned to the provided match",
            invalid: videosWithoutMembership.map((video) => ({
              playerId: video.playerId,
              matchId: video.matchId,
            })),
          },
          { status: 422 },
        )
      }
    }

    await pool.query("BEGIN")

    const valuesSql: string[] = []
    const params: Array<string | null> = []
    let idx = 1

    for (const video of videos) {
      valuesSql.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`)
      params.push(
        video.playerId,
        video.tournamentId ?? null,
        video.matchId ?? null,
        video.fileName,
        video.fileType,
        video.s3Key,
        analystId,
      )
      idx += 7
    }

    const insertRes = await pool.query(
      `INSERT INTO videos (player_id, tournament_id, match_id, file_name, file_type, s3_key, uploaded_by)
       VALUES ${valuesSql.join(", ")}
       ON CONFLICT (s3_key) DO NOTHING
       RETURNING id, s3_key`,
      params,
    )

    await pool.query("COMMIT")

    return NextResponse.json(
      {
        success: true,
        message: "Videos saved successfully",
        savedIds: insertRes.rows.map((row) => row.id),
        savedCount: insertRes.rowCount,
      },
      { status: 200 },
    )
  } catch (error) {
    await pool.query("ROLLBACK")

    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
