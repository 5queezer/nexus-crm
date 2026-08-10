import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiTokenByHash: vi.fn(),
  touchApiTokenLastUsed: vi.fn(),
  findUnique: vi.fn(),
  hashApiToken: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    getApiTokenByHash: mocks.getApiTokenByHash,
    touchApiTokenLastUsed: mocks.touchApiTokenLastUsed,
  }),
}));
vi.mock("@/lib/token", () => ({ hashApiToken: mocks.hashApiToken }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/mcp-oauth", () => ({ verifyMcpAccessToken: vi.fn() }));
vi.mock("@/lib/cv/generate", () => ({ generateAndStoreCv: vi.fn() }));
vi.mock("@/lib/documents/download", () => ({ downloadDocumentContent: vi.fn() }));
vi.mock("@/lib/documents/upload", () => ({
  uploadDocumentContent: vi.fn(),
  MAX_DOCUMENT_BASE64_SIZE: 1_000_000,
}));
vi.mock("@/lib/documents/service", () => ({ deleteDocumentWithContent: vi.fn() }));

import { authenticateFromRequest } from "../route";

describe("MCP CRM API-token authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashApiToken.mockReturnValue("hashed-token");
    mocks.getApiTokenByHash.mockResolvedValue({ id: "token-1", userId: "admin-1" });
    mocks.findUnique.mockResolvedValue({
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      image: null,
      isAdmin: true,
    });
    mocks.touchApiTokenLastUsed.mockResolvedValue(undefined);
  });

  it("scopes admin CRM API-token reads to the token owner", async () => {
    const request = new NextRequest("https://crm.example/api/mcp", {
      headers: { authorization: "Bearer jt_secret" },
    });

    await expect(authenticateFromRequest(request)).resolves.toMatchObject({
      userId: "admin-1",
      readScopeUserId: "admin-1",
      authType: "api_token",
    });
  });
});
