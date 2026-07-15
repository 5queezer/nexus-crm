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

import type { ProposalRepository } from "../proposals";
import { buildMcpAgentTools } from "../runtime";

const connector = {
	id: "connector-1",
	name: "Research",
	url: "https://mcp.example.com",
	authorization: null,
	updatedAt: new Date("2026-07-15T00:00:00.000Z"),
};

const discoveredTool = {
	name: "research__search",
	remoteName: "search",
	inputSchema: {
		type: "object",
		properties: { query: { type: "string" } },
		required: ["query"],
		additionalProperties: false,
	},
};

function buildExecutor(proposalRepository: {
	create: ReturnType<typeof vi.fn>;
	findByIdempotencyKey: ReturnType<typeof vi.fn>;
}) {
	return buildMcpAgentTools({
		connectorRepository: {} as never,
		proposalRepository: proposalRepository as unknown as ProposalRepository,
		userId: "user-a",
		threadId: "thread-1",
		runId: "run-1",
	}).propose_mcp_tool_call.execute!;
}

describe("MCP runtime audit persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.create.mockResolvedValue({ id: "invocation-1" });
		mocks.update.mockResolvedValue({});
		mocks.getConnectorSecret.mockResolvedValue(connector);
		mocks.discoverMcpTools.mockResolvedValue([discoveredTool]);
	});

	it.each([
		{
			label: "sensitive key",
			secret: "audit-must-never-see-this-key-value",
			arguments: {
				query: "roles",
				nested: { client_secret: "audit-must-never-see-this-key-value" },
			},
			error: "MCP arguments contain a sensitive field",
		},
		{
			label: "sensitive value",
			secret: "Bearer audit-must-never-see-this-value",
			arguments: {
				query: "roles",
				nested: ["Bearer audit-must-never-see-this-value"],
			},
			error: "MCP arguments contain a sensitive value",
		},
	])("creates one failed omission-only audit and no proposal for a rejected $label", async ({
		secret,
		arguments: rejectedArguments,
		error,
	}) => {
		const proposalRepository = {
			create: vi.fn(),
			findByIdempotencyKey: vi.fn(),
		};
		const execute = buildExecutor(proposalRepository);

		await expect(
			execute(
				{
					connectorId: "connector-requested",
					toolName: "research__search",
					arguments: rejectedArguments,
					reason: "raw reason must stay out of the audit",
				},
				{ toolCallId: "call-rejected", messages: [] } as never,
			),
		).rejects.toThrow(error);

		expect(mocks.create).toHaveBeenCalledTimes(1);
		expect(mocks.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				toolName: "propose_mcp_tool_call",
				kind: "proposal",
				input: {
					connectorId: "connector-requested",
					toolName: "research__search",
					argumentsOmitted: true,
				},
			}),
		});
		expect(mocks.update).toHaveBeenCalledTimes(1);
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "invocation-1" },
			data: expect.objectContaining({ status: "failed", errorCode: "Error" }),
		});
		expect(proposalRepository.create).not.toHaveBeenCalled();
		const persistedAudit = JSON.stringify(mocks.create.mock.calls);
		expect(persistedAudit).not.toContain(secret);
		expect(persistedAudit).not.toContain(
			"raw reason must stay out of the audit",
		);
		expect(persistedAudit).not.toContain("client_secret");
	});

	it("persists exact canonical proposal arguments bound to the looked-up connector identity", async () => {
		const proposalRepository = {
			create: vi
				.fn()
				.mockResolvedValue({ id: "proposal-1", status: "pending" }),
			findByIdempotencyKey: vi.fn(),
		};
		const execute = buildExecutor(proposalRepository);

		await execute(
			{
				connectorId: "connector-requested",
				toolName: "research__search",
				arguments: { query: "roles" },
				reason: "Search the selected source",
			},
			{ toolCallId: "call-valid", messages: [] } as never,
		);

		expect(mocks.create).toHaveBeenCalledTimes(1);
		expect(mocks.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				input: {
					connectorId: "connector-requested",
					toolName: "research__search",
					argumentsOmitted: true,
				},
			}),
		});
		expect(proposalRepository.create).toHaveBeenCalledTimes(1);
		expect(proposalRepository.create).toHaveBeenCalledWith(
			expect.objectContaining({
				toolInvocationId: "invocation-1",
				targetType: "mcp_connector",
				targetId: "connector-1",
				payload: expect.objectContaining({
					connectorVersion: "2026-07-15T00:00:00.000Z",
					connectorName: "Research",
					connectorUrl: "https://mcp.example.com",
					toolName: "search",
					arguments: { query: "roles" },
				}),
			}),
		);
		expect(mocks.update).toHaveBeenCalledTimes(1);
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "invocation-1" },
			data: expect.objectContaining({ status: "completed" }),
		});
		expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(
			"Search the selected source",
		);
	});
});
