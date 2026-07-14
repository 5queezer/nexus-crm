import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  getDb: vi.fn(),
  approveProposal: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mocks.requireAuth,
  requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/agent/proposal-executor", () => ({
  approveProposal: mocks.approveProposal,
  ProposalExecutionError: class ProposalExecutionError extends Error {},
  prismaProposalExecutionRepository: {},
}));
vi.mock("@/lib/agent/connectors", () => ({ prismaConnectorRepository: {} }));

import { POST } from "../route";

const context = () => ({ params: Promise.resolve({ id: "proposal-1" }) });

describe("POST /api/agent/proposals/:id/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "session" });
    mocks.requireSessionAuth.mockImplementation(async (options) => {
      const authResult = await mocks.requireAuth(options);
      return authResult?.authType === "session" ? authResult : null;
    });
    mocks.getDb.mockResolvedValue({});
  });

  it("requires authentication", async () => {
    mocks.requireAuth.mockResolvedValue(null);
    const response = await POST(new Request("http://test", { method: "POST" }), context());
    expect(response.status).toBe(401);
    expect(mocks.approveProposal).not.toHaveBeenCalled();
  });

  it("rejects bearer-token authentication", async () => {
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "api_token" });
    const response = await POST(new Request("http://test", { method: "POST" }), context());
    expect(response.status).toBe(401);
    expect(mocks.approveProposal).not.toHaveBeenCalled();
  });

  it("does not return remote MCP or provider error details", async () => {
    mocks.approveProposal.mockRejectedValue(
      new Error("Bearer top-secret-token was rejected by https://mcp.example.com"),
    );
    const response = await POST(new Request("http://test", { method: "POST" }), context());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "Proposal execution failed" });
    expect(JSON.stringify(body)).not.toContain("top-secret-token");
  });
});
