import type { Application } from "@/types";
import {
  localCalendarTimestamp,
  parseLocalCalendarDate,
} from "./local-calendar";

export type FocusGroupId =
  | "overdue"
  | "highPriority"
  | "dueSoon"
  | "newThisWeek"
  | "recent";

export interface FocusQueueGroup {
  id: FocusGroupId;
  applications: Application[];
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const result = new Date(value).getTime();
  return Number.isNaN(result) ? Number.POSITIVE_INFINITY : result;
}

function stableId(a: Application, b: Application): number {
  return a.id.localeCompare(b.id);
}

export function buildFocusQueue(
  applications: Application[],
  now = new Date(),
): FocusQueueGroup[] {
  const today = startOfLocalDay(now);
  const dueSoonEnd = new Date(today);
  dueSoonEnd.setDate(dueSoonEnd.getDate() + 8);
  const newWeekStart = new Date(today);
  newWeekStart.setDate(newWeekStart.getDate() - 6);

  const groups: Record<FocusGroupId, Application[]> = {
    overdue: [],
    highPriority: [],
    dueSoon: [],
    newThisWeek: [],
    recent: [],
  };

  for (const application of applications) {
    const followUp = parseLocalCalendarDate(application.followUpAt);
    if (followUp && !Number.isNaN(followUp.getTime()) && followUp < today) {
      groups.overdue.push(application);
    } else if (
      application.triageQuality != null &&
      application.triageQuality >= 4
    ) {
      groups.highPriority.push(application);
    } else if (
      followUp &&
      !Number.isNaN(followUp.getTime()) &&
      followUp >= today &&
      followUp < dueSoonEnd
    ) {
      groups.dueSoon.push(application);
    } else {
      const createdAt = new Date(application.createdAt);
      if (
        !Number.isNaN(createdAt.getTime()) &&
        createdAt >= newWeekStart &&
        createdAt <= now
      ) {
        groups.newThisWeek.push(application);
      } else {
        groups.recent.push(application);
      }
    }
  }

  groups.overdue.sort(
    (a, b) =>
      localCalendarTimestamp(a.followUpAt) -
        localCalendarTimestamp(b.followUpAt) || stableId(a, b),
  );
  groups.highPriority.sort(
    (a, b) =>
      (b.triageQuality ?? 0) - (a.triageQuality ?? 0) ||
      localCalendarTimestamp(a.followUpAt) -
        localCalendarTimestamp(b.followUpAt) ||
      stableId(a, b),
  );
  groups.dueSoon.sort(
    (a, b) =>
      localCalendarTimestamp(a.followUpAt) -
        localCalendarTimestamp(b.followUpAt) || stableId(a, b),
  );
  groups.newThisWeek.sort(
    (a, b) => timestamp(b.createdAt) - timestamp(a.createdAt) || stableId(a, b),
  );
  groups.recent.sort(
    (a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || stableId(a, b),
  );

  return (
    ["overdue", "highPriority", "dueSoon", "newThisWeek", "recent"] as const
  )
    .map((id) => ({ id, applications: groups[id] }))
    .filter((group) => group.applications.length > 0);
}
