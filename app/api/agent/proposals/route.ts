import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSessionAuth } from "@/lib/session";

export async function GET(request: Request) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId") ?? undefined;
  const proposals = await prisma.actionProposal.findMany({
    where: { userId: session.userId, ...(threadId ? { threadId } : {}) },
    include: { verification: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const publicProposals = proposals.map(({ payload, ...proposal }) => {
    const reviewed = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    return {
      ...proposal,
      sanitizedPayload: proposal.kind === "mcp_tool" && reviewed
        ? {
            toolName: typeof reviewed.toolName === "string" ? reviewed.toolName : undefined,
            connectorName: typeof reviewed.connectorName === "string" ? reviewed.connectorName : undefined,
            connectorUrl: typeof reviewed.connectorUrl === "string" ? reviewed.connectorUrl : undefined,
            connectorVersion:
              typeof reviewed.connectorVersion === "string" ? reviewed.connectorVersion : undefined,
            arguments:
              reviewed.arguments && typeof reviewed.arguments === "object" && !Array.isArray(reviewed.arguments)
                ? reviewed.arguments
                : undefined,
          }
        : null,
    };
  });
  return NextResponse.json({ proposals: publicProposals });
}
