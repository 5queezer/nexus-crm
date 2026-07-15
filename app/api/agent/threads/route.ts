import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionAuth } from "@/lib/session";
import {
  createAgentThread,
  listAgentThreads,
  prismaAgentRepository,
} from "@/lib/agent/store";
import { agentRequestErrorResponse, readBoundedJson } from "@/lib/agent/request";

const createSchema = z.object({ title: z.string().max(100).optional() });

export async function GET() {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const threads = await listAgentThreads(prismaAgentRepository, session.userId);
  return NextResponse.json({ threads });
}

export async function POST(request: Request) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    return agentRequestErrorResponse(error) ?? NextResponse.json({ error: "Invalid thread" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid thread" }, { status: 400 });
  const thread = await createAgentThread(
    prismaAgentRepository,
    session.userId,
    parsed.data.title ?? "New conversation",
  );
  return NextResponse.json({ thread }, { status: 201 });
}
