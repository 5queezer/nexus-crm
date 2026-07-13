import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { validateEventMetadata } from "@/lib/applications/submission";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(500, rawLimit)) : 100;
  try {
    return NextResponse.json(await getDb().listApplicationEvents(id, auth.userId, limit));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const type = String(body.type ?? "").trim().slice(0, 100);
  if (!type) return NextResponse.json({ error: "type is required" }, { status: 400 });
  const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "occurredAt must be a valid ISO timestamp" }, { status: 400 });
  }
  const idempotencyKey = body.idempotencyKey == null
    ? undefined
    : String(body.idempotencyKey).trim();
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
    return NextResponse.json({ error: "idempotencyKey must contain 8-128 characters" }, { status: 400 });
  }
  try {
    const event = await getDb().createApplicationEvent(id, auth.userId, {
      type,
      occurredAt,
      source: "rest",
      actor: auth.user.email,
      idempotencyKey,
      metadata: validateEventMetadata(body.metadata),
    });
    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "event_failed";
    const status = code === "not_found" ? 404 : code.includes("idempotency") ? 409 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
