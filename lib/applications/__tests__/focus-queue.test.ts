import { describe, expect, it } from "vitest";
import type { Application } from "@/types";
import { buildFocusQueue } from "../focus-queue";
import { formatLocalCalendarDate } from "../local-calendar";

function app(id: string, overrides: Partial<Application> = {}): Application {
  return {
    id,
    company: id,
    role: "Role",
    status: "inbound",
    appliedAt: null,
    lastContact: null,
    followUpAt: null,
    notes: null,
    jobDescription: null,
    source: null,
    remote: false,
    salaryMin: null,
    salaryMax: null,
    rating: null,
    jobUrl: null,
    resumeId: null,
    companySize: null,
    salaryBandMentioned: false,
    triageQuality: null,
    triageReason: null,
    incomingSource: null,
    autoRejected: false,
    autoRejectReason: null,
    archivedAt: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildFocusQueue", () => {
  it("groups next actions once, keeps holds waiting and preserves closing/lost", () => {
    const queue = buildFocusQueue([
      app("future", { followUpAt: "2026-07-22" }),
      app("hold", { status: "interview", followUpAt: "2026-07-10", notes: "Wait for recruiter feedback; do not follow up yet." }),
      app("historical", { status: "interview", followUpAt: "2026-07-11", notes: "No follow-up received from the recruiter." }),
      app("today", { followUpAt: "2026-07-14" }),
      app("overdue", { followUpAt: "2026-07-12" }),
      app("new"),
      app("waiting", { status: "applied" }),
      app("closed", { status: "offer" }),
      app("lost", { status: "rejected" }),
    ], new Date(2026, 6, 14, 12));
    expect(queue.map(group => [group.id, group.applications.map(item => item.id)])).toEqual([
      ["overdue", ["historical", "overdue", "today"]],
      ["dueSoon", ["future"]],
      ["waiting", ["hold", "waiting"]],
      ["newLeads", ["new"]],
      ["completed", ["closed", "lost"]],
    ]);
    expect(new Set(queue.flatMap(group => group.applications.map(item => item.id))).size).toBe(9);
  });
  it("keeps serialized calendar dates on the intended local day", () => {
    const value = "2026-07-14T00:00:00.000Z";
    const queue = buildFocusQueue([app("today", { followUpAt: value })], new Date(2026, 6, 14, 12));
    expect(queue[0].id).toBe("overdue");
    expect(formatLocalCalendarDate(value, "en-US")).toContain("Jul 14, 2026");
  });
  it("keeps invalid dates visible without inventing a due date", () => {
    expect(buildFocusQueue([app("invalid", { followUpAt: "invalid" })])[0].id).toBe("newLeads");
  });
});
