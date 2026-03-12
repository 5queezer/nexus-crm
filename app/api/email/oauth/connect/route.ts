import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { randomBytes } from "node:crypto";

/**
 * GET /api/email/oauth/connect — redirect user to Google OAuth consent
 * with gmail.readonly scope for email scanning.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Bind state to userId to prevent CSRF login attacks
  const state = `${auth.userId}:${randomBytes(16).toString("hex")}`;

  // Store state in a short-lived cookie for CSRF protection
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
  const redirectUri = `${baseUrl}/api/email/oauth/callback`;

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );

  response.cookies.set("email_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
