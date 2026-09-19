import type { Application } from "@/types";
import { localCalendarTimestamp, parseLocalCalendarDate } from "./local-calendar";
import { followUpHoldReason } from "./follow-up-policy";

export type FocusGroupId = "overdue" | "dueSoon" | "waiting" | "newLeads" | "completed";
export interface FocusQueueGroup { id: FocusGroupId; applications: Application[] }

export function buildFocusQueue(applications: Application[], now = new Date()): FocusQueueGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const groups: Record<FocusGroupId, Application[]> = { overdue: [], dueSoon: [], waiting: [], newLeads: [], completed: [] };
  for (const application of applications) {
    const due = parseLocalCalendarDate(application.followUpAt);
    if (application.status === "offer" || application.status === "rejected") groups.completed.push(application);
    else if (followUpHoldReason(application)) groups.waiting.push(application);
    else if (due && due <= today) groups.overdue.push(application);
    else if (due) groups.dueSoon.push(application);
    else if (application.status === "inbound") groups.newLeads.push(application);
    else groups.waiting.push(application);
  }
  for (const items of Object.values(groups)) {
    items.sort((a, b) => localCalendarTimestamp(a.followUpAt) - localCalendarTimestamp(b.followUpAt) || (b.triageQuality ?? 0) - (a.triageQuality ?? 0) || a.id.localeCompare(b.id));
  }
  return (["overdue", "dueSoon", "waiting", "newLeads", "completed"] as const)
    .map((id) => ({ id, applications: groups[id] })).filter((group) => group.applications.length);
}
