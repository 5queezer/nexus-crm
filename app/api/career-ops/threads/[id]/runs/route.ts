import { NextResponse } from "next/server";
import { startCareerOpsRun } from "@/lib/career-ops/service";
import {
  CAREER_OPS_MAX_MESSAGE_LENGTH,
  CAREER_OPS_CLIENT_REQUEST_ID_PATTERN,
} from "@/lib/career-ops/config";
import {
  CareerOpsBodyError,
  careerOpsErrorResponse,
  enforceCareerOpsRateLimit,
  readCareerOpsBody,
  requireCareerOpsSession,
  unauthorized,
} from "@/lib/career-ops/http";
import { serializeRun } from "@/lib/career-ops/serialize";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();
  const limited = enforceCareerOpsRateLimit(session);
  if (limited) return limited;

  try {
    const { id } = await context.params;
    const body = await readCareerOpsBody(request);

    if (typeof body.message !== "string" || typeof body.clientRequestId !== "string") {
      throw new CareerOpsBodyError(400);
    }
    // Bound before anything reaches the service so an oversized payload never
    // becomes an upstream request.
    if (body.message.length > CAREER_OPS_MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: "invalid_request", message: "Message too long" }, { status: 400 });
    }
    if (!CAREER_OPS_CLIENT_REQUEST_ID_PATTERN.test(body.clientRequestId)) {
      return NextResponse.json(
        { error: "invalid_request", message: "Invalid client request id" },
        { status: 400 },
      );
    }

    const run = await startCareerOpsRun(session, id, {
      message: body.message,
      clientRequestId: body.clientRequestId,
    });
    return NextResponse.json({ run: serializeRun(run) }, { status: 202 });
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}
