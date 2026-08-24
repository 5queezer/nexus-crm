import { NextResponse } from "next/server";
import { resolveCareerOpsApproval } from "@/lib/career-ops/service";
import type { CareerOpsApprovalChoice } from "@/lib/career-ops/sse";
import {
  careerOpsErrorResponse,
  enforceCareerOpsRateLimit,
  readCareerOpsBody,
  requireCareerOpsSession,
  unauthorized,
} from "@/lib/career-ops/http";

type Context = { params: Promise<{ id: string }> };

const CHOICES: readonly CareerOpsApprovalChoice[] = ["once", "session", "always", "deny"];

export async function POST(request: Request, context: Context) {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();
  // A decision refused by the limiter answered nothing: this runs before the
  // gate is claimed and before Hermes is contacted, so the prompt the browser
  // just cleared is still open and must come back.
  const limited = enforceCareerOpsRateLimit(session, { approvalStillOpen: true });
  if (limited) return limited;

  try {
    const { id } = await context.params;
    const body = await readCareerOpsBody(request);
    // An approval is a human decision: only an explicit, known choice counts.
    // There is no default and no inferred value.
    const choice = body.choice;
    if (typeof choice !== "string" || !CHOICES.includes(choice as CareerOpsApprovalChoice)) {
      return NextResponse.json(
        { error: "invalid_request", message: "Invalid approval decision" },
        { status: 400 },
      );
    }
    // The challenge proves this decision answers the prompt Nexus disclosed.
    // It is required: a decision without one is not an informed decision.
    await resolveCareerOpsApproval(
      session,
      id,
      choice as CareerOpsApprovalChoice,
      body.challenge,
    );
    return NextResponse.json({ resolved: true, choice });
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}
