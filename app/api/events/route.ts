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
  let filter;
  try {
    filter = parseEventQuery(values);
  } catch {
    return NextResponse.json({ error: "event_query_invalid" }, { status: 400 });
  }
  try {
    const db = getDb();
    let ownerUserId = auth.userId;
    if (filter.applicationId) {
      const application = await db.getApplication(filter.applicationId, auth.readScopeUserId);
      if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });
      ownerUserId = application.userId;
    }
    return NextResponse.json(await db.listApplicationEventsFiltered(ownerUserId, filter));
  } catch {
    return NextResponse.json({ error: "event_query_failed" }, { status: 500 });
  }
}
