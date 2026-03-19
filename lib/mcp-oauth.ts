import { randomBytes, createHash } from "node:crypto";
import { prisma } from "./prisma";
import type { SessionAuthResult, SessionUser } from "./session";

// ── Constants ────────────────────────────────────────────────────────────────

const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function sha256Base64Url(data: string): string {
  return createHash("sha256").update(data).digest("base64url");
}

function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("hex")}`;
}

// ── Dynamic Client Registration ──────────────────────────────────────────────

export async function registerClient(body: {
  redirect_uris: string[];
  client_name?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}) {
  const clientId = `mcp_${randomBytes(16).toString("hex")}`;
  const clientSecret = randomBytes(32).toString("hex");

  const client = await prisma.mcpOAuthClient.create({
    data: {
      clientId,
      clientSecretHash: sha256(clientSecret),
      clientName: body.client_name ?? null,
      redirectUris: body.redirect_uris,
      grantTypes: body.grant_types ?? ["authorization_code", "refresh_token"],
      responseTypes: body.response_types ?? ["code"],
      tokenEndpointAuth: body.token_endpoint_auth_method ?? "client_secret_post",
    },
  });

  return {
    client_id: client.clientId,
    client_secret: clientSecret,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes,
    token_endpoint_auth_method: client.tokenEndpointAuth,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_secret_expires_at: 0, // never expires
  };
}

// ── Authorization Code ───────────────────────────────────────────────────────

export async function createAuthCode(params: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
}): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await prisma.mcpAuthCode.create({
    data: {
      code,
      clientId: params.clientId,
      userId: params.userId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes: params.scopes,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return code;
}

export async function exchangeAuthCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string } | null> {
  const authCode = await prisma.mcpAuthCode.findUnique({
    where: { code: params.code },
  });

  if (!authCode) return null;
  if (authCode.used) return null;
  if (authCode.expiresAt < new Date()) return null;
  if (authCode.clientId !== params.clientId) return null;
  if (authCode.redirectUri !== params.redirectUri) return null;

  // Verify PKCE: S256
  const computedChallenge = sha256Base64Url(params.codeVerifier);
  if (computedChallenge !== authCode.codeChallenge) return null;

  // Mark code as used
  await prisma.mcpAuthCode.update({
    where: { id: authCode.id },
    data: { used: true },
  });

  // Issue tokens
  const accessToken = generateToken("mcp_at");
  const refreshToken = generateToken("mcp_rt");

  await prisma.mcpAccessToken.create({
    data: {
      tokenHash: sha256(accessToken),
      clientId: authCode.clientId,
      userId: authCode.userId,
      scopes: authCode.scopes,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    },
  });

  await prisma.mcpRefreshToken.create({
    data: {
      tokenHash: sha256(refreshToken),
      clientId: authCode.clientId,
      userId: authCode.userId,
      scopes: authCode.scopes,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: authCode.scopes.join(" "),
  };
}

// ── Refresh Token ────────────────────────────────────────────────────────────

export async function exchangeRefreshToken(params: {
  refreshToken: string;
  clientId: string;
}): Promise<{ access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string } | null> {
  const hash = sha256(params.refreshToken);
  const stored = await prisma.mcpRefreshToken.findUnique({
    where: { tokenHash: hash },
  });

  if (!stored) return null;
  if (stored.expiresAt < new Date()) return null;
  if (stored.clientId !== params.clientId) return null;

  // Rotate: delete old refresh token, issue new pair
  await prisma.mcpRefreshToken.delete({ where: { id: stored.id } });

  const newAccessToken = generateToken("mcp_at");
  const newRefreshToken = generateToken("mcp_rt");

  await prisma.mcpAccessToken.create({
    data: {
      tokenHash: sha256(newAccessToken),
      clientId: stored.clientId,
      userId: stored.userId,
      scopes: stored.scopes,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    },
  });

  await prisma.mcpRefreshToken.create({
    data: {
      tokenHash: sha256(newRefreshToken),
      clientId: stored.clientId,
      userId: stored.userId,
      scopes: stored.scopes,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return {
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: stored.scopes.join(" "),
  };
}

// ── Token Verification ───────────────────────────────────────────────────────

export async function verifyMcpAccessToken(
  bearerToken: string
): Promise<SessionAuthResult | null> {
  const hash = sha256(bearerToken);
  const token = await prisma.mcpAccessToken.findUnique({
    where: { tokenHash: hash },
    include: { user: { select: { id: true, name: true, email: true, image: true, isAdmin: true } } },
  });

  if (!token) return null;
  if (token.expiresAt < new Date()) return null;

  const user: SessionUser = {
    id: token.user.id,
    name: token.user.name ?? null,
    email: token.user.email,
    image: token.user.image ?? null,
    isAdmin: token.user.isAdmin,
  };

  return {
    userId: token.user.id,
    readScopeUserId: token.user.isAdmin ? null : token.user.id,
    user,
  };
}

// ── Client Verification ──────────────────────────────────────────────────────

export async function verifyClient(
  clientId: string,
  clientSecret?: string
): Promise<{ valid: boolean; redirectUris: string[] }> {
  const client = await prisma.mcpOAuthClient.findUnique({
    where: { clientId },
  });

  if (!client) return { valid: false, redirectUris: [] };

  // If client has a secret, verify it
  if (client.clientSecretHash && clientSecret) {
    if (sha256(clientSecret) !== client.clientSecretHash) {
      return { valid: false, redirectUris: [] };
    }
  }

  return { valid: true, redirectUris: client.redirectUris };
}

// ── Metadata ─────────────────────────────────────────────────────────────────

export function getOAuthMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/mcp/authorize`,
    token_endpoint: `${baseUrl}/api/mcp/token`,
    registration_endpoint: `${baseUrl}/api/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:tools"],
  };
}

export function getProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:tools"],
    resource_name: "Nexus CRM MCP Server",
  };
}
