import { z } from "zod";

const eventBaseSchema = z.object({
	eventId: z.string().min(1).max(160),
	runId: z.string().min(1).max(100),
	threadId: z.string().min(1).max(100),
	sequence: z.number().int().positive(),
	timestamp: z.number().int().nonnegative(),
});

const runStartedSchema = eventBaseSchema.extend({
	type: z.literal("RUN_STARTED"),
});
const textMessageStartSchema = eventBaseSchema.extend({
	type: z.literal("TEXT_MESSAGE_START"),
	messageId: z.string().min(1).max(160),
	role: z.literal("assistant"),
});
const textMessageContentSchema = eventBaseSchema.extend({
	type: z.literal("TEXT_MESSAGE_CONTENT"),
	messageId: z.string().min(1).max(160),
	delta: z.string().max(32_000),
});
const textMessageEndSchema = eventBaseSchema.extend({
	type: z.literal("TEXT_MESSAGE_END"),
	messageId: z.string().min(1).max(160),
});
const toolCallStartSchema = eventBaseSchema.extend({
	type: z.literal("TOOL_CALL_START"),
	toolCallId: z.string().min(1).max(160),
	toolCallName: z.string().min(1).max(200),
});
const toolCallArgsSchema = eventBaseSchema.extend({
	type: z.literal("TOOL_CALL_ARGS"),
	toolCallId: z.string().min(1).max(160),
	delta: z.string().max(64_000),
});
const toolCallEndSchema = eventBaseSchema.extend({
	type: z.literal("TOOL_CALL_END"),
	toolCallId: z.string().min(1).max(160),
});
const toolCallResultSchema = eventBaseSchema.extend({
	type: z.literal("TOOL_CALL_RESULT"),
	messageId: z.string().min(1).max(160),
	toolCallId: z.string().min(1).max(160),
	content: z.string().max(64_000),
	role: z.literal("tool").optional(),
});
const stateSnapshotSchema = eventBaseSchema.extend({
	type: z.literal("STATE_SNAPSHOT"),
	snapshot: z.record(z.string(), z.unknown()),
});
const activitySnapshotSchema = eventBaseSchema.extend({
	type: z.literal("ACTIVITY_SNAPSHOT"),
	messageId: z.string().min(1).max(160),
	activityType: z.enum(["progress", "tool", "review", "result"]),
	content: z.object({
		label: z.string().min(1).max(500),
		status: z.string().min(1).max(100),
		progress: z.number().min(0).max(1).optional(),
		taskId: z.string().min(1).max(100).optional(),
	}),
});
const customSchema = eventBaseSchema.extend({
	type: z.literal("CUSTOM"),
	name: z.enum([
		"nexus.result",
		"nexus.frontend_tool",
		"nexus.bulk_command",
	]),
	value: z.unknown(),
});
const runFinishedSchema = eventBaseSchema.extend({
	type: z.literal("RUN_FINISHED"),
	result: z.unknown().optional(),
});
const runErrorSchema = eventBaseSchema.extend({
	type: z.literal("RUN_ERROR"),
	message: z.string().min(1).max(1_000),
	code: z.string().min(1).max(100).optional(),
});

export const agentRunEventSchema = z.discriminatedUnion("type", [
	runStartedSchema,
	textMessageStartSchema,
	textMessageContentSchema,
	textMessageEndSchema,
	toolCallStartSchema,
	toolCallArgsSchema,
	toolCallEndSchema,
	toolCallResultSchema,
	stateSnapshotSchema,
	activitySnapshotSchema,
	customSchema,
	runFinishedSchema,
	runErrorSchema,
]);

export type AgentRunEvent = z.infer<typeof agentRunEventSchema>;
type EventBase = z.infer<typeof eventBaseSchema>;
export type AgentRunEventPayload = AgentRunEvent extends infer Event
	? Event extends AgentRunEvent
		? Omit<Event, keyof EventBase>
		: never
	: never;

export type AgentToolState = {
	id: string;
	name: string;
	argumentsText: string;
	status: "running" | "input-ready" | "completed" | "failed";
	result?: string;
};

export type AgentRunSnapshot = {
	runId: string;
	threadId: string;
	status: "idle" | "running" | "completed" | "failed";
	lastSequence: number;
	events: AgentRunEvent[];
	pendingEvents: AgentRunEvent[];
	pendingSequences: number[];
	text: string;
	state: Record<string, unknown>;
	activities: Array<Extract<AgentRunEvent, { type: "ACTIVITY_SNAPSHOT" }>>;
	tools: Record<string, AgentToolState>;
	result?: unknown;
	error?: { message: string; code?: string };
};

export function createEmptyRunSnapshot(
	runId: string,
	threadId: string,
): AgentRunSnapshot {
	return {
		runId,
		threadId,
		status: "idle",
		lastSequence: 0,
		events: [],
		pendingEvents: [],
		pendingSequences: [],
		text: "",
		state: {},
		activities: [],
		tools: {},
	};
}

function applyEvent(snapshot: AgentRunSnapshot, event: AgentRunEvent) {
	if (snapshot.status === "failed") return;
	if (snapshot.status === "completed" && event.type !== "RUN_ERROR") return;
	snapshot.events.push(event);
	snapshot.lastSequence = event.sequence;
	switch (event.type) {
		case "RUN_STARTED":
			snapshot.status = "running";
			break;
		case "TEXT_MESSAGE_CONTENT":
			snapshot.text += event.delta;
			break;
		case "STATE_SNAPSHOT":
			snapshot.state = event.snapshot;
			break;
		case "ACTIVITY_SNAPSHOT":
			snapshot.activities.push(event);
			break;
		case "TOOL_CALL_START":
			snapshot.tools[event.toolCallId] = {
				id: event.toolCallId,
				name: event.toolCallName,
				argumentsText: "",
				status: "running",
			};
			break;
		case "TOOL_CALL_ARGS": {
			const tool = snapshot.tools[event.toolCallId];
			if (tool) tool.argumentsText += event.delta;
			break;
		}
		case "TOOL_CALL_END": {
			const tool = snapshot.tools[event.toolCallId];
			if (tool) tool.status = "input-ready";
			break;
		}
		case "TOOL_CALL_RESULT": {
			const tool = snapshot.tools[event.toolCallId];
			if (tool) {
				tool.status = "completed";
				tool.result = event.content;
			}
			break;
		}
		case "CUSTOM":
			if (event.name === "nexus.result") snapshot.result = event.value;
			break;
		case "RUN_FINISHED":
			snapshot.status = "completed";
			if (event.result !== undefined) snapshot.result = event.result;
			break;
		case "RUN_ERROR":
			snapshot.status = "failed";
			snapshot.error = { message: event.message, code: event.code };
			break;
		default:
			break;
	}
}

export function reduceAgentRunEvents(
	current: AgentRunSnapshot,
	incoming: AgentRunEvent[],
): AgentRunSnapshot {
	const byId = new Map<string, AgentRunEvent>();
	for (const event of [
		...current.events,
		...current.pendingEvents,
		...incoming,
	]) {
		const parsed = agentRunEventSchema.safeParse(event);
		if (
			parsed.success &&
			parsed.data.runId === current.runId &&
			parsed.data.threadId === current.threadId
		) {
			byId.set(parsed.data.eventId, parsed.data);
		}
	}
	const ordered = [...byId.values()].sort(
		(left, right) =>
			left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
	);
	const snapshot = createEmptyRunSnapshot(current.runId, current.threadId);
	let expected = 1;
	for (const event of ordered) {
		if (event.sequence < expected) continue;
		if (event.sequence > expected) {
			snapshot.pendingEvents.push(event);
			continue;
		}
		applyEvent(snapshot, event);
		expected += 1;
	}
	snapshot.pendingSequences = snapshot.pendingEvents.map(
		(event) => event.sequence,
	);
	return snapshot;
}

export function toSseFrame(event: AgentRunEvent): string {
	const parsed = agentRunEventSchema.parse(event);
	return `id: ${parsed.eventId}\ndata: ${JSON.stringify(parsed)}\n\n`;
}
