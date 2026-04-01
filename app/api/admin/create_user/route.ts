// import pool from "@/lib/db"
// import s3Client from "@/lib/s3"
// import { createPlayerSchema } from "@/types/zod"
// import { PutObjectCommand } from "@aws-sdk/client-s3"
// import bcrypt from "bcryptjs"
// import { NextRequest, NextResponse } from "next/server"


// export async function POST ( req : NextRequest ) {

//     const data = await req.json()

//     const parsedData = await createPlayerSchema.safeParse(data)

//     if(!parsedData.success || parsedData.data.role === "admin") return NextResponse.json({

//         message : "Validation Error",
//         error : parsedData.error?.flatten(),
//         success : false

//     })

//     try{

//       const { username , password , name , gender , category , role } = parsedData.data

//       const hashedPassword = await bcrypt.hash(password , 12)

//       const userResult = await pool.query(
//       `INSERT INTO users (username, password, name, role)
//        VALUES ($1, $2, $3, $4)
//        RETURNING id`,
//       [username, hashedPassword, name , role]
//     )

//     const userId = userResult.rows[0].id

//     if(role === "player") {

//       const playerQuery = await pool.query(
//         `INSERT INTO players (user_id, gender, category)
//         VALUES ($1, $2, $3)`,
//         [userId, gender, category]
//       )

//       const key = `${name}/`

//       const putCmd = new PutObjectCommand({

//         Bucket : process.env.S3_BUCKET_NAME || "cricket8759",
//         Key : key,
//         Body : ""

//       })

//       const executeCmd = await s3Client.send(putCmd)

//       return NextResponse.json({
  
//         message : "Player has been created",
//         success : true
  
//       } , {status : 200} )  

//     } else {

//       const videoAnalystQuery = await pool.query(
//         `INSERT INTO video_analysts (user_id, gender, category)
//         VALUES ($1, $2, $3)`,
//         [userId, gender, category]
//       )

//       return NextResponse.json({

//         message : "Video Analyst created",
//         success : false

//       } , { status : 200 } )

//     }

//     } catch(error){

//       return NextResponse.json({

//         message : "Internal error",
//         error : error instanceof Error ? error.message : String(error)

//       } , { status : 500})


//     }

// }

import pool from "@/lib/db"
import s3Client from "@/lib/s3"
import { createPlayerSchema } from "@/types/zod"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import bcrypt from "bcryptjs"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const data = await req.json()
  const parsedData = createPlayerSchema.safeParse(data)

  if (!parsedData.success || parsedData.data.role === "admin") {
    return NextResponse.json({
      message: "Validation Error",
      error: parsedData.error?.flatten(),
      success: false,
    }, { status: 400 })
  }

  const { username, password, name, gender, category, role } = parsedData.data
  const hashedPassword = await bcrypt.hash(password, 12)

  try {

    if (role === "player") {

      const { rows } = await pool.query(
        `WITH new_user AS (
           INSERT INTO users (username, password, name, role)
           VALUES ($1, $2, $3, 'player')
           RETURNING id
         ),
         new_player AS (
           INSERT INTO players (user_id, gender, category)
           SELECT id, $4, $5 FROM new_user
         )
         SELECT va.user_id, u.name
         FROM video_analysts va
         JOIN users u ON u.id = va.user_id
         WHERE va.gender = $4 AND va.category = $5`,
        [username, hashedPassword, name, gender, category]
      )

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME || "cricket8759",
        Key: `${name}/`,
        Body: "",
      }))

      return NextResponse.json({
        message: "Player created",
        success: true,
        assignedTo: rows,
      }, { status: 201 })

    } else {

      const { rows } = await pool.query(
        `WITH new_user AS (
           INSERT INTO users (username, password, name, role)
           VALUES ($1, $2, $3, 'video_analyst')
           RETURNING id
         ),
         new_analyst AS (
           INSERT INTO video_analysts (user_id, gender, category)
           SELECT id, $4, $5 FROM new_user
         )
         SELECT p.user_id, u.name
         FROM players p
         JOIN users u ON u.id = p.user_id
         WHERE p.gender = $4 AND p.category = $5`,
        [username, hashedPassword, name, gender, category]
      )

      return NextResponse.json({
        message: "Video Analyst created",
        success: true,
        assignedPlayers: rows,
      }, { status: 201 })

    }

  } catch (error) {
    return NextResponse.json({
      message: "Internal error",
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}