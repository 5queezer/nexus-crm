import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// In-memory Prisma double for the MCP OAuth tables. Mirrors the Prisma schema
// defaults that matter for these flows (McpAuthCode.used defaults to false).
const store = vi.hoisted(() => ({
  authCodes: [] as any[],
  accessTokens: [] as any[],
  refreshTokens: [] as any[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpAuthCode: {
      create: async ({ data }: any) => {
        store.authCodes.push({ used: false, createdAt: new Date(), ...data });
        return data;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const c of store.authCodes) {
          if (
            c.code === where.code &&
            c.used === false &&
            c.expiresAt > where.expiresAt.gt &&
            c.clientId === where.clientId &&
            c.redirectUri === where.redirectUri
          ) {
            Object.assign(c, data);
            count++;
          }
        }
        return { count };
      },
      findUnique: async ({ where }: any) =>
        store.authCodes.find((c) => c.code === where.code) ?? null,
    },
    mcpAccessToken: {
      create: async ({ data }: any) => {
        store.accessTokens.push({ ...data });
        return data;
      },
      findUnique: async ({ where }: any) =>
        store.accessTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
    },
    mcpRefreshToken: {
      create: async ({ data }: any) => {
        store.refreshTokens.push({ id: `rt_${store.refreshTokens.length}`, ...data });
        return data;
      },
      findUnique: async ({ where }: any) =>
        store.refreshTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      delete: async ({ where }: any) => {
        const i = store.refreshTokens.findIndex((t) => t.id === where.id);
        if (i >= 0) store.refreshTokens.splice(i, 1);
      },
    },
  },
}));

import { createAuthCode, exchangeAuthCode, exchangeRefreshToken } from "../mcp-oauth";

const sha256 = (d: string) => createHash("sha256").update(d).digest("hex");
const sha256Base64Url = (d: string) => createHash("sha256").update(d).digest("base64url");

function seedRefreshToken(opts: {
  token: string;
  scopes: string[];
  sensitiveConsentVersion: number;
  clientId?: string;
}) {
  store.refreshTokens.push({
    id: "rt_seed",
    tokenHash: sha256(opts.token),
    clientId: opts.clientId ?? "client-1",
    userId: "user-a",
    scopes: opts.scopes,
    sensitiveConsentVersion: opts.sensitiveConsentVersion,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  });
}

describe("MCP OAuth scope elevation", () => {
  beforeEach(() => {
    store.authCodes.length = 0;
    store.accessTokens.length = 0;
    store.refreshTokens.length = 0;
  });

  // Primary deliverable: a full re-authorization that adds mcp:submissions
  // (with sensitive-consent version recorded) must issue a token carrying it.
  it("re-authorization with an added scope issues a token carrying that scope", async () => {
    const codeVerifier = "code-verifier-for-reauth-flow";
    const code = await createAuthCode({
      clientId: "client-1",
      userId: "user-a",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: sha256Base64Url(codeVerifier),
      scopes: ["mcp:tools", "mcp:submissions"],
      sensitiveConsentVersion: 1,
    });

    const tokens = await exchangeAuthCode({
      code,
      clientId: "client-1",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeVerifier,
    });

    expect(tokens && "access_token" in tokens).toBe(true);
    expect(tokens && "scope" in tokens && tokens.scope).toBe("mcp:tools mcp:submissions");

    // The access token must actually enforce-carry the scope for the resource server.
    if (tokens && "access_token" in tokens) {
      const stored = store.accessTokens.find(
        (t) => t.tokenHash === sha256(tokens.access_token),
      );
      expect(stored?.scopes).toEqual(["mcp:tools", "mcp:submissions"]);
    }
  });

  // Regression for the root cause: a refresh MUST NOT widen scope. A client
  // that refreshes a mcp:tools-only grant while asking for mcp:submissions is
  // told to re-authorize (invalid_scope) instead of silently receiving a narrow
  // token it mistakes for success.
  it("rejects a refresh that requests a scope beyond the grant", async () => {
    seedRefreshToken({ token: "mcp_rt_narrow", scopes: ["mcp:tools"], sensitiveConsentVersion: 0 });

    const result = await exchangeRefreshToken({
      refreshToken: "mcp_rt_narrow",
      clientId: "client-1",
      requestedScopes: ["mcp:tools", "mcp:submissions"],
    });

    expect("error" in result && result.error).toBe("invalid_scope");
    // The narrow refresh token must not have been rotated away on a rejected request.
    expect(store.refreshTokens.some((t) => t.tokenHash === sha256("mcp_rt_narrow"))).toBe(true);
  });

  // A legacy grant that stored mcp:submissions but predates the consent-version
  // gate (version 0) is effectively mcp:tools-only, so a refresh asking for
  // submissions is likewise pushed to re-authorization.
  it("treats a pre-consent-version submissions grant as narrow on refresh", async () => {
    seedRefreshToken({
      token: "mcp_rt_legacy",
      scopes: ["mcp:tools", "mcp:submissions"],
      sensitiveConsentVersion: 0,
    });

    const result = await exchangeRefreshToken({
      refreshToken: "mcp_rt_legacy",
      clientId: "client-1",
      requestedScopes: ["mcp:tools", "mcp:submissions"],
    });

    expect("error" in result && result.error).toBe("invalid_scope");
  });

  // Same-scope and omitted-scope refreshes must keep working (no regression).
  it("allows a refresh that requests the same or a narrower scope", async () => {
    seedRefreshToken({
      token: "mcp_rt_full",
      scopes: ["mcp:tools", "mcp:submissions"],
      sensitiveConsentVersion: 1,
    });

    const narrowed = await exchangeRefreshToken({
      refreshToken: "mcp_rt_full",
      clientId: "client-1",
      requestedScopes: ["mcp:tools"],
    });
    expect("scope" in narrowed && narrowed.scope).toBe("mcp:tools");

    // A fully-consented grant with no requested scope keeps its full scope.
    seedRefreshToken({
      token: "mcp_rt_full_2",
      scopes: ["mcp:tools", "mcp:submissions"],
      sensitiveConsentVersion: 1,
    });
    const kept = await exchangeRefreshToken({
      refreshToken: "mcp_rt_full_2",
      clientId: "client-1",
    });
    expect("scope" in kept && kept.scope).toBe("mcp:tools mcp:submissions");
  });
});
