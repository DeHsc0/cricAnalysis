import pool from "@/lib/db"
import { getUserId } from "@/lib/utils"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import VideoAnalystPageClient from "./video-analyst-page-client"

async function resolveCurrentUserId(token: string) {
  const payload = getUserId(token)
  if (!payload?.username) return null

  if (payload.id) return payload.id

  const result = await pool.query(
    "SELECT id FROM users WHERE username = $1 LIMIT 1",
    [payload.username],
  )

  return result.rows[0]?.id ?? null
}

export default async function VideoAnalystPage() {
  const token = (await cookies()).get("token")?.value

  if (!token) {
    redirect("/login")
  }

  const analystId = await resolveCurrentUserId(token)

  if (!analystId) {
    redirect("/login")
  }

  return <VideoAnalystPageClient analystId={analystId} />
}
