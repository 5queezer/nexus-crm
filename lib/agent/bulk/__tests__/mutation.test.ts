import { describe, expect, it } from "vitest";
import { planApplyMutation, planUndoMutation } from "../mutation";

describe("bulk application mutations", () => {
  it("requires the exact preview version before applying", () => {
    expect(planApplyMutation({
      actionType: "archive",
      expectedVersion: 4,
      currentVersion: 5,
      before: { archivedAt: null },
      after: { archivedAt: "2026-09-19T10:00:00.000Z" },
      current: { archivedAt: null },
    })).toEqual({ outcome: "stale", code: "version_conflict" });
  });

  it("undoes only the affected field while preserving unrelated later edits", () => {
    expect(planUndoMutation({
      actionType: "reschedule_follow_up",
      currentVersion: 12,
      appliedVersion: 12,
      appliedBefore: { followUpAt: "2026-09-20T09:00:00.000Z" },
      appliedAfter: { followUpAt: "2026-09-21T09:00:00.000Z" },
      current: {
        followUpAt: "2026-09-21T09:00:00.000Z",
        archivedAt: null,
        status: "interview",
      },
    })).toEqual({
      outcome: "ready",
      expectedVersion: 12,
      changes: { followUpAt: "2026-09-20T09:00:00.000Z" },
    });
  });

  it("refuses undo when a later edit changed the affected field", () => {
    expect(planUndoMutation({
      actionType: "archive",
      currentVersion: 8,
      appliedVersion: 8,
      appliedBefore: { archivedAt: null },
      appliedAfter: { archivedAt: "2026-09-19T10:00:00.000Z" },
      current: { archivedAt: "2026-09-20T10:00:00.000Z" },
    })).toEqual({ outcome: "stale", code: "later_field_change" });
  });

  it("refuses undo after any later version even when the affected field returned to the applied value", () => {
    expect(planUndoMutation({
      actionType: "reschedule_follow_up",
      appliedVersion: 5,
      currentVersion: 7,
      appliedBefore: { followUpAt: "2026-09-19T09:00:00.000Z" },
      appliedAfter: { followUpAt: "2026-09-21T09:00:00.000Z" },
      current: { followUpAt: "2026-09-21T09:00:00.000Z" },
    })).toEqual({ outcome: "stale", code: "later_version_change" });
  });
});
