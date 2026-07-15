import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  listAgentThreads: vi.fn(),
  createAgentThread: vi.fn(),
  getAgentThread: vi.fn(),
  deleteAgentThread: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mocks.requireAuth,
  requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/agent/store", () => ({
  prismaAgentRepository: {},
  listAgentThreads: mocks.listAgentThreads,
  createAgentThread: mocks.createAgentThread,
  getAgentThread: mocks.getAgentThread,
  deleteAgentThread: mocks.deleteAgentThread,
}));

import { GET as listThreads, POST as createThread } from "../route";
import { GET as getThread, DELETE as deleteThread } from "../[id]/route";

const context = { params: Promise.resolve({ id: "thread-1" }) };

describe("thread and chat-history route session authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "api_token" });
    mocks.requireSessionAuth.mockImplementation(async (options) => {
      const result = await mocks.requireAuth(options);
      return result?.authType === "session" ? result : null;
    });
    mocks.listAgentThreads.mockResolvedValue([]);
    mocks.getAgentThread.mockResolvedValue(null);
    mocks.deleteAgentThread.mockResolvedValue(false);
  });

  it.each([
    ["thread list", () => listThreads()],
    ["thread creation", () => createThread(new Request("http://test", { method: "POST" }))],
    ["chat history", () => getThread(new Request("http://test"), context)],
    ["thread deletion", () => deleteThread(new Request("http://test"), context)],
  ])("rejects bearer-token authentication for %s", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(401);
  });
});
