import { z } from "zod";
import type { AgentRunEventPayload } from "./protocol";
import { frontendCapabilityCommandSchema } from "@/lib/assistant/frontend-capabilities";

const streamPartSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("text-start"), id: z.string() }).passthrough(),
	z.object({ type: z.literal("text-delta"), id: z.string(), text: z.string() }).passthrough(),
	z.object({ type: z.literal("text-end"), id: z.string() }).passthrough(),
	z.object({ type: z.literal("tool-input-delta") }).passthrough(),
	z.object({
		type: z.literal("tool-call"),
		toolCallId: z.string(),
		toolName: z.string(),
		input: z.unknown(),
	}).passthrough(),
	z.object({
		type: z.literal("tool-result"),
		toolCallId: z.string(),
		toolName: z.string(),
		output: z.unknown(),
	}).passthrough(),
	z.object({
		type: z.literal("tool-error"),
		toolCallId: z.string(),
		toolName: z.string(),
		error: z.unknown(),
	}).passthrough(),
	z.object({ type: z.literal("start-step") }).passthrough(),
	z.object({ type: z.literal("finish-step") }).passthrough(),
	z.object({ type: z.literal("error"), error: z.unknown() }).passthrough(),
]);

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value).slice(0, 64_000);
	} catch {
		return JSON.stringify({ unavailable: true });
	}
}

const SENSITIVE_KEY =
	/(?:authorization|api[_-]?key|token|secret|password|private[_-]?key|credential)/i;

function eventSafeToolInput(toolName: string, input: unknown): unknown {
	const record = outputRecord(input);
	if (toolName === "propose_mcp_tool_call" && record) {
		return {
			connectorId: record.connectorId,
			toolName: record.toolName,
			argumentsOmitted: true,
		};
	}
	if (Array.isArray(input)) {
		return input.slice(0, 2_000).map((value) => eventSafeToolInput(toolName, value));
	}
	if (record) {
		return Object.fromEntries(
			Object.entries(record).map(([key, value]) => [
				key,
				SENSITIVE_KEY.test(key)
					? "[REDACTED]"
					: eventSafeToolInput(toolName, value),
			]),
		);
	}
	if (typeof input === "string") {
		return input
			.replace(/(authorization\s*:\s*bearer\s+)\S+/gi, "$1[REDACTED]")
			.replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
			.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
			.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED]")
			.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[REDACTED]");
	}
	return input;
}

function outputRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function eventsForAiStreamPart(part: unknown): AgentRunEventPayload[] {
	const parsed = streamPartSchema.safeParse(part);
	if (!parsed.success) return [];
	const value = parsed.data;
	switch (value.type) {
		case "text-start":
			return [{ type: "TEXT_MESSAGE_START", messageId: value.id, role: "assistant" }];
		case "text-delta":
			return [{ type: "TEXT_MESSAGE_CONTENT", messageId: value.id, delta: value.text }];
		case "text-end":
			return [{ type: "TEXT_MESSAGE_END", messageId: value.id }];
		case "tool-input-delta":
			return [];
		case "tool-call":
			return [
				{ type: "TOOL_CALL_START", toolCallId: value.toolCallId, toolCallName: value.toolName },
				{ type: "TOOL_CALL_ARGS", toolCallId: value.toolCallId, delta: safeStringify(eventSafeToolInput(value.toolName, value.input)) },
				{ type: "TOOL_CALL_END", toolCallId: value.toolCallId },
			];
		case "tool-result": {
			const events: AgentRunEventPayload[] = [
				{
					type: "TOOL_CALL_RESULT",
					messageId: `tool-result-${value.toolCallId}`,
					toolCallId: value.toolCallId,
					content: safeStringify(eventSafeToolInput(value.toolName, value.output)),
					role: "tool",
				},
			];
			const output = outputRecord(value.output);
			const capability = frontendCapabilityCommandSchema.safeParse(
				output?.frontendCapability,
			);
			if (capability.success) {
				events.push({
					type: "CUSTOM",
					name: "nexus.frontend_tool",
					value: capability.data,
				});
			}
			if (
				typeof output?.bulkCommandId === "string" &&
				typeof output.digest === "string"
			) {
				events.push({
					type: "CUSTOM",
					name: "nexus.bulk_command",
					value: {
						commandId: output.bulkCommandId,
						digest: output.digest,
					},
				});
			}
			return events;
		}
		case "tool-error":
			return [
				{
					type: "TOOL_CALL_RESULT",
					messageId: `tool-error-${value.toolCallId}`,
					toolCallId: value.toolCallId,
					content: safeStringify({ error: "Tool execution failed" }),
					role: "tool",
				},
			];
		case "start-step":
			return [{
				type: "ACTIVITY_SNAPSHOT",
				messageId: `step-${Date.now()}`,
				activityType: "progress",
				content: {
					label: "Working on the request",
					status: "running",
				},
			}];
		case "finish-step":
			return [];
		case "error":
			return [{
				type: "RUN_ERROR",
				message: "The model run failed",
				code: value.error instanceof Error ? value.error.name.slice(0, 100) : "ProviderError",
			}];
	}
}
