import { NextResponse } from "next/server";
import { requireSessionAuth } from "@/lib/session";
import {
	getAgentRunSnapshot,
	prismaAgentRunEventRepository,
	reconcileStaleAgentRun,
} from "@/lib/agent/run-events";

export async function GET(
	_request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const session = await requireSessionAuth({ allowDevBypass: false });
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await context.params;
	await reconcileStaleAgentRun(
		prismaAgentRunEventRepository,
		session.userId,
		id,
	);
	const snapshot = await getAgentRunSnapshot(
		prismaAgentRunEventRepository,
		session.userId,
		id,
	);
	if (!snapshot) {
		return NextResponse.json({ error: "Run not found" }, { status: 404 });
	}
	return NextResponse.json(
		{ snapshot },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
