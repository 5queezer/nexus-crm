import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionAuth: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireSessionAuth: mocks.requireSessionAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { actionProposal: { findMany: mocks.findMany } },
}));

import { GET } from "../route";

describe("GET /api/agent/proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSessionAuth.mockResolvedValue({ userId: "user-a", authType: "session" });
  });

  it("returns visible reviewed MCP arguments without internal hashes", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "proposal-1",
        userId: "user-a",
        kind: "mcp_tool",
        payload: {
          toolName: "send_message",
          arguments: { recipient: "person@example.com", body: "Hello" },
          argumentsHash: "internal-argument-hash",
          toolSchemaHash: "internal-schema-hash",
          connectorVersion: "2026-07-14T00:00:00.000Z",
        },
      },
    ]);

    const response = await GET(new Request("http://test/api/agent/proposals"));
    const body = await response.json();
    expect(body.proposals[0]).not.toHaveProperty("payload");
    expect(body.proposals[0].sanitizedPayload).toEqual({
      toolName: "send_message",
      arguments: { recipient: "person@example.com", body: "Hello" },
    });
    expect(JSON.stringify(body)).not.toContain("internal-schema-hash");
  });

  it("rejects requests without a browser session", async () => {
    mocks.requireSessionAuth.mockResolvedValue(null);
    const response = await GET(new Request("http://test/api/agent/proposals"));
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
