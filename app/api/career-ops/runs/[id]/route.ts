import { NextResponse } from "next/server";
import { getCareerOpsRunStatus } from "@/lib/career-ops/service";
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
    const run = await getCareerOpsRunStatus(session, id);
    return NextResponse.json(
      { status: run.status, output: run.output, error: run.error },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}
