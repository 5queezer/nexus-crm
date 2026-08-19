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
    const messages = await listCareerOpsThreadMessages(session, id);
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}
