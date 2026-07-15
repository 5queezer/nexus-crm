import { NextResponse } from "next/server";
import { requireSessionAuth } from "@/lib/session";
import {
  deleteAgentThread,
  getAgentThread,
  prismaAgentRepository,
} from "@/lib/agent/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const thread = await getAgentThread(prismaAgentRepository, session.userId, id);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const deleted = await deleteAgentThread(prismaAgentRepository, session.userId, id);
  if (!deleted) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
