import { NextResponse } from "next/server";
import {
  deleteCareerOpsThread,
  getActiveCareerOpsRun,
  requireOwnedThread,
  resolveCareerOpsThreadApplication,
} from "@/lib/career-ops/service";
import {
  careerOpsErrorResponse,
  requireCareerOpsSession,
  unauthorized,
} from "@/lib/career-ops/http";
import { serializeRun, serializeThread } from "@/lib/career-ops/serialize";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();
  try {
    const { id } = await context.params;
    const thread = await requireOwnedThread(session, id);
    const activeRun = await getActiveCareerOpsRun(session, thread.id);
    // The opportunity this conversation acts on, so the drawer can name it
    // instead of showing an unidentified "other opportunity" badge.
    const application = await resolveCareerOpsThreadApplication(session, thread);
    return NextResponse.json(
      {
        thread: serializeThread(thread),
        application,
        activeRun: activeRun ? serializeRun(activeRun) : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();
  try {
    const { id } = await context.params;
    await deleteCareerOpsThread(session, id);
    return NextResponse.json({ deleted: true });
  } catch (reason) {
    return careerOpsErrorResponse(reason);
  }
}
