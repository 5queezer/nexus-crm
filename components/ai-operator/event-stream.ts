import {
	agentRunEventSchema,
	type AgentRunEvent,
} from "@/lib/agent/protocol";

export async function* readAgentEventStream(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentRunEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const data = frame
					.split("\n")
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				if (data) {
					try {
						const parsed = agentRunEventSchema.safeParse(JSON.parse(data));
						if (parsed.success) yield parsed.data;
					} catch {
						// Malformed or partial frames are untrusted transport input.
					}
				}
				boundary = buffer.indexOf("\n\n");
			}
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}
}
