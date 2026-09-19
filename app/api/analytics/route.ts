import { NextRequest, NextResponse } from "next/server";
import { decodeEventCursor } from "@/lib/applications/events";
import { buildAnalyticsSnapshot } from "@/lib/analytics/metrics";
import { getDb } from "@/lib/db";
import type { ApplicationEventRecord } from "@/lib/db/types";
import { requireAuth } from "@/lib/session";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ANALYTICS_EVENT_TYPES = [
  "application_submitted",
  "recruiter_contacted",
  "outbound_contact_recorded",
  "reply_received",
  "stage_changed",
  "interview_invited",
  "interview_scheduled",
  "interview_completed",
  "offer_received",
] as const;

function parseDateOnly(value: string | null, fallback: Date, endOfDay = false): Date {
  if (value === null) return fallback;
  if (!DATE_PATTERN.test(value)) throw new Error("analytics_filter_invalid");
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("analytics_filter_invalid");
  }
  return date;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function listAllAnalyticsEvents(userId: string, cutoff: Date): Promise<ApplicationEventRecord[]> {
  const db = getDb();
  const items: ApplicationEventRecord[] = [];
  let cursor: ReturnType<typeof decodeEventCursor> | undefined;
  const seenCursors = new Set<string>();
  do {
    const page = await db.listApplicationEventsFiltered(userId, {
      types: [...ANALYTICS_EVENT_TYPES],
      occurredBefore: cutoff,
      order: "oldest",
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    if (!page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) throw new Error("analytics_event_cursor_repeated");
    seenCursors.add(page.nextCursor);
    cursor = decodeEventCursor(page.nextCursor);
  } while (cursor);
  return items;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const defaultEnd = new Date(`${dateOnly(now)}T23:59:59.999Z`);
  const defaultStart = new Date(defaultEnd);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 89);
  defaultStart.setUTCHours(0, 0, 0, 0);

  let start: Date;
  let end: Date;
  let source: string | null;
  let includeArchived: boolean;
  try {
    start = parseDateOnly(request.nextUrl.searchParams.get("start"), defaultStart);
    end = parseDateOnly(request.nextUrl.searchParams.get("end"), defaultEnd, true);
    if (start > end) throw new Error("analytics_filter_invalid");
    const sourceValue = request.nextUrl.searchParams.get("source")?.trim() ?? "";
    if (sourceValue.length > 255) throw new Error("analytics_filter_invalid");
    source = sourceValue || null;
    const archivedValue = request.nextUrl.searchParams.get("includeArchived");
    if (archivedValue !== null && archivedValue !== "true" && archivedValue !== "false") {
      throw new Error("analytics_filter_invalid");
    }
    includeArchived = archivedValue !== "false";
  } catch {
    return NextResponse.json({ error: "analytics_filter_invalid" }, { status: 400 });
  }

  try {
    const db = getDb();
    const [applications, events] = await Promise.all([
      db.listApplications(auth.userId),
      listAllAnalyticsEvents(auth.userId, now),
    ]);
    const snapshot = buildAnalyticsSnapshot(applications, events, {
      start,
      end,
      cutoff: now,
      includeArchived,
      source,
    });
    return NextResponse.json({
      filters: {
        start: dateOnly(start),
        end: dateOnly(end),
        cutoff: now.toISOString(),
        source,
        includeArchived,
      },
      ...snapshot,
    });
  } catch {
    return NextResponse.json({ error: "analytics_query_failed" }, { status: 500 });
  }
}
