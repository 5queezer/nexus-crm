import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// Minimal row shapes for the in-memory Prisma double.
type AuthCodeRow = {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  sensitiveConsentVersion: number;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
};

type TokenRow = {
  id: string;
  tokenHash: string;
  clientId: string;
  userId: string;
  scopes: string[];
  sensitiveConsentVersion: number;
  expiresAt: Date;
};

// In-memory Prisma double for the MCP OAuth tables. Mirrors the Prisma schema
// defaults that matter for these flows (McpAuthCode.used defaults to false).
const store = vi.hoisted(() => ({
  authCodes: [] as AuthCodeRow[],
  accessTokens: [] as TokenRow[],
  refreshTokens: [] as TokenRow[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpAuthCode: {
      create: async ({ data }: { data: Partial<AuthCodeRow> & { code: string } }) => {
        const row: AuthCodeRow = { used: false, createdAt: new Date(), ...data } as AuthCodeRow;
        store.authCodes.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { code: string; clientId: string; redirectUri: string; expiresAt: { gt: Date } };
        data: Partial<AuthCodeRow>;
      }) => {
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
      findUnique: async ({ where }: { where: { code: string } }) =>
        store.authCodes.find((c) => c.code === where.code) ?? null,
    },
    mcpAccessToken: {
      create: async ({ data }: { data: Omit<TokenRow, "id"> }) => {
        const row: TokenRow = { id: `at_${store.accessTokens.length}`, ...data };
        store.accessTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        store.accessTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
    },
    mcpRefreshToken: {
      create: async ({ data }: { data: Omit<TokenRow, "id"> }) => {
        const row: TokenRow = { id: `rt_${store.refreshTokens.length}`, ...data };
        store.refreshTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        store.refreshTokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
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
    id: `rt_seed_${store.refreshTokens.length}`,
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

  // Narrowing the issued access token must not burn down the underlying grant:
  // the rotated refresh token keeps the original scope, so the client can later
  // re-request the full scope it already consented to.
  it("preserves the original grant when a narrowed refresh is rotated", async () => {
    seedRefreshToken({
      token: "mcp_rt_grant",
      scopes: ["mcp:tools", "mcp:submissions"],
      sensitiveConsentVersion: 1,
    });

    // First refresh narrows to mcp:tools only.
    const narrowed = await exchangeRefreshToken({
      refreshToken: "mcp_rt_grant",
      clientId: "client-1",
      requestedScopes: ["mcp:tools"],
    });
    expect("access_token" in narrowed).toBe(true);
    if (!("refresh_token" in narrowed)) throw new Error("expected rotated refresh token");

    // The access token is narrowed...
    const narrowedAccess = store.accessTokens.find(
      (t) => t.tokenHash === sha256(narrowed.access_token),
    );
    expect(narrowedAccess?.scopes).toEqual(["mcp:tools"]);

    // ...but the rotated refresh token still carries the full grant, so a
    // subsequent refresh can re-request mcp:submissions without re-auth.
    const reElevated = await exchangeRefreshToken({
      refreshToken: narrowed.refresh_token,
      clientId: "client-1",
      requestedScopes: ["mcp:tools", "mcp:submissions"],
    });
    expect("scope" in reElevated && reElevated.scope).toBe("mcp:tools mcp:submissions");
  });
});
