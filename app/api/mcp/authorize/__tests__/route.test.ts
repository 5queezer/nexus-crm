import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireSessionAuth: vi.fn(),
  getSession: vi.fn(),
  findClient: vi.fn(),
  createAuthCode: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireSessionAuth: mocks.requireSessionAuth }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { mcpOAuthClient: { findUnique: mocks.findClient } },
}));
vi.mock("@/lib/mcp-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp-oauth")>();
  return { ...actual, createAuthCode: mocks.createAuthCode };
});

import { GET } from "../route";

function authorizationRequest(scope = "mcp:tools") {
  const url = new URL("https://nexus.example/api/mcp/authorize");
  url.searchParams.set("client_id", "client-1");
  url.searchParams.set("redirect_uri", "https://client.example/callback");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", "challenge");
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", "state-1");
  return new NextRequest(url);
}

describe("GET /api/mcp/authorize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BETTER_AUTH_SECRET = "test-secret-that-is-long-enough";
    mocks.findClient.mockResolvedValue({
      clientId: "client-1",
      clientName: "Test Client",
      redirectUris: ["https://client.example/callback"],
    });
    mocks.requireSessionAuth.mockResolvedValue({
      userId: "user-1",
      user: { id: "user-1", email: "user@example.com" },
      authType: "session",
    });
    mocks.getSession.mockResolvedValue({ user: { id: "user-1", email: "user@example.com" } });
  });

  it("requires explicit consent for a newly requested base tools grant", async () => {
    const response = await GET(authorizationRequest());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Test Client");
    expect(html).toContain("Allow access");
    expect(html).toContain("client.example");
    expect(mocks.createAuthCode).not.toHaveBeenCalled();
  });

  it("issues a code only after the signed, transaction-bound approval is followed", async () => {
    mocks.createAuthCode.mockResolvedValue("auth-code-1");
    const consentPage = await GET(authorizationRequest());
    const html = await consentPage.text();
    const href = html.match(/href="([^"]+)">Allow access<\/a>/)?.[1]?.replace(/&amp;/g, "&");
    expect(href).toBeTruthy();

    const response = await GET(new NextRequest(href!));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("code=auth-code-1");
    expect(mocks.createAuthCode).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client-1",
      userId: "user-1",
      scopes: ["mcp:tools"],
    }));
  });

  it("uses the application session boundary so removed users cannot authorize", async () => {
    mocks.requireSessionAuth.mockResolvedValue(null);
    mocks.getSession.mockResolvedValue(null);

    const response = await GET(authorizationRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
    expect(mocks.requireSessionAuth).toHaveBeenCalledWith({ allowDevBypass: false });
    expect(mocks.createAuthCode).not.toHaveBeenCalled();
  });
});
