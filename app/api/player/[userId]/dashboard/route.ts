import pool from "@/lib/db";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type TokenPayload = {
  id?: string;
  username: string;
  role: "player" | "admin" | "video_analyst";
  iat: number;
};

const paramsSchema = z.object({
  userId: z.string().uuid("Invalid userId"),
});

type RouteParams = {
  params: Promise<{ userId: string }>;
};

type VideoRow = {
  id: string;
  player_id: string;
  tournament_id: string | null;
  match_id: string | null;
  file_name: string;
  file_type: string;
  s3_key: string;
  created_at: string;
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
        message: "Validation Error",
        success: false,
        error: parsedParams.error.flatten(),
      },
      { status: 400 },
    );
  }

  const tokenPayload = getTokenPayload(req);

  if (!tokenPayload) {
    return NextResponse.json(
      {
        message: "Missing or invalid token",
        success: false,
      },
      { status: 401 },
    );
  }

  if (tokenPayload.role !== "player") {
    return NextResponse.json(
      {
        message: "Only players can access this dashboard",
        success: false,
      },
      { status: 403 },
    );
  }

  const requesterId = await resolveRequesterId(tokenPayload);

  if (!requesterId) {
    return NextResponse.json(
      {
        message: "Invalid player context",
        success: false,
      },
      { status: 401 },
    );
  }

  const { userId } = parsedParams.data;

  if (requesterId !== userId) {
    return NextResponse.json(
      {
        message: "You can only access your own dashboard",
        success: false,
      },
      { status: 403 },
    );
  }

  try {
    const userRes = await pool.query(
      `SELECT id, username, name, role
       FROM users
       WHERE id = $1`,
      [userId],
    );

    if (userRes.rowCount === 0) {
      return NextResponse.json(
        {
          message: "User not found",
          success: false,
        },
        { status: 404 },
      );
    }

    const baseUser = userRes.rows[0] as {
      id: string;
      username: string;
      name: string;
      role: string;
    };

    if (baseUser.role !== "player") {
      return NextResponse.json(
        {
          message: "User is not a player",
          success: false,
        },
        { status: 400 },
      );
    }

    const playerRes = await pool.query(
      `SELECT gender, category
       FROM players
       WHERE user_id = $1`,
      [userId],
    );

    if (playerRes.rowCount === 0) {
      return NextResponse.json(
        {
          message: "Player profile not found",
          success: false,
        },
        { status: 404 },
      );
    }

    const playerProfile = playerRes.rows[0] as {
      gender: "men" | "women";
      category: string;
    };

    const tournamentsRes = await pool.query(
      `SELECT DISTINCT
         t.id,
         t.name,
         t.created_at
       FROM tournaments t
       JOIN matches m ON m.tournament_id = t.id
       JOIN match_players mp ON mp.match_id = m.id
       WHERE mp.player_id = $1
       ORDER BY t.created_at DESC`,
      [userId],
    );

    const tournaments = tournamentsRes.rows as Array<{
      id: string;
      name: string;
      created_at: string;
    }>;

    const tournamentIds = tournaments.map((tournament) => tournament.id);

    let matches: Array<{
      id: string;
      tournament_id: string;
      name: string;
      created_at: string;
    }> = [];

    if (tournamentIds.length > 0) {
      const matchesRes = await pool.query(
        `SELECT
           m.id,
           m.tournament_id,
           m.name,
           m.created_at
         FROM matches m
         JOIN match_players mp ON mp.match_id = m.id
         WHERE mp.player_id = $1
           AND m.tournament_id = ANY($2::uuid[])
         ORDER BY m.created_at DESC`,
        [userId, tournamentIds],
      );

      matches = matchesRes.rows;
    }

    const matchIds = matches.map((match) => match.id);

    let videos: VideoRow[] = [];

    if (matchIds.length > 0) {
      const videosRes = await pool.query(
        `SELECT
           v.id,
           v.player_id,
           v.tournament_id,
           v.match_id,
           v.file_name,
           v.file_type,
           v.s3_key,
           v.created_at
         FROM videos v
         WHERE v.player_id = $1
           AND v.match_id = ANY($2::uuid[])
         ORDER BY v.created_at DESC`,
        [userId, matchIds],
      );

      videos = videosRes.rows as VideoRow[];
    }

    const videosByMatchId = new Map<string, VideoRow[]>();
    for (const video of videos) {
      if (!video.match_id) continue;
      const list = videosByMatchId.get(video.match_id) ?? [];
      list.push(video);
      videosByMatchId.set(video.match_id, list);
    }

    const matchesByTournamentId = new Map<string, Array<Record<string, unknown>>>();
    for (const match of matches) {
      const list = matchesByTournamentId.get(match.tournament_id) ?? [];
      list.push({
        id: match.id,
        name: match.name,
        created_at: match.created_at,
        videos: (videosByMatchId.get(match.id) ?? []).map((video) => ({
          id: video.id,
          player_id: video.player_id,
          tournament_id: video.tournament_id,
          match_id: video.match_id,
          file_name: video.file_name,
          file_type: video.file_type,
          s3_key: video.s3_key,
          created_at: video.created_at,
        })),
      });
      matchesByTournamentId.set(match.tournament_id, list);
    }

    return NextResponse.json(
      {
        message: "Player dashboard data fetched successfully",
        success: true,
        role: "player",
        player: {
          id: baseUser.id,
          username: baseUser.username,
          name: baseUser.name,
          gender: playerProfile.gender,
          category: playerProfile.category,
        },
        tournaments: tournaments.map((tournament) => ({
          ...tournament,
          matches: matchesByTournamentId.get(tournament.id) ?? [],
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        message: "Internal Server Error",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
