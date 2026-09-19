import { describe, expect, it } from "vitest";
import {
	agentRunEventSchema,
	createEmptyRunSnapshot,
	reduceAgentRunEvents,
	toSseFrame,
} from "../protocol";

const base = {
	eventId: "run-1:1",
	runId: "run-1",
	threadId: "thread-1",
	sequence: 1,
	timestamp: 1_750_000_000_000,
} as const;

describe("agent structured event protocol", () => {
	it("rejects malformed events and accepts a typed state snapshot", () => {
		expect(
			agentRunEventSchema.safeParse({
				...base,
				type: "STATE_SNAPSHOT",
				snapshot: { route: "/opportunities", selectedIds: ["application-1"] },
			}).success,
		).toBe(true);
		expect(
			agentRunEventSchema.safeParse({
				...base,
				type: "TOOL_CALL_START",
				toolCallId: "tool-1",
			}).success,
		).toBe(false);
		expect(
			agentRunEventSchema.safeParse({
				...base,
				type: "ACTIVITY_SNAPSHOT",
				messageId: "activity-1",
				activityType: "progress",
				content: { label: "Working", status: "running", progress: 0.5 },
			}).success,
		).toBe(true);
	});

	it("deduplicates and waits for missing sequences before applying out-of-order events", () => {
		const started = {
			...base,
			type: "RUN_STARTED" as const,
		};
		const content = {
			...base,
			eventId: "run-1:3",
			sequence: 3,
			type: "TEXT_MESSAGE_CONTENT" as const,
			messageId: "message-1",
			delta: "Hello",
		};
		const messageStart = {
			...base,
			eventId: "run-1:2",
			sequence: 2,
			type: "TEXT_MESSAGE_START" as const,
			messageId: "message-1",
			role: "assistant" as const,
		};

		const waiting = reduceAgentRunEvents(
			createEmptyRunSnapshot("run-1", "thread-1"),
			[content, content, started],
		);
		expect(waiting.lastSequence).toBe(1);
		expect(waiting.text).toBe("");
		expect(waiting.pendingSequences).toEqual([3]);

		const complete = reduceAgentRunEvents(waiting, [messageStart, content]);
		expect(complete.lastSequence).toBe(3);
		expect(complete.text).toBe("Hello");
		expect(complete.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
	});

	it("encodes replayable SSE frames with an event id", () => {
		const frame = toSseFrame({ ...base, type: "RUN_STARTED" });
		expect(frame).toContain("id: run-1:1\n");
		expect(frame).toContain('data: {"eventId":"run-1:1"');
		expect(frame.endsWith("\n\n")).toBe(true);
	});
});
