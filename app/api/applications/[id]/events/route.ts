import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { parseApplicationEventCommand, parseEventQuery } from "@/lib/applications/events";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const application = await db.getApplication(id, auth.userId);
  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const values: Record<string, unknown> = Object.fromEntries(request.nextUrl.searchParams.entries());
  const allTypes = request.nextUrl.searchParams.getAll("type");
  if (allTypes.length) values.types = allTypes;
  try {
    const filter = parseEventQuery({ ...values, applicationId: id });
    return NextResponse.json(await db.listApplicationEventsFiltered(auth.userId, filter));
  } catch (error) {
    const code = error instanceof Error ? error.message : "event_query_invalid";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  let command;
  try {
    command = parseApplicationEventCommand({
      type: body.type,
      occurredAt: body.occurredAt,
      idempotencyKey: body.idempotencyKey,
      expectedUpdatedAt: body.expectedUpdatedAt,
      metadata: body.metadata,
      source: "rest",
      actor: auth.user.email,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "event_invalid";
    return NextResponse.json({ error: code }, { status: 400 });
  }
  if (command.type === "application_submitted") {
    return NextResponse.json(
      { error: "submission_event_requires_submission_workflow" },
      { status: 400 },
    );
  }

  try {
    const result = await getDb().recordApplicationEvent(id, auth.userId, command);
    return NextResponse.json(result, {
      status: result.replayed ? 200 : 201,
      headers: result.replayed ? { "X-Idempotent-Replay": "true" } : undefined,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "event_failed";
    const status = code === "not_found"
      ? 404
      : code === "conflict" || code.includes("idempotency") || code === "application_deleting"
        ? 409
        : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
