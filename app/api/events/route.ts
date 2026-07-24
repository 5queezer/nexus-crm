import { NextRequest, NextResponse } from "next/server";
import { parseEventQuery } from "@/lib/applications/events";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const values: Record<string, unknown> = Object.fromEntries(request.nextUrl.searchParams.entries());
  const allTypes = request.nextUrl.searchParams.getAll("type");
  if (allTypes.length) values.types = allTypes;
  try {
    const filter = parseEventQuery(values);
    return NextResponse.json(await getDb().listApplicationEventsFiltered(auth.userId, filter));
  } catch (error) {
    const code = error instanceof Error ? error.message : "event_query_invalid";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
