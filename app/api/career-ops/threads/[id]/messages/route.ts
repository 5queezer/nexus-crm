import { NextResponse } from "next/server";
import { listCareerOpsThreadMessages } from "@/lib/career-ops/service";
import {
  careerOpsErrorResponse,
  requireCareerOpsSession,
  unauthorized,
} from "@/lib/career-ops/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();
  try {
    const { id } = await context.params;
    // Taken before the upstream read, so it is never later than the transcript
    // it describes. The client compares it against the `settledAt` the thread
    // detail reports, to tell whether a run finished after this snapshot was
    // taken — and both must come from this clock. Comparing a server timestamp
    // against `Date.now()` in the browser made the check depend on how far the
    // viewer's clock had drifted.
    const readAt = new Date().toISOString();
    const messages = await listCareerOpsThreadMessages(session, id);
    return NextResponse.json(
      { messages, readAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}
