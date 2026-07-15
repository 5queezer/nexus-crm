import { NextResponse } from "next/server";
import { requireSessionAuth } from "@/lib/session";
import {
  ProposalExecutionError,
  prismaProposalExecutionRepository,
  rejectProposal,
} from "@/lib/agent/proposal-executor";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireSessionAuth({ allowDevBypass: false });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    const proposal = await rejectProposal(
      prismaProposalExecutionRepository,
      session.userId,
      id,
    );
    return NextResponse.json({ proposal });
  } catch (error) {
    if (error instanceof ProposalExecutionError) {
      const status = error.code === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Proposal rejection failed" }, { status: 502 });
  }
}
