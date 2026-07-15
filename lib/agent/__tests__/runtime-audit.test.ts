import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  discoverMcpTools: vi.fn(),
  getConnectorSecret: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentToolInvocation: {
      create: mocks.create,
      update: mocks.update,
    },
  },
}));
vi.mock("../mcp-client", () => ({ discoverMcpTools: mocks.discoverMcpTools }));
vi.mock("../connectors", () => ({
  getConnectorSecret: mocks.getConnectorSecret,
  listConnectorMetadata: vi.fn(),
}));

import { buildMcpAgentTools } from "../runtime";

function toolExecutor() {
  const tools = buildMcpAgentTools({
    connectorRepository: {} as never,
    proposalRepository: { create: vi.fn(), findByIdempotencyKey: vi.fn() },
    userId: "user-a",
    threadId: "thread-1",
    runId: "run-1",
  });
  return tools.propose_mcp_tool_call.execute!;
}

describe("MCP runtime audit persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectorSecret.mockResolvedValue({
      id: "connector-1",
      name: "Research",
      url: "https://mcp.example.com",
      authorization: null,
      updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    });
    mocks.discoverMcpTools.mockResolvedValue([{
      name: "research__search",
      remoteName: "search",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    }]);
  });

  it("never sends nested secret-bearing rejected arguments to the audit repository", async () => {
    const execute = toolExecutor();
    const rejected = {
      connectorId: "connector-1",
      toolName: "research__search",
      arguments: {
        query: "roles",
        nested: { client_secret: "audit-must-never-see-this" },
      },
      reason: "Search",
    };

    await expect(execute(rejected, { toolCallId: "call-1", messages: [] } as never)).rejects.toThrow(
      "MCP arguments contain a sensitive field",
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain("audit-must-never-see-this");
  });

  it("persists only canonical validated MCP metadata and arguments", async () => {
    mocks.create.mockResolvedValue({ id: "invocation-1" });
    const proposalRepository = {
      create: vi.fn().mockResolvedValue({ id: "proposal-1", status: "pending" }),
      findByIdempotencyKey: vi.fn(),
    };
    const execute = buildMcpAgentTools({
      connectorRepository: {} as never,
      proposalRepository,
      userId: "user-a",
      threadId: "thread-1",
      runId: "run-1",
    }).propose_mcp_tool_call.execute!;

    await execute({
      connectorId: "connector-1",
      toolName: "research__search",
      arguments: { query: "roles" },
      reason: "Not part of audit input",
    }, { toolCallId: "call-2", messages: [] } as never);

    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      input: expect.objectContaining({
        connectorId: "connector-1",
        toolName: "search",
        arguments: { query: "roles" },
      }),
    }) });
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain("Not part of audit input");
  });
});
