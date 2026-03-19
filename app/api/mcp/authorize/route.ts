import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAuthCode } from "@/lib/mcp-oauth";

/**
 * OAuth 2.1 Authorization Endpoint for MCP.
 *
 * Flow:
 * 1. Claude.ai redirects user here with client_id, redirect_uri, code_challenge, state
 * 2. If user has a valid better-auth session → issue auth code immediately
 * 3. If not → redirect to login page with a return URL back here
 * 4. After login, user is redirected back here → issue auth code
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const state = url.searchParams.get("state");
  const scope = url.searchParams.get("scope") ?? "mcp:tools";

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

  // Check if user has a valid session (pass request headers for cookie access)
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    // Redirect to login, with a callback back to this authorize URL
    const returnUrl = req.nextUrl.toString();
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("callbackURL", returnUrl);
    return NextResponse.redirect(loginUrl.toString());
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

  // Redirect back to Claude.ai with the auth code
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);

  return NextResponse.redirect(callbackUrl.toString());
}
