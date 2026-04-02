import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { TokenPayload } from "@/types/auth";

import PlayerPageClient from "./PlayerPageClient";

export default async function PlayerDashboardPage() {
    const token = (await cookies()).get("token")?.value;

    if (!token) {
        redirect("/login");
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || "") as TokenPayload;

        if (payload.role !== "player" || !payload.id) {
            redirect("/restricted");
        }

        return <PlayerPageClient playerId={payload.id} />;
    } catch {
        redirect("/login");
    }
}