import { NextResponse } from "next/server";
import {
  createCareerOpsThread,
  listCareerOpsThreads,
} from "@/lib/career-ops/service";
import { CAREER_OPS_MAX_TITLE_LENGTH } from "@/lib/career-ops/config";
import {
  careerOpsErrorResponse,
  enforceCareerOpsRateLimit,
  optionalString,
  readCareerOpsBody,
  requireCareerOpsSession,
  unauthorized,
} from "@/lib/career-ops/http";
import { serializeThread } from "@/lib/career-ops/serialize";

export async function GET() {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();
  try {
    const threads = await listCareerOpsThreads(session);
    return NextResponse.json(
      { threads: threads.map(serializeThread) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}

export async function POST(request: Request) {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();
  const limited = enforceCareerOpsRateLimit(session);
  if (limited) return limited;

  try {
    const body = await readCareerOpsBody(request);
    const thread = await createCareerOpsThread(session, {
      title: optionalString(body.title, CAREER_OPS_MAX_TITLE_LENGTH),
      applicationId: optionalString(body.applicationId, 64) ?? null,
    });
    return NextResponse.json({ thread: serializeThread(thread) }, { status: 201 });
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}
