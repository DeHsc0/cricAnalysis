import { loginSchema } from "@/types/zod";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {

    const data = await req.json()

    console.log(data)   

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

    try {

        const player = await pool.query(
            "SELECT id, username, password, role FROM users WHERE username = $1", 
            [username]
            );

            if (!player.rows[0]) {
                return NextResponse.json(
                    {
                        message: "Login credentials Failed",
                        success: false,
                    },
                    { status: 401 }
                );
            }

            const verifyUser = await bcrypt.compare(password , player.rows[0].password)
            

            const token = jwt.sign(
                JSON.stringify({
                    id : player.rows[0].id,
                    username,
                    role : player.rows[0].role
                }),
                process.env.JWT_SECRET || "fallback_secret"
            );

            const response = NextResponse.json(
                { message: "Login Successful", success: true },
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
        catch(error){

            return NextResponse.json({

                message : "Something went wrong",
                error : error instanceof Error ? error.message : String(error)

            } , { status : 500})


        }

}