import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import {
  approveProposal,
  prismaProposalExecutionRepository,
} from "@/lib/agent/proposal-executor";
import { prismaConnectorRepository } from "@/lib/agent/connectors";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    const result = await approveProposal({
      repository: prismaProposalExecutionRepository,
      connectorRepository: prismaConnectorRepository,
      db: await getDb(),
      userId: session.userId,
      proposalId: id,
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "Proposal not found" || code === "Proposal target not found") {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }
    if (code === "Proposal expired" || code === "Proposal is stale" || code === "Proposal is not pending") {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    if (code === "Unsupported proposal type" || code === "Invalid MCP proposal payload") {
      return NextResponse.json({ error: "Proposal cannot be applied" }, { status: 400 });
    }
    return NextResponse.json({ error: "Proposal execution failed" }, { status: 502 });
  }
}
