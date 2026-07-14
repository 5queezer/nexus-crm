import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDb: vi.fn(),
  approveProposal: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/agent/proposal-executor", () => ({
  approveProposal: mocks.approveProposal,
  prismaProposalExecutionRepository: {},
}));
vi.mock("@/lib/agent/connectors", () => ({ prismaConnectorRepository: {} }));

import { POST } from "../route";

const context = { params: Promise.resolve({ id: "proposal-1" }) };

describe("POST /api/agent/proposals/:id/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-a" });
    mocks.getDb.mockResolvedValue({});
  });

  it("requires authentication", async () => {
    mocks.requireAuth.mockResolvedValue(null);
    const response = await POST(new Request("http://test", { method: "POST" }), context);
    expect(response.status).toBe(401);
    expect(mocks.approveProposal).not.toHaveBeenCalled();
  });

  it("does not return remote MCP or provider error details", async () => {
    mocks.approveProposal.mockRejectedValue(
      new Error("Bearer top-secret-token was rejected by https://mcp.example.com"),
    );
    const response = await POST(new Request("http://test", { method: "POST" }), context);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "Proposal execution failed" });
    expect(JSON.stringify(body)).not.toContain("top-secret-token");
  });
});
