import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/session";

export async function GET(request: Request) {
  const session = await requireAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId") ?? undefined;
  const proposals = await prisma.actionProposal.findMany({
    where: { userId: session.userId, ...(threadId ? { threadId } : {}) },
    include: { verification: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ proposals });
}
