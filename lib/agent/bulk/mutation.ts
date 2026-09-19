import type { BulkActionType, BulkFieldSnapshot } from "./types";

type CurrentApplicationFields = BulkFieldSnapshot & { status?: string };

function affectedField(actionType: BulkActionType): keyof BulkFieldSnapshot {
  return actionType === "reschedule_follow_up" ? "followUpAt" : "archivedAt";
}

export function planApplyMutation(input: {
  actionType: BulkActionType;
  expectedVersion: number;
  currentVersion: number;
  before: BulkFieldSnapshot;
  after: BulkFieldSnapshot;
  current: CurrentApplicationFields;
}):
  | { outcome: "ready"; expectedVersion: number; changes: BulkFieldSnapshot }
  | { outcome: "stale"; code: "version_conflict" | "field_conflict" } {
  if (input.currentVersion !== input.expectedVersion) {
    return { outcome: "stale", code: "version_conflict" };
  }
  const field = affectedField(input.actionType);
  if ((input.current[field] ?? null) !== (input.before[field] ?? null)) {
    return { outcome: "stale", code: "field_conflict" };
  }
  return {
    outcome: "ready",
    expectedVersion: input.currentVersion,
    changes: { [field]: input.after[field] ?? null },
  };
}

export function planUndoMutation(input: {
  actionType: BulkActionType;
  appliedVersion: number;
  currentVersion: number;
  appliedBefore: BulkFieldSnapshot;
  appliedAfter: BulkFieldSnapshot;
  current: CurrentApplicationFields;
}):
  | { outcome: "ready"; expectedVersion: number; changes: BulkFieldSnapshot }
  | { outcome: "stale"; code: "later_version_change" | "later_field_change" } {
  const field = affectedField(input.actionType);
  if (input.currentVersion !== input.appliedVersion) {
    return { outcome: "stale", code: "later_version_change" };
  }
  if ((input.current[field] ?? null) !== (input.appliedAfter[field] ?? null)) {
    return { outcome: "stale", code: "later_field_change" };
  }
  return {
    outcome: "ready",
    expectedVersion: input.currentVersion,
    changes: { [field]: input.appliedBefore[field] ?? null },
  };
}
