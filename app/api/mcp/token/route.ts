import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode, exchangeRefreshToken, verifyClient } from "@/lib/mcp-oauth";

/**
 * OAuth 2.1 Token Endpoint for MCP.
 * Supports: authorization_code and refresh_token grant types.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  const rawAuth = req.headers.get("authorization");
  let params: URLSearchParams;
  let rawBody = "";

  if (contentType.includes("application/json")) {
    rawBody = await req.text();
    try {
      const json = JSON.parse(rawBody);
      params = new URLSearchParams();
      for (const [key, value] of Object.entries(json)) {
        if (typeof value === "string") {
          params.set(key, value);
        }
      }
    } catch {
      params = new URLSearchParams();
    }
  } else {
    // Default to form-urlencoded — RFC 6749 §4.1.3 mandates it. Some clients
    // omit or send odd charsets, so don't reject on Content-Type alone.
    rawBody = await req.text();
    params = new URLSearchParams(rawBody);
  }

  console.log(
    "[mcp/token] req:",
    JSON.stringify({
      contentType,
      hasAuthHeader: !!rawAuth,
      authScheme: rawAuth?.split(" ")[0] ?? null,
      bodyKeys: [...params.keys()],
      grant_type: params.get("grant_type"),
      client_id: params.get("client_id"),
      redirect_uri: params.get("redirect_uri"),
      has_code: !!params.get("code"),
      has_code_verifier: !!params.get("code_verifier"),
      bodyLen: rawBody.length,
    })
  );

  const grantType = params.get("grant_type");

  // RFC 6749 §2.3.1: clients MAY use HTTP Basic auth (`client_secret_basic`)
  // OR include credentials in the request body (`client_secret_post`).
  // ChatGPT and several other connectors default to Basic; accept both.
  let clientId = params.get("client_id");
  let clientSecret = params.get("client_secret") ?? undefined;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const headerId = decodeURIComponent(decoded.slice(0, sep));
        const headerSecret = decodeURIComponent(decoded.slice(sep + 1));
        clientId = clientId ?? headerId;
        clientSecret = clientSecret ?? headerSecret;
      }
    } catch {
      // Malformed Basic header — fall through to invalid_client below
    }
  }

  if (!clientId) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "client_id is required" },
      { status: 400 }
    );
  }

  // Verify client
  const { valid } = await verifyClient(clientId, clientSecret);
  if (!valid) {
    console.warn("[mcp/token] verifyClient failed:", JSON.stringify({ clientId, hasSecret: !!clientSecret }));
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
      console.warn(
        "[mcp/token] exchangeAuthCode rejected:",
        JSON.stringify({ clientId, redirectUri, codeLen: code.length, verifierLen: codeVerifier.length })
      );
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
