import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentThread: {
      findFirst: mocks.findFirst,
    },
  },
}));

import { getAgentThread, prismaAgentRepository } from "../store";

describe("agent activity serialization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns tenant-scoped run/tool metadata and strips all tool inputs", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "thread-1",
      userId: "user-a",
      title: "Audit",
      createdAt: new Date("2026-07-15T09:00:00.000Z"),
      updatedAt: new Date("2026-07-15T09:01:00.000Z"),
      messages: [],
      proposals: [],
      runs: [{
        id: "run-1",
        status: "completed",
        startedAt: new Date("2026-07-15T09:00:00.000Z"),
        finishedAt: new Date("2026-07-15T09:00:01.500Z"),
        toolInvocations: [{
          id: "tool-1",
          runId: "run-1",
          toolName: "propose_mcp_tool_call",
          status: "completed",
          durationMs: 125,
          createdAt: new Date("2026-07-15T09:00:00.500Z"),
          proposal: { id: "proposal-1" },
          input: { nested: { client_secret: "must-not-serialize" } },
        }],
      }],
    });

    const thread = await getAgentThread(prismaAgentRepository, "user-a", "thread-1");

    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "thread-1", userId: "user-a" },
      include: expect.objectContaining({
        runs: expect.objectContaining({
          include: expect.objectContaining({
            toolInvocations: expect.objectContaining({
              select: expect.not.objectContaining({ input: true }),
            }),
          }),
        }),
      }),
    }));
    expect(thread?.activities).toEqual([
      expect.objectContaining({ type: "run", durationMs: 1_500, status: "completed" }),
      expect.objectContaining({
        type: "tool",
        toolName: "propose_mcp_tool_call",
        durationMs: 125,
        proposalId: "proposal-1",
      }),
    ]);
    expect(JSON.stringify(thread)).not.toContain("must-not-serialize");
    expect(JSON.stringify(thread)).not.toContain("client_secret");
  });
});
