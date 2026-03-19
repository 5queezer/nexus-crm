import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode, exchangeRefreshToken, verifyClient } from "@/lib/mcp-oauth";

/**
 * OAuth 2.1 Token Endpoint for MCP.
 * Supports: authorization_code and refresh_token grant types.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  let params: URLSearchParams;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    params = new URLSearchParams(text);
  } else if (contentType.includes("application/json")) {
    const json = await req.json();
    params = new URLSearchParams(json);
  } else {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Unsupported content type" },
      { status: 400 }
    );
  }

  const grantType = params.get("grant_type");
  const clientId = params.get("client_id");
  const clientSecret = params.get("client_secret") ?? undefined;

  if (!clientId) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "client_id is required" },
      { status: 400 }
    );
  }

  // Verify client
  const { valid } = await verifyClient(clientId, clientSecret);
  if (!valid) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Invalid client credentials" },
      { status: 401 }
    );
  }

  if (grantType === "authorization_code") {
    const code = params.get("code");
    const redirectUri = params.get("redirect_uri");
    const codeVerifier = params.get("code_verifier");

    if (!code || !redirectUri || !codeVerifier) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Missing code, redirect_uri, or code_verifier" },
        { status: 400 }
      );
    }

    const tokens = await exchangeAuthCode({
      code,
      clientId,
      redirectUri,
      codeVerifier,
    });

    if (!tokens) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Invalid or expired authorization code" },
        { status: 400 }
      );
    }

    return NextResponse.json(tokens, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (grantType === "refresh_token") {
    const refreshToken = params.get("refresh_token");
    if (!refreshToken) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Missing refresh_token" },
        { status: 400 }
      );
    }

    const tokens = await exchangeRefreshToken({
      refreshToken,
      clientId,
    });

    if (!tokens) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Invalid or expired refresh token" },
        { status: 400 }
      );
    }

    return NextResponse.json(tokens, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    { error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are supported" },
    { status: 400 }
  );
}
