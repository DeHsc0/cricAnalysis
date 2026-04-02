import { NextResponse } from "next/server";

function clearTokenCookie(response: NextResponse) {
  response.cookies.set("token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

export async function POST() {
  const response = NextResponse.json(
    {
      success: true,
      message: "Logged out successfully",
    },
    { status: 200 },
  );

  clearTokenCookie(response);
  return response;
}

export async function DELETE() {
  return POST();
}
