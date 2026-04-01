import { loginSchema } from "@/types/zod";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {

    const data = await req.json();
    const parsedData = loginSchema.safeParse(data);

    if (!parsedData.success) {
        return NextResponse.json(
            {
                message: "Invalid input",
                success: false,
            },
            { status: 400 }
        );
    }

    const { username, password  } = parsedData.data;


   // Change this line:
    const player = await pool.query(
    "SELECT id, username, password, role FROM users WHERE username = $1", 
    [username]
    );

    const decodedPass = bcrypt.decodeBase64(player.rows[0].password , 12)

    console.log(decodedPass)
    
    const verifyUser = await bcrypt.compare(password , player.rows[0].password)
    
    if (!player || !verifyUser) {
        return NextResponse.json(
            {
                message: "Login credentials Failed",
                success: false,
            },
            { status: 401 }
        );
    }

    const token = jwt.sign(
        JSON.stringify({
            username,
            role : player.rows[0].role
        }),
        process.env.JWT_SECRET || "fallback_secret"
    );

    const response = NextResponse.json(
        {
            message: "Login Successfull",
            success: true,
        },
        { status: 200 }
    );

    response.cookies.set("token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    return response;
}