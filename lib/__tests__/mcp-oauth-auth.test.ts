import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findAccessToken: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpAccessToken: { findUnique: mocks.findAccessToken },
  },
}));

import { verifyMcpAccessToken } from "../mcp-oauth";

describe("MCP OAuth account eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOWED_EMAIL;
    mocks.findAccessToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      scopes: ["mcp:tools"],
      sensitiveConsentVersion: 1,
      user: {
        id: "admin-1",
        name: "Admin",
        email: "admin@example.com",
        image: null,
        isAdmin: true,
      },
    });
  });

  it("rejects an existing MCP token after its user is removed from ALLOWED_EMAIL", async () => {
    process.env.ALLOWED_EMAIL = "allowed@example.com";
    await expect(verifyMcpAccessToken("mcp_at_existing")).resolves.toBeNull();
  });

  it("keeps administrator MCP tokens scoped to their own tenant", async () => {
    await expect(verifyMcpAccessToken("mcp_at_admin")).resolves.toMatchObject({
      userId: "admin-1",
      readScopeUserId: "admin-1",
      authType: "mcp_oauth",
    });
  });
});
