import pool from "@/lib/db";
import { createTournamentSchema } from "@/types/zod";
import { NextRequest, NextResponse } from "next/server";

export async function POST ( req : NextRequest) {

    const data = await req.json()

    const parsedData = await createTournamentSchema.safeParse(data)

    if(!parsedData.success) return NextResponse.json({

        message: "Validation Error",
        error : parsedData.error?.flatten(),
        success : false

    })

    const { analystId , gender , category , name } = parsedData.data

    try{

        const analystCheck = await pool.query(
            `SELECT gender, category FROM video_analysts WHERE user_id = $1`,
            [analystId]
        );

        if (analystCheck.rowCount === 0) {
            return NextResponse.json({
                message: "Analyst not found",
                success: false
            }, { status: 404 });
        }

        const analyst = analystCheck.rows[0];

        if (analyst.gender !== gender || analyst.category !== category) {
            return NextResponse.json({
                message: "Unauthorized: Analyst category/gender mismatch",
                success: false
            }, { status: 403 });
        }

        const tournamentQuery =  await pool.query(
            `INSERT INTO tournaments (name, analyst_id, gender, category)
            VALUES ($1, $2, $3, $4)`,
            [name, analystId, gender, category]
        )

        return NextResponse.json({
    
            message : "Created a tournament successfully",
            success : true
    
    
        } , { status : 200 })

    }

    catch(error){

        return NextResponse.json({

            message : "Internal Server Error",
            error : error instanceof Error ? error.message : String(error)

        })

    }


}