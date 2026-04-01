import type { TokenPayload } from "@/types/auth";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const dashboardByRole: Record<TokenPayload["role"], string> = {
  admin: "/dashboard/admin",
  player: "/dashboard/player",
  video_analyst: "/dashboard/video_analyst",
};

function parseTokenPayload(token: string): TokenPayload | null {
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");

    if (typeof verified === "string") {
      return JSON.parse(verified) as TokenPayload;
    }

    return verified as TokenPayload;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const payload = parseTokenPayload(token);

  if (!payload) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const allowedDashboard = dashboardByRole[payload.role];

  if (!allowedDashboard) {
    return NextResponse.redirect(new URL("/restricted", request.url));
  }

  if (pathname === "/dashboard") {
    return NextResponse.redirect(new URL(allowedDashboard, request.url));
  }

  if (pathname.startsWith("/dashboard/") && pathname !== allowedDashboard) {
    return NextResponse.redirect(new URL(allowedDashboard, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*"],
};
