import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHmac } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAuthCode } from "@/lib/mcp-oauth";

const COOKIE_NAME = "mcp_oauth_pending";
const COOKIE_MAX_AGE = 600; // 10 minutes

function getSigningKey(): string {
  // Reuse BETTER_AUTH_SECRET or fall back to a dedicated env var
  const key = process.env.BETTER_AUTH_SECRET ?? process.env.MCP_OAUTH_SECRET;
  if (!key) throw new Error("BETTER_AUTH_SECRET or MCP_OAUTH_SECRET must be set");
  return key;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSigningKey()).update(payload).digest("hex");
}

function verifyAndParse<T>(cookie: string): T | null {
  const idx = cookie.lastIndexOf(".");
  if (idx === -1) return null;
  const payload = cookie.slice(0, idx);
  const sig = cookie.slice(idx + 1);
  if (signPayload(payload) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

type OAuthPending = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
  scope: string;
};

/**
 * OAuth 2.1 Authorization Endpoint for MCP.
 *
 * Flow:
 * 1. Claude.ai redirects user here with client_id, redirect_uri, code_challenge, state
 * 2. Validate params and verify client
 * 3. If user has a valid better-auth session → issue auth code immediately
 * 4. If not → store OAuth params in signed cookie, redirect to login
 * 5. After Google login, better-auth redirects back here → cookie restores params → issue auth code
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;

  // Try to restore params from signed cookie (post-login redirect)
  const pendingCookie = req.cookies.get(COOKIE_NAME)?.value;
  const pending = pendingCookie ? verifyAndParse<OAuthPending>(pendingCookie) : null;

  const clientId = url.searchParams.get("client_id") ?? pending?.client_id;
  const redirectUri = url.searchParams.get("redirect_uri") ?? pending?.redirect_uri;
  const responseType = url.searchParams.get("response_type") ?? (pending ? "code" : null);
  const codeChallenge = url.searchParams.get("code_challenge") ?? pending?.code_challenge;
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const state = url.searchParams.get("state") ?? pending?.state ?? null;
  const scope = url.searchParams.get("scope") ?? pending?.scope ?? "mcp:tools";

  // Validate required params
  if (!clientId || !redirectUri || !codeChallenge) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters (client_id, redirect_uri, code_challenge)" },
      { status: 400 }
    );
  }
  if (responseType !== "code") {
    return NextResponse.json(
      { error: "unsupported_response_type", error_description: "Only 'code' is supported" },
      { status: 400 }
    );
  }
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" },
      { status: 400 }
    );
  }

  // Verify client exists and redirect_uri is registered
  const client = await prisma.mcpOAuthClient.findUnique({
    where: { clientId },
  });
  if (!client) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Unknown client_id" },
      { status: 400 }
    );
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri not registered for this client" },
      { status: 400 }
    );
  }

  // Check if user has a valid session
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    // Store OAuth params in a signed cookie so they survive the Google OAuth redirect
    const payload: OAuthPending = {
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      state,
      scope,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signed = `${encoded}.${signPayload(encoded)}`;

    // Redirect to login — after Google OAuth, better-auth will redirect back here
    const callbackUrl = new URL("/api/mcp/authorize", url.origin);
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("callbackURL", callbackUrl.toString());

    const response = NextResponse.redirect(loginUrl.toString());
    response.cookies.set(COOKIE_NAME, signed, {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/api/mcp/authorize",
    });
    return response;
  }

  // User is authenticated — issue authorization code
  const scopes = scope.split(" ").filter(Boolean);
  const code = await createAuthCode({
    clientId,
    userId: session.user.id,
    redirectUri,
    codeChallenge,
    scopes,
  });

  // Redirect back to Claude.ai with the auth code, clear pending cookie
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(callbackUrl.toString());
  response.cookies.delete(COOKIE_NAME);
  return response;
}
