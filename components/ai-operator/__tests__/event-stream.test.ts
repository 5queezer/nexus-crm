import { describe, expect, it } from "vitest";
import { readAgentEventStream } from "../event-stream";

describe("assistant event stream reader", () => {
	it("validates, orders, and deduplicates fragmented SSE delivery", async () => {
		const encoder = new TextEncoder();
		const frames = [
			'id: run-1:2\ndata: {"eventId":"run-1:2","runId":"run-1","threadId":"thread-1","sequence":2,"timestamp":2,"type":"TEXT_MESSAGE_START","messageId":"message-1","role":"assistant"}\n\n',
			'id: run-1:1\ndata: {"eventId":"run-1:1","runId":"run-1","threadId":"thread-1","sequence":1,"timestamp":1,"type":"RUN_STARTED"}\n\n',
			'id: run-1:2\ndata: {"eventId":"run-1:2","runId":"run-1","threadId":"thread-1","sequence":2,"timestamp":2,"type":"TEXT_MESSAGE_START","messageId":"message-1","role":"assistant"}\n\n',
		];
		const joined = frames.join("");
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(joined.slice(0, 37)));
				controller.enqueue(encoder.encode(joined.slice(37)));
				controller.close();
			},
		});

		const events = [];
		for await (const event of readAgentEventStream(stream)) events.push(event);

		expect(events.map((event) => event.sequence)).toEqual([2, 1, 2]);
	});

	it("drops malformed frames rather than treating them as trusted events", async () => {
		const stream = new Response(
			'data: {"type":"TOOL_CALL_START","toolCallId":"missing-name"}\n\n',
		).body!;
		const events = [];
		for await (const event of readAgentEventStream(stream)) events.push(event);
		expect(events).toEqual([]);
	});
});
