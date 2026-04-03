import { ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import jwt from "jsonwebtoken"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import pool from "@/lib/db"
import s3Client from "@/lib/s3"

type TokenPayload = {
  id?: string
  username: string
  role: "player" | "admin" | "video_analyst"
  iat: number
}

const videoMetaSchema = z
  .object({
    playerId: z.string().uuid("Invalid player ID"),
    fileName: z.string().min(1, "File name is required"),
    fileType: z.string().min(1, "File type is required"),
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
  videos: z.array(videoMetaSchema).min(1, "At least one video is required"),
})

function getAnalystFromToken(req: NextRequest): TokenPayload | null {
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

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 ._-]/g, "")
    .trim()

  return cleaned.length > 0 ? cleaned : "untitled"
}

function buildPlayerFolderSegment(playerName: string, playerId: string): string {
  return `${sanitizePathSegment(playerName)}_${playerId}`
}

function buildUniqueFileName(fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_")
  return `${Date.now()}_${crypto.randomUUID()}_${safeName}`
}

export async function POST(req: NextRequest) {
  const analyst = getAnalystFromToken(req)

  if (!analyst) {
    return NextResponse.json({ success: false, message: "Missing or invalid token" }, { status: 401 })
  }

  if (analyst.role !== "video_analyst") {
    return NextResponse.json({ success: false, message: "Only video analysts can upload videos" }, { status: 403 })
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
    const bucket = process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME

    if (!bucket) {
      return NextResponse.json(
        { success: false, message: "S3 bucket is not configured" },
        { status: 500 },
      )
    }

    const videos = parsed.data.videos

    const videosWithMatch = videos.filter(
      (
        video,
      ): video is z.infer<typeof videoMetaSchema> & { matchId: string; tournamentId: string } =>
        Boolean(video.matchId && video.tournamentId),
    )
    const adhocVideos = videos.filter((video) => !video.matchId && !video.tournamentId)

    if (videosWithMatch.length > 0 && adhocVideos.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Do not mix match uploads with adhoc uploads in the same request",
        },
        { status: 422 },
      )
    }

    if (adhocVideos.length > 0) {
      const adhocPlayerIds = new Set(adhocVideos.map((video) => video.playerId))

      if (adhocPlayerIds.size > 1) {
        return NextResponse.json(
          {
            success: false,
            message: "Adhoc upload batch can include videos for only one player",
          },
          { status: 422 },
        )
      }
    }

    const playerFolderByMatchAndId = new Map<string, string>()
    const adhocPlayerFolderById = new Map<string, string>()
    const matchMetaById = new Map<string, { match_name: string; tournament_id: string; tournament_name: string }>()

    if (videosWithMatch.length > 0) {
      const analystId = await resolveAnalystId(analyst)

      if (!analystId) {
        return NextResponse.json({ success: false, message: "Analyst not found" }, { status: 404 })
      }

      const matchIds = Array.from(new Set(videosWithMatch.map((video) => video.matchId)))

      const matchMetaRes = await pool.query(
        `SELECT
           m.id AS match_id,
           m.name AS match_name,
           m.tournament_id,
           t.name AS tournament_name,
           t.analyst_id
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
         WHERE m.id = ANY($1::uuid[])`,
        [matchIds],
      )

      const foundMatchIds = new Set(matchMetaRes.rows.map((row) => row.match_id as string))
      const missingMatchIds = matchIds.filter((id) => !foundMatchIds.has(id))

      if (missingMatchIds.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Some matches do not exist",
            missingMatchIds,
          },
          { status: 404 },
        )
      }

      const unauthorizedMatches = matchMetaRes.rows
        .filter((row) => String(row.analyst_id) !== analystId)
        .map((row) => String(row.match_id))

      if (unauthorizedMatches.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "You are not authorized to upload videos for some matches",
            unauthorizedMatches,
          },
          { status: 403 },
        )
      }

      for (const row of matchMetaRes.rows) {
        matchMetaById.set(String(row.match_id), {
          match_name: String(row.match_name),
          tournament_id: String(row.tournament_id),
          tournament_name: String(row.tournament_name),
        })
      }

      const invalidTournamentMappings = videosWithMatch.filter((video) => {
        const metadata = matchMetaById.get(video.matchId)
        if (!metadata) return true
        return metadata.tournament_id !== video.tournamentId
      })

      if (invalidTournamentMappings.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Some videos have invalid match and tournament mapping",
            invalid: invalidTournamentMappings.map((video) => ({
              playerId: video.playerId,
              tournamentId: video.tournamentId,
              matchId: video.matchId,
            })),
          },
          { status: 403 },
        )
      }

      const membershipRes = await pool.query(
        `SELECT
           mp.match_id,
           mp.player_id,
           u.name AS player_name
         FROM match_players mp
         JOIN users u ON u.id = mp.player_id
         WHERE mp.match_id = ANY($1::uuid[])`,
        [matchIds],
      )

      const playersCountByMatchId = new Map<string, number>()

      for (const row of membershipRes.rows) {
        const matchId = String(row.match_id)
        const playerId = String(row.player_id)

        playersCountByMatchId.set(matchId, (playersCountByMatchId.get(matchId) ?? 0) + 1)
        playerFolderByMatchAndId.set(
          `${matchId}:${playerId}`,
          buildPlayerFolderSegment(String(row.player_name), playerId),
        )
      }

      const matchesWithoutPlayers = matchIds.filter((id) => (playersCountByMatchId.get(id) ?? 0) === 0)

      if (matchesWithoutPlayers.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "You need to add players to the match first",
            matchesWithoutPlayers,
          },
          { status: 422 },
        )
      }

      const invalidPlayerTargets = videosWithMatch.filter(
        (video) => !playerFolderByMatchAndId.has(`${video.matchId}:${video.playerId}`),
      )

      if (invalidPlayerTargets.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Some players are not assigned to the provided match",
            invalid: invalidPlayerTargets.map((video) => ({
              playerId: video.playerId,
              matchId: video.matchId,
            })),
          },
          { status: 422 },
        )
      }
    }

    if (adhocVideos.length > 0) {
      const adhocPlayerIds = Array.from(new Set(adhocVideos.map((video) => video.playerId)))

      const adhocPlayersRes = await pool.query(
        `SELECT
           p.user_id AS player_id,
           u.name AS player_name
         FROM players p
         JOIN users u ON u.id = p.user_id
         WHERE p.user_id = ANY($1::uuid[])`,
        [adhocPlayerIds],
      )

      const foundPlayerIds = new Set(adhocPlayersRes.rows.map((row) => String(row.player_id)))
      const missingPlayerIds = adhocPlayerIds.filter((id) => !foundPlayerIds.has(id))

      if (missingPlayerIds.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Some players do not exist",
            missingPlayerIds,
          },
          { status: 404 },
        )
      }

      for (const row of adhocPlayersRes.rows) {
        const playerId = String(row.player_id)
        adhocPlayerFolderById.set(
          playerId,
          buildPlayerFolderSegment(String(row.player_name), playerId),
        )
      }
    }

    const ensuredPrefixes = new Set<string>()

    async function ensureFolderPrefix(prefix: string) {
      if (ensuredPrefixes.has(prefix)) return

      const existing = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: 1,
        }),
      )

      if (!existing.Contents || existing.Contents.length === 0) {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: prefix,
            Body: "",
          }),
        )
      }

      ensuredPrefixes.add(prefix)
    }

    const signedVideos = await Promise.all(
      videos.map(async (video) => {
        let s3Key: string

        if (video.matchId && video.tournamentId) {
          const metadata = matchMetaById.get(video.matchId)
          const playerFolderSegment = playerFolderByMatchAndId.get(`${video.matchId}:${video.playerId}`)

          if (!metadata || !playerFolderSegment) {
            throw new Error("Unable to resolve match folder details")
          }

          const folderPrefix = `${playerFolderSegment}/${sanitizePathSegment(metadata.tournament_name)}/${sanitizePathSegment(metadata.match_name)}/`

          await ensureFolderPrefix(folderPrefix)

          s3Key = `${folderPrefix}${buildUniqueFileName(video.fileName)}`
        } else {
          const playerFolderSegment = adhocPlayerFolderById.get(video.playerId)

          if (!playerFolderSegment) {
            throw new Error("Unable to resolve adhoc player folder details")
          }

          const folderPrefix = `${playerFolderSegment}/adhoc/`

          await ensureFolderPrefix(folderPrefix)

          s3Key = `${folderPrefix}${buildUniqueFileName(video.fileName)}`
        }

        const presignedUrl = await getSignedUrl(
          s3Client,
          new PutObjectCommand({
            Bucket: bucket,
            Key: s3Key,
            ContentType: video.fileType,
          }),
          { expiresIn: 15 * 60 },
        )

        return {
          playerId: video.playerId,
          fileName: video.fileName,
          fileType: video.fileType,
          tournamentId: video.tournamentId ?? null,
          matchId: video.matchId ?? null,
          s3Key,
          presignedUrl,
        }
      }),
    )

    return NextResponse.json({ success: true, videos: signedVideos }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Failed to generate presigned URLs",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
