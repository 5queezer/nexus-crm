import { NextResponse } from "next/server";
import { requireSessionAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import {
  approveProposal,
  ProposalExecutionError,
  prismaProposalExecutionRepository,
} from "@/lib/agent/proposal-executor";
import { prismaConnectorRepository } from "@/lib/agent/connectors";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSessionAuth({ allowDevBypass: false });
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
    if (error instanceof ProposalExecutionError) {
      if (error.code === "NOT_FOUND" || error.code === "TARGET_NOT_FOUND") {
        return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      }
      if (
        error.code === "EXPIRED" ||
        error.code === "STALE" ||
        error.code === "NOT_PENDING" ||
        error.code === "IN_PROGRESS"
      ) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error.code === "UNSUPPORTED") {
        return NextResponse.json({ error: "Proposal cannot be applied" }, { status: 400 });
      }
    }
    return NextResponse.json({ error: "Proposal execution failed" }, { status: 502 });
  }
}
