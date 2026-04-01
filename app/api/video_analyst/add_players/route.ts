
import { z } from "zod";
import pool from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { PutObjectCommand, S3 } from "@aws-sdk/client-s3";
import s3Client from "@/lib/s3";

interface TokenPayload {
  username: string;
  role: "player" | "admin" | "video_analyst";
  iat: number;
}

const addPlayersSchema = z.object({
  matchId: z.string().uuid("Invalid match ID"),
  playerIds: z
    .array(z.string().uuid("Invalid player ID"))
    .min(1, "At least one player required"),
});

function extractAnalyst(req: NextRequest): TokenPayload | null {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as TokenPayload;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const payload = extractAnalyst(req);

  if (!payload) {
    return NextResponse.json(
      { error: "Missing or invalid token" },
      { status: 401 }
    );
  }

  if (payload.role !== "video_analyst") {
    return NextResponse.json(
      { error: "Only video analysts can add players to a match" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = addPlayersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { matchId, playerIds } = parsed.data;

  try {
    // ── Query 1: resolve analyst + match + tournament + ownership in one shot ──
    // Joins users → video_analysts to get the analyst's ID, then joins matches
    // and tournaments so we can do the ownership check without a second query.
    const ctxRes = await pool.query(
      `SELECT
         va.user_id           AS analyst_id,
         t.analyst_id         AS tournament_analyst_id,
         t.gender             AS tournament_gender,
         t.name               AS tournament_name,
         t.category           AS tournament_category,
         m.name               AS match_name 
       FROM users u
       JOIN video_analysts va  ON va.user_id    = u.id
       JOIN matches m          ON m.id          = $2
       JOIN tournaments t      ON t.id          = m.tournament_id
       WHERE u.username = $1`,
      [payload.username, matchId]
    );

    console.log("ctxRes" , ctxRes.rows , "-----------------------------------------------------------------------------------------")

    // If the analyst account doesn't exist the join returns 0 rows.
    if (ctxRes.rowCount === 0) {
      // Distinguish "match not found" from "analyst not found" with a cheap
      // targeted query only on the failure path (not the hot path).
      const matchExists = await pool.query(
        `SELECT 1 FROM matches WHERE id = $1`,
        [matchId]
      );
      if (matchExists.rowCount === 0) {
        return NextResponse.json({ error: "Match not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Analyst account not found" },
        { status: 403 }
      );
    }

    const {
      analyst_id,
      tournament_analyst_id,
      tournament_gender,
      tournament_category,
    } = ctxRes.rows[0];

    if (tournament_analyst_id !== analyst_id) {
      return NextResponse.json(
        { error: "You are not authorised to modify this match" },
        { status: 403 }
      );
    }

    // ── Query 2: fetch players + check existing membership in one shot ─────────
    // LEFT JOIN match_players lets us detect duplicates without a separate query.
    const playersRes = await pool.query(
      `SELECT
         p.user_id,
         u.name               AS player_name,
         p.gender,
         p.category,
         (mp.player_id IS NOT NULL) AS already_in_match
       FROM players p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN match_players mp
         ON mp.match_id = $1 AND mp.player_id = p.user_id
       WHERE p.user_id = ANY($2::uuid[])`,
      [matchId, playerIds]
    );

    console.log( "PlayerRes" , playersRes.rows ,  "-----------------------------------------------------------------------------------------")

    if (playersRes.rowCount !== playerIds.length) {
      const foundIds = new Set(playersRes.rows.map((r) => r.user_id));
      const missing = playerIds.filter((id) => !foundIds.has(id));
      return NextResponse.json(
        { error: "Some player IDs do not exist", missingIds: missing },
        { status: 404 }
      );
    }

    // Partition the result set in a single pass
    const invalidPlayers: typeof playersRes.rows = [];
    const alreadyAdded = new Set<string>();
    const newPlayerIds: string[] = [];

    for (const p of playersRes.rows) {
      if (p.gender !== tournament_gender || p.category !== tournament_category) {
        invalidPlayers.push(p);
        continue;
      }
      if (p.already_in_match) {
        alreadyAdded.add(p.user_id);
        continue;
      }
      newPlayerIds.push(p.user_id );
    }

    // ── Query 3: bulk insert (only if there's something new) ──────────────────
    if (newPlayerIds.length > 0) {

        const matchDetails = { matchName : ctxRes.rows[0].match_name , tournamentName : ctxRes.rows[0].tournament_name} 
        const newPlayerIdSet = new Set(newPlayerIds);
        const playerNames = playersRes.rows
          .filter((p) => newPlayerIdSet.has(p.user_id))
          .map((p) => p.player_name);

        const values = newPlayerIds.map((_, i) => `($1, $${i + 2})`).join(", ");
        const result = await pool.query(
          `INSERT INTO match_players (match_id, player_id) VALUES ${values} RETURNING *`,
          [matchId, ...newPlayerIds]
        );

        console.log("playerNames" , playerNames)

        for ( const names of playerNames) {

          console.log(names)

          const key = `${names}/${matchDetails.tournamentName}/${matchDetails.matchName}/`

          const putCmd = new PutObjectCommand({

            Bucket : process.env.AWS_BUCKET_NAME || "cricket8759",
            Key : key,
            Body : ""

          })
          
          await s3Client.send(putCmd) 
        
        }


    }

    // ── Build response ─────────────────────────────────────────────────────────
    const responseBody: Record<string, unknown> = {
      added: newPlayerIds.length,
      skipped: alreadyAdded.size,
    };

    if (invalidPlayers.length > 0) {
      responseBody.rejected = {
        reason: "gender/category mismatch with tournament",
        expectedGender: tournament_gender,
        expectedCategory: tournament_category,
        players: invalidPlayers.map((p) => ({
          id: p.user_id,
          gender: p.gender,
          category: p.category,
        })),
      };
    }

    if (newPlayerIds.length === 0 && alreadyAdded.size === 0) {
      return NextResponse.json(
        { error: "No valid players to add", ...responseBody },
        { status: 422 }
      );
    }

    if (newPlayerIds.length === 0) {
      return NextResponse.json(
        { error: "All valid players are already in this match", ...responseBody },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { message: "Players processed", ...responseBody },
      { status: 201 }
    );
  } catch (err) {
    console.error("Add players error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}