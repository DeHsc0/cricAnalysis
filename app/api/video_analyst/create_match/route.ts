import pool from "@/lib/db";
import { createMatchSchema } from "@/types/zod";
import { NextRequest, NextResponse } from "next/server";

export async function POST ( req : NextRequest) {

    const data = await req.json()

    const parsedData = createMatchSchema.safeParse(data)

    if(!parsedData.success) return NextResponse.json({

        message: "Validation Error",
        error : parsedData.error?.flatten(),
        success : false

    } , { status : 400 })

    const { tournamentId , name  } = parsedData.data

    try{
        const tournamentDetails = await pool.query("SELECT * FROM tournaments WHERE id = $1" , [tournamentId])
    
        if(tournamentDetails.rowCount === 0) {
            return NextResponse.json({
                message: "Tournament not found",
                success: false
            }, { status: 404 })
        }
    
        const createMatch = await pool.query("INSERT INTO matches ( tournament_id , name ) VALUES ( $1 , $2 ) " , [ tournamentDetails.rows[0].id , name ])

        return NextResponse.json({

            success : true,
            message : "Match Created Successfully"

        })
    
    } catch(error){

        return NextResponse.json({

            success : false,
            message : "internal Error",
            error : error instanceof Error ? error.message : String(error)

        } , { status : 500})

    }

}