import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/session";
import {
  createAgentThread,
  listAgentThreads,
  prismaAgentRepository,
} from "@/lib/agent/store";

const createSchema = z.object({ title: z.string().max(100).optional() });

export async function GET() {
  const session = await requireAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const threads = await listAgentThreads(prismaAgentRepository, session.userId);
  return NextResponse.json({ threads });
}

export async function POST(request: Request) {
  const session = await requireAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid thread" }, { status: 400 });
  const thread = await createAgentThread(
    prismaAgentRepository,
    session.userId,
    parsed.data.title ?? "New conversation",
  );
  return NextResponse.json({ thread }, { status: 201 });
}
