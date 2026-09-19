import { NextResponse } from "next/server";
import { requireSessionAuth } from "@/lib/session";
import { toSseFrame } from "@/lib/agent/protocol";
import { prismaAgentRunEventRepository } from "@/lib/agent/run-events";

function sequenceFromCursor(value: string | null, runId: string): number {
	if (!value) return 0;
	const prefix = `${runId}:`;
	if (!value.startsWith(prefix)) return 0;
	const sequence = Number(value.slice(prefix.length));
	return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0;
}

export async function GET(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const session = await requireSessionAuth({ allowDevBypass: false });
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await context.params;
	const events = await prismaAgentRunEventRepository.listOwned(session.userId, id);
	if (events === null) {
		return NextResponse.json({ error: "Run not found" }, { status: 404 });
	}
	const url = new URL(request.url);
	const afterQuery = Number(url.searchParams.get("after") ?? 0);
	const afterHeader = sequenceFromCursor(request.headers.get("last-event-id"), id);
	const after = Math.max(
		Number.isSafeInteger(afterQuery) && afterQuery > 0 ? afterQuery : 0,
		afterHeader,
	);
	const body = events
		.filter((event) => event.sequence > after)
		.sort((left, right) => left.sequence - right.sequence)
		.map(toSseFrame)
		.join("");
	return new Response(body, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-store",
			Connection: "keep-alive",
		},
	});
}
