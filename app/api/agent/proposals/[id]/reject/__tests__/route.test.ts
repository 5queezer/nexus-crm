import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  rejectProposal: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mocks.requireAuth,
  requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/agent/proposal-executor", () => ({
  ProposalExecutionError: class ProposalExecutionError extends Error {},
  prismaProposalExecutionRepository: {},
  rejectProposal: mocks.rejectProposal,
}));

import { POST } from "../route";

const context = { params: Promise.resolve({ id: "proposal-1" }) };

describe("POST /api/agent/proposals/:id/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "api_token" });
    mocks.requireSessionAuth.mockImplementation(async (options) => {
      const result = await mocks.requireAuth(options);
      return result?.authType === "session" ? result : null;
    });
    mocks.rejectProposal.mockResolvedValue({ id: "proposal-1", status: "rejected" });
  });

  it("rejects bearer-token authentication", async () => {
    const response = await POST(new Request("http://test", { method: "POST" }), context);
    expect(response.status).toBe(401);
    expect(mocks.rejectProposal).not.toHaveBeenCalled();
  });
});
