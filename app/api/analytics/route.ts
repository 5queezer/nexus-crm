import { NextRequest, NextResponse } from "next/server";
import { decodeEventCursor } from "@/lib/applications/events";
import { buildAnalyticsSnapshot } from "@/lib/analytics/metrics";
import {
  addCalendarDays,
  dateOnlyInTimeZone,
  dateOnlyRangeInTimeZone,
  normalizeAnalyticsTimeZone,
} from "@/lib/analytics/time-zone";
import { getDb } from "@/lib/db";
import type { ApplicationEventRecord } from "@/lib/db/types";
import { requireAuth } from "@/lib/session";

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

  let start: Date;
  let end: Date;
  let startValue: string;
  let endValue: string;
  let timeZone: string;
  let source: string | null;
  let includeArchived: boolean;
  try {
    timeZone = normalizeAnalyticsTimeZone(request.nextUrl.searchParams.get("timeZone"));
    const today = dateOnlyInTimeZone(now, timeZone);
    startValue = request.nextUrl.searchParams.get("start") ?? addCalendarDays(today, -89);
    endValue = request.nextUrl.searchParams.get("end") ?? today;
    ({ start, end } = dateOnlyRangeInTimeZone(startValue, endValue, timeZone));
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
      timeZone,
    });
    return NextResponse.json({
      filters: {
        start: startValue,
        end: endValue,
        cutoff: now.toISOString(),
        source,
        includeArchived,
        timeZone,
      },
      ...snapshot,
    });
  } catch {
    return NextResponse.json({ error: "analytics_query_failed" }, { status: 500 });
  }
}
