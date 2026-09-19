import type {
  BulkCommandCounts,
  BulkCommandRecord,
  BulkCommandSnapshot,
  BulkItemStatus,
} from "./types";

const ITEM_STATUSES: BulkItemStatus[] = [
  "pending",
  "running",
  "applied",
  "skipped",
  "failed",
  "stale",
  "cancelled",
  "outcome_unknown",
];

export function toBulkCommandSnapshot(command: BulkCommandRecord): BulkCommandSnapshot {
  const counts = Object.fromEntries(ITEM_STATUSES.map((status) => [
    status,
    command.items.filter((item) => item.status === status).length,
  ])) as Record<BulkItemStatus, number>;
  const undoCount = (status: string) => command.items.filter((item) => item.undoStatus === status).length;
  const fullCounts: BulkCommandCounts = {
    ...counts,
    total: command.items.length,
    undoPending: undoCount("pending") + undoCount("running"),
    undoApplied: undoCount("applied"),
    undoStale: undoCount("stale"),
    undoFailed: undoCount("failed"),
    undoOutcomeUnknown: undoCount("outcome_unknown"),
  };
  return {
    id: command.id,
    threadId: command.threadId,
    runId: command.runId,
    actionType: command.actionType,
    scope: command.scope,
    reason: command.reason,
    exclusions: command.exclusions,
    requestHash: command.requestHash,
    digest: command.digest,
    approvedDigest: command.approvedDigest,
    idempotencyKey: command.idempotencyKey,
    status: command.status,
    supersedesId: command.supersedesId,
    createdAt: command.createdAt.toISOString(),
    updatedAt: command.updatedAt.toISOString(),
    expiresAt: command.expiresAt.toISOString(),
    approvedAt: command.approvedAt?.toISOString() ?? null,
    startedAt: command.startedAt?.toISOString() ?? null,
    completedAt: command.completedAt?.toISOString() ?? null,
    pauseRequestedAt: command.pauseRequestedAt?.toISOString() ?? null,
    cancelRequestedAt: command.cancelRequestedAt?.toISOString() ?? null,
    undoRequestedAt: command.undoRequestedAt?.toISOString() ?? null,
    targetCount: command.items.length,
    reversible: true,
    counts: fullCounts,
    items: command.items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      appliedAt: item.appliedAt?.toISOString() ?? null,
      verifiedAt: item.verifiedAt?.toISOString() ?? null,
      undoAppliedAt: item.undoAppliedAt?.toISOString() ?? null,
    })),
  };
}
