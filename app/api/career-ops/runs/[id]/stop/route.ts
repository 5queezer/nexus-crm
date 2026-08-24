import { NextResponse } from "next/server";
import { stopCareerOpsRun } from "@/lib/career-ops/service";
import {
  careerOpsErrorResponse,
  enforceCareerOpsRateLimit,
  requireCareerOpsSession,
  unauthorized,
} from "@/lib/career-ops/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();
  const limited = enforceCareerOpsRateLimit(session);
  if (limited) return limited;
  try {
    const { id } = await context.params;
    await stopCareerOpsRun(session, id);
    return NextResponse.json({ stopping: true });
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}
