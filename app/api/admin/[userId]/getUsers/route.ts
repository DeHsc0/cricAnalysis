import pool from "@/lib/db"
import { z } from "zod"
import { NextRequest, NextResponse } from "next/server"

const paramsSchema = z.object({
	userId: z.string().uuid("Invalid userId"),
})

type RouteParams = {
	params: Promise<{ userId: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
	const parsedParams = paramsSchema.safeParse(await params)

	if (!parsedParams.success) {
		return NextResponse.json(
			{
				message: "Validation Error",
				error: parsedParams.error.flatten(),
				success: false,
			},
			{ status: 400 },
		)
	}

	const { userId } = parsedParams.data

	try {
		const creatorCheck = await pool.query(
			`SELECT id, username, name, role
			 FROM users
			 WHERE id = $1`,
			[userId],
		)

		if (creatorCheck.rowCount === 0) {
			return NextResponse.json(
				{
					message: "Creator user not found",
					success: false,
				},
				{ status: 404 },
			)
		}

		const createdUsersRes = await pool.query(
			`SELECT
				 u.id,
				 u.username,
				 u.name,
				 u.role,
				 u.created_at,
				 COALESCE(p.gender, va.gender) AS gender,
				 COALESCE(p.category, va.category) AS category
			 FROM users u
			 LEFT JOIN players p ON p.user_id = u.id
			 LEFT JOIN video_analysts va ON va.user_id = u.id
			 WHERE u.created_by = $1
			 ORDER BY u.created_at DESC`,
			[userId],
		)

		return NextResponse.json(
			{
				message: "Users fetched successfully",
				success: true,
				users: createdUsersRes.rows,
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
