import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import {
  prismaProposalExecutionRepository,
  rejectProposal,
} from "@/lib/agent/proposal-executor";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth({ allowDevBypass: false });
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
    const message = error instanceof Error ? error.message : "Proposal rejection failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Proposal not found" ? 404 : 409 },
    );
  }
}
