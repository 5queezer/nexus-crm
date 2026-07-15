import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  getAgentThread: vi.fn(),
  loadCredentialSecret: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mocks.requireAuth,
  requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agent/credentials", () => ({
  loadCredentialSecret: mocks.loadCredentialSecret,
  prismaCredentialRepository: {},
}));
vi.mock("@/lib/agent/store", () => ({
  getAgentThread: mocks.getAgentThread,
  prismaAgentRepository: {},
  addThreadMessage: vi.fn(),
  completeAgentRun: vi.fn(),
  createAgentRun: vi.fn(),
}));
vi.mock("@/lib/agent/proposals", () => ({ prismaProposalRepository: {} }));
vi.mock("@/lib/agent/connectors", () => ({ prismaConnectorRepository: {} }));

import { POST } from "../route";

function request() {
  return new Request("http://test/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-1",
      provider: "openai",
      message: "Review my pipeline",
    }),
  });
}

describe("POST /api/agent/chat preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "session" });
    mocks.requireSessionAuth.mockImplementation(async (options) => {
      const authResult = await mocks.requireAuth(options);
      return authResult?.authType === "session" ? authResult : null;
    });
  });

  it("rejects bearer-token authentication", async () => {
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "api_token" });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.getAgentThread).not.toHaveBeenCalled();
  });

  it("does not disclose a thread owned by another user", async () => {
    mocks.getAgentThread.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.loadCredentialSecret).not.toHaveBeenCalled();
  });

  it("requires the authenticated user's own provider credential", async () => {
    mocks.getAgentThread.mockResolvedValue({
      id: "thread-1",
      userId: "user-a",
      title: "New conversation",
      messages: [],
      proposals: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.loadCredentialSecret.mockResolvedValue(null);

    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Configure your model credential before starting a run",
    });
    expect(mocks.loadCredentialSecret).toHaveBeenCalledWith({}, "user-a", "openai");
  });
});
