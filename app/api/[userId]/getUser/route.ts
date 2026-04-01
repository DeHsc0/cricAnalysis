import pool from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const paramsSchema = z.object({
	userId: z.string().uuid("Invalid userId"),
})

type RouteParams = {
	params: Promise<{ userId: string }>
}

type MatchPlayerRow = {
	match_id: string
	player_id: string
	name: string
	username: string
	gender: "men" | "women"
	category: string
}

type VideoRow = {
	id: string
	player_id: string
	player_name: string
	player_username: string
	tournament_id: string | null
	match_id: string | null
	file_name: string
	file_type: string
	s3_key: string
	created_at: string
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
	const parsedParams = paramsSchema.safeParse(await params)

	if (!parsedParams.success) {
		return NextResponse.json(
			{
				message: "Validation Error",
				success: false,
				error: parsedParams.error.flatten(),
			},
			{ status: 400 },
		)
	}

	const { userId } = parsedParams.data

	try {
		const userRes = await pool.query(
			`SELECT id, username, name, role
			 FROM users
			 WHERE id = $1`,
			[userId],
		)

		if (userRes.rowCount === 0) {
			return NextResponse.json(
				{
					message: "User not found",
					success: false,
				},
				{ status: 404 },
			)
		}

		const baseUser = userRes.rows[0]

		if (baseUser.role === "player") {
			return NextResponse.json(
				{
					message: "Player data route is not implemented yet",
					success: true,
					role: "player",
					user: {
						id: baseUser.id,
						username: baseUser.username,
						name: baseUser.name,
					},
					data: null,
				},
				{ status: 200 },
			)
		}

		if (baseUser.role !== "video_analyst") {
			return NextResponse.json(
				{
					message: "Only player and video_analyst roles are supported",
					success: false,
				},
				{ status: 400 },
			)
		}

		const analystRes = await pool.query(
			`SELECT va.gender, va.category
			 FROM video_analysts va
			 WHERE va.user_id = $1`,
			[userId],
		)

		if (analystRes.rowCount === 0) {
			return NextResponse.json(
				{
					message: "Video analyst profile not found",
					success: false,
				},
				{ status: 404 },
			)
		}

		const analystProfile = analystRes.rows[0]

		const tournamentsRes = await pool.query(
			`SELECT id, name, analyst_id, gender, category, created_at
			 FROM tournaments
			 WHERE analyst_id = $1
			 ORDER BY created_at DESC`,
			[userId],
		)

		const tournaments = tournamentsRes.rows
		const tournamentIds = tournaments.map((t: { id: string }) => t.id)

		let matches: Array<{
			id: string
			tournament_id: string
			name: string
			created_at: string
		}> = []

		let matchPlayers: MatchPlayerRow[] = []

		if (tournamentIds.length > 0) {
			const matchesRes = await pool.query(
				`SELECT id, tournament_id, name, created_at
				 FROM matches
				 WHERE tournament_id = ANY($1::uuid[])
				 ORDER BY created_at DESC`,
				[tournamentIds],
			)

			matches = matchesRes.rows
			const matchIds = matches.map((m) => m.id)

			if (matchIds.length > 0) {
				const matchPlayersRes = await pool.query(
					`SELECT
						 mp.match_id,
						 p.user_id AS player_id,
						 u.name,
						 u.username,
						 p.gender,
						 p.category
					 FROM match_players mp
					 JOIN players p ON p.user_id = mp.player_id
					 JOIN users u ON u.id = p.user_id
					 WHERE mp.match_id = ANY($1::uuid[])
					 ORDER BY u.name ASC`,
					[matchIds],
				)

				matchPlayers = matchPlayersRes.rows
			}
		}

		const sameCategoryPlayersRes = await pool.query(
			`SELECT
				 p.user_id AS player_id,
				 u.name,
				 u.username,
				 p.gender,
				 p.category
			 FROM players p
			 JOIN users u ON u.id = p.user_id
			 WHERE p.gender = $1 AND p.category = $2
			 ORDER BY u.name ASC`,
			[analystProfile.gender, analystProfile.category],
		)

		const uploadedVideosRes = await pool.query(
			`SELECT
				 v.id,
				 v.player_id,
				 pu.name AS player_name,
				 pu.username AS player_username,
				 v.tournament_id,
				 v.match_id,
				 v.file_name,
				 v.file_type,
				 v.s3_key,
				 v.created_at
			 FROM videos v
			 JOIN users pu ON pu.id = v.player_id
			 WHERE v.uploaded_by = $1
			 ORDER BY v.created_at DESC`,
			[userId],
		)

		const uploadedVideos: VideoRow[] = uploadedVideosRes.rows

		const playersByMatchId = new Map<string, MatchPlayerRow[]>()
		for (const row of matchPlayers) {
			const list = playersByMatchId.get(row.match_id) ?? []
			list.push(row)
			playersByMatchId.set(row.match_id, list)
		}

		const videosByMatchId = new Map<string, VideoRow[]>()
		for (const video of uploadedVideos) {
			if (!video.match_id) continue
			const list = videosByMatchId.get(video.match_id) ?? []
			list.push(video)
			videosByMatchId.set(video.match_id, list)
		}

		const uniquePlayersInMatchesMap = new Map<string, MatchPlayerRow>()
		for (const player of matchPlayers) {
			uniquePlayersInMatchesMap.set(player.player_id, player)
		}

		const matchesByTournamentId = new Map<string, Array<Record<string, unknown>>>()
		for (const match of matches) {
			const list = matchesByTournamentId.get(match.tournament_id) ?? []
			list.push({
				id: match.id,
				name: match.name,
				created_at: match.created_at,
				players: (playersByMatchId.get(match.id) ?? []).map((player) => ({
					id: player.player_id,
					name: player.name,
					username: player.username,
					gender: player.gender,
					category: player.category,
				})),
				uploaded_videos: (videosByMatchId.get(match.id) ?? []).map((video) => ({
					id: video.id,
					player_id: video.player_id,
					player_name: video.player_name,
					player_username: video.player_username,
					file_name: video.file_name,
					file_type: video.file_type,
					s3_key: video.s3_key,
					created_at: video.created_at,
				})),
			})
			matchesByTournamentId.set(match.tournament_id, list)
		}

		return NextResponse.json(
			{
				message: "Video analyst data fetched successfully",
				success: true,
				role: "video_analyst",
				analyst: {
					id: baseUser.id,
					username: baseUser.username,
					name: baseUser.name,
					gender: analystProfile.gender,
					category: analystProfile.category,
				},
				tournaments: tournaments.map((tournament: Record<string, unknown>) => ({
					...tournament,
					matches: matchesByTournamentId.get(String(tournament.id)) ?? [],
				})),
				players_in_created_matches: Array.from(uniquePlayersInMatchesMap.values()).map((player) => ({
					id: player.player_id,
					name: player.name,
					username: player.username,
					gender: player.gender,
					category: player.category,
				})),
				players_same_gender_category: sameCategoryPlayersRes.rows.map(
					(player: {
						player_id: string
						name: string
						username: string
						gender: string
						category: string
					}) => ({
						id: player.player_id,
						name: player.name,
						username: player.username,
						gender: player.gender,
						category: player.category,
					}),
				),
				uploaded_videos: uploadedVideos.map((video) => ({
					id: video.id,
					player_id: video.player_id,
					player_name: video.player_name,
					player_username: video.player_username,
					tournament_id: video.tournament_id,
					match_id: video.match_id,
					file_name: video.file_name,
					file_type: video.file_type,
					s3_key: video.s3_key,
					created_at: video.created_at,
				})),
			},
			{ status: 200 },
		)
	} catch (error) {
		return NextResponse.json(
			{
				message: "Internal Server Error",
				success: false,
				error: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 },
		)
	}
}
