import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken"
import pool from "@/lib/db";
import { signupSchema } from "@/types/zod";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
	
    const body = await req.json();

	const parsed = signupSchema.safeParse(body);

	if (!parsed.success) {

		return NextResponse.json(
		
            {
				success: false,
				message: "Invalid input",
				errors: parsed.error.format(),
			},
			{ status: 400 }
		);
	}

	const { username, password , role , name } = parsed.data;

	const hashedPassword = await bcrypt.hash(password , 12)
	
	try {
		
		const existingUser = await pool.query(
			"SELECT 1 FROM users WHERE username = $1 LIMIT 1",
			[username]
		);

		if ((existingUser.rowCount ?? 0) > 0) {
			return NextResponse.json(
				{
					success: false,
					message: "username already in use",
				},
				{ status: 409 }
			);
		}

		const result = await pool.query(
			"INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4) RETURNING *;",
			[username, hashedPassword , name, role]
		);

        const token = jwt.sign(
                JSON.stringify({
					id: result.rows[0].id,
                    username,
                    role
                }),
                process.env.JWT_SECRET || "fallback_secret"
            );

		const response =  NextResponse.json(
			{
				success: true,
				message: "Signup successful",
				result
			},
			{ status: 201 }
		)

		response.cookies.set("token", token, {
            httpOnly: true,
            sameSite: "lax"
        })

		return response 

	} catch (error) {
        
		console.error("Signup route error:", error);

		return NextResponse.json(
			{
				success: false,
				message: "Internal server error",
			},
			{ status: 500 }
		);
	}
}