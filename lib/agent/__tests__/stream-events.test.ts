import { describe, expect, it } from "vitest";
import { eventsForAiStreamPart } from "../stream-events";

describe("AI SDK to assistant event mapping", () => {
	it("emits complete validated tool arguments only when the SDK reports a tool call", () => {
		expect(
			eventsForAiStreamPart({
				type: "tool-input-delta",
				id: "call-1",
				delta: '{"application',
			}),
		).toEqual([]);

		const events = eventsForAiStreamPart({
			type: "tool-call",
			toolCallId: "call-1",
			toolName: "get_application",
			input: { applicationId: "application-1" },
		});
		expect(events).toEqual([
			{ type: "TOOL_CALL_START", toolCallId: "call-1", toolCallName: "get_application" },
			{ type: "TOOL_CALL_ARGS", toolCallId: "call-1", delta: '{"applicationId":"application-1"}' },
			{ type: "TOOL_CALL_END", toolCallId: "call-1" },
		]);
	});

	it("maps frontend capabilities and bulk previews to typed custom events", () => {
		expect(
			eventsForAiStreamPart({
				type: "tool-result",
				toolCallId: "call-1",
				toolName: "open_opportunity",
				input: {},
				output: {
					frontendCapability: {
						name: "open_record",
						arguments: { applicationId: "application-1", tab: "activity" },
					},
				},
			}),
		).toContainEqual({
			type: "CUSTOM",
			name: "nexus.frontend_tool",
			value: {
				name: "open_record",
				arguments: { applicationId: "application-1", tab: "activity" },
			},
		});

		expect(
			eventsForAiStreamPart({
				type: "tool-result",
				toolCallId: "call-2",
				toolName: "preview_bulk_change",
				input: {},
				output: { bulkCommandId: "command-1", digest: "digest-1" },
			}),
		).toContainEqual({
			type: "CUSTOM",
			name: "nexus.bulk_command",
			value: { commandId: "command-1", digest: "digest-1" },
		});
	});

	it("never puts MCP arguments or provider error details on the event wire", () => {
		const toolEvents = eventsForAiStreamPart({
			type: "tool-call",
			toolCallId: "call-secret",
			toolName: "propose_mcp_tool_call",
			input: {
				connectorId: "connector-1",
				toolName: "search",
				arguments: { apiKey: "must-not-persist", query: "roles" },
				reason: "contains private detail",
			},
		});
		expect(JSON.stringify(toolEvents)).not.toContain("must-not-persist");
		expect(JSON.stringify(toolEvents)).not.toContain("private detail");
		expect(toolEvents).toContainEqual({
			type: "TOOL_CALL_ARGS",
			toolCallId: "call-secret",
			delta: '{"connectorId":"connector-1","toolName":"search","argumentsOmitted":true}',
		});

		const errorEvents = eventsForAiStreamPart({
			type: "error",
			error: new Error("Authorization: Bearer must-not-stream"),
		});
		expect(JSON.stringify(errorEvents)).not.toContain("must-not-stream");

		const resultEvents = eventsForAiStreamPart({
			type: "tool-result",
			toolCallId: "call-result",
			toolName: "get_application",
			input: {},
			output: {
				untrustedExternalContext: {
					notes: "api_key=sk-live-must-not-stream",
				},
			},
		});
		expect(JSON.stringify(resultEvents)).not.toContain("sk-live-must-not-stream");
		expect(JSON.stringify(resultEvents)).toContain("[REDACTED]");
	});
});
