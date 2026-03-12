import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/email/encryption";

/**
 * GET /api/email/oauth/callback — handle Google OAuth callback
 * Exchange authorization code for refresh token.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth) {
    return NextResponse.redirect(
      new URL("/settings?error=unauthorized", req.url)
    );
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(error)}`, req.url)
    );
  }

  // CSRF check
  const storedState = req.cookies.get("email_oauth_state")?.value;
  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(
      new URL("/settings?error=invalid_state", req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings?error=no_code", req.url)
    );
  }

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
  const redirectUri = `${baseUrl}/api/email/oauth/callback`;

  // Exchange code for tokens
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResp.ok) {
    return NextResponse.redirect(
      new URL("/settings?error=token_exchange_failed", req.url)
    );
  }

  const tokens = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
  };

  if (!tokens.refresh_token) {
    return NextResponse.redirect(
      new URL("/settings?error=no_refresh_token", req.url)
    );
  }

  // Encrypt and store refresh token
  const encryptedToken = encryptToken(tokens.refresh_token);

  await prisma.emailIntegration.upsert({
    where: { userId: auth.userId },
    create: {
      userId: auth.userId,
      provider: "gmail",
      encryptedToken,
    },
    update: {
      provider: "gmail",
      encryptedToken,
      enabled: true,
      lastHistoryId: null, // Reset cursor on reconnect
    },
  });

  const response = NextResponse.redirect(
    new URL("/settings?email_connected=true", req.url)
  );

  // Clear state cookie
  response.cookies.delete("email_oauth_state");

  return response;
}
