import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { stableDigest } from "./digest";
import { planApplyMutation, planUndoMutation } from "./mutation";
import type { BulkActionType, BulkFieldSnapshot } from "./types";

const LEASE_MS = 60_000;
const MAX_ITEM_ATTEMPTS = 5;
export const BULK_WORKER_SLICE_SIZE = 25;

type WorkerCounts = {
  status: string;
  pending: number;
  applied: number;
  failed: number;
  stale: number;
  outcomeUnknown: number;
  expired?: boolean;
};

export function resolveWorkerAction(counts: WorkerCounts):
  | "process"
  | "pause"
  | "cancel"
  | "expire"
  | "complete"
  | "complete_with_errors" {
  if (counts.status === "pause_requested") return "pause";
  if (counts.status === "cancel_requested") return "cancel";
  if (counts.expired && counts.pending > 0) return "expire";
  if (counts.pending > 0) return "process";
  return counts.failed + counts.stale + counts.outcomeUnknown > 0
    ? "complete_with_errors"
    : "complete";
}

function fieldValue(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function affectedField(actionType: BulkActionType): "followUpAt" | "archivedAt" {
  return actionType === "reschedule_follow_up" ? "followUpAt" : "archivedAt";
}

function applicationChanges(snapshot: BulkFieldSnapshot): Prisma.ApplicationUpdateManyMutationInput {
  if (Object.prototype.hasOwnProperty.call(snapshot, "followUpAt")) {
    return { followUpAt: snapshot.followUpAt ? new Date(snapshot.followUpAt) : null };
  }
  return { archivedAt: snapshot.archivedAt ? new Date(snapshot.archivedAt) : null };
}

function eventType(actionType: BulkActionType, undo: boolean): string {
  if (undo) return "bulk_change_undone";
  if (actionType === "reschedule_follow_up") return "follow_up_scheduled";
  return actionType === "archive" ? "application_archived" : "application_restored";
}

function safeFailure(error: unknown): { status: "failed" | "outcome_unknown"; code: string; message: string } {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "bulk_item_failed";
  if (["P1001", "P1002", "P2028"].includes(code)) {
    return { status: "outcome_unknown", code: "database_outcome_unknown", message: "Database outcome requires reconciliation" };
  }
  return { status: "failed", code: "bulk_item_failed", message: "The item could not be applied" };
}

async function claimCommand(workerToken: string, now: Date) {
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.bulkCommand.findFirst({
      where: {
        status: { in: ["queued", "running", "pause_requested", "cancel_requested", "undo_queued", "undo_running"] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
    });
    if (!candidate) return null;
    const claimedStatus = candidate.status === "queued"
      ? "running"
      : candidate.status === "undo_queued" ? "undo_running" : candidate.status;
    const claimed = await tx.bulkCommand.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        status: claimedStatus,
        workerToken,
        leaseExpiresAt,
        ...(candidate.status === "queued" ? { startedAt: now } : {}),
      },
    });
    return claimed.count === 1 ? { id: candidate.id, status: claimedStatus } : null;
  });
}

async function loadCounts(commandId: string): Promise<WorkerCounts | null> {
  const command = await prisma.bulkCommand.findUnique({
    where: { id: commandId },
    select: {
      status: true,
      expiresAt: true,
      items: { select: { status: true, attempts: true } },
    },
  });
  if (!command) return null;
  const count = (status: string) => command.items.filter((item) => item.status === status).length;
  return {
    status: command.status,
    pending: count("pending") + count("running") + command.items.filter(
      (item) => item.status === "outcome_unknown" && item.attempts < MAX_ITEM_ATTEMPTS,
    ).length,
    applied: count("applied"),
    failed: count("failed"),
    stale: count("stale"),
    outcomeUnknown: count("outcome_unknown"),
    expired: command.expiresAt <= new Date(),
  };
}

async function markControlOutcome(commandId: string, workerToken: string, action: "pause" | "cancel", now: Date) {
  if (action === "cancel") {
    await prisma.$transaction([
      prisma.bulkCommandItem.updateMany({
        where: { commandId, status: { in: ["pending", "running"] } },
        data: { status: "cancelled", errorCode: "command_cancelled", errorMessage: null },
      }),
      prisma.bulkCommand.updateMany({
        where: { id: commandId, workerToken, status: "cancel_requested" },
        data: { status: "cancelled", completedAt: now, workerToken: null, leaseExpiresAt: null },
      }),
    ]);
    return;
  }
  await prisma.bulkCommand.updateMany({
    where: { id: commandId, workerToken, status: "pause_requested" },
    data: { status: "paused", workerToken: null, leaseExpiresAt: null },
  });
}

async function markExpired(commandId: string, workerToken: string, now: Date) {
  await prisma.$transaction([
    prisma.bulkCommandItem.updateMany({
      where: { commandId, status: { in: ["pending", "running"] } },
      data: { status: "skipped", errorCode: "preview_expired", errorMessage: null },
    }),
    prisma.bulkCommand.updateMany({
      where: { id: commandId, workerToken, status: "running", expiresAt: { lte: now } },
      data: {
        status: "completed_with_errors",
        completedAt: now,
        workerToken: null,
        leaseExpiresAt: null,
      },
    }),
  ]);
}

async function reconcileUnknownItems(commandId: string, now: Date): Promise<void> {
  const unknown = await prisma.bulkCommandItem.findMany({
    where: { commandId, status: "outcome_unknown" },
    select: { id: true },
    orderBy: { ordinal: "asc" },
  });
  for (const candidate of unknown) {
    await prisma.$transaction(async (tx) => {
      const item = await tx.bulkCommandItem.findUnique({ where: { id: candidate.id } });
      if (!item || item.status !== "outcome_unknown") return;
      if (await reconcileExistingEvent(tx, item, now)) return;
      await tx.bulkCommandItem.update({
        where: { id: item.id },
        data: {
          status: "pending",
          errorCode: "reconciled_not_applied",
          errorMessage: null,
        },
      });
    });
  }
}

async function reconcileExistingEvent(
  tx: Prisma.TransactionClient,
  item: { id: string; userId: string; applicationId: number; idempotencyKey: string; after: Prisma.JsonValue },
  now: Date,
): Promise<boolean> {
  const event = await tx.applicationEvent.findUnique({
    where: { userId_idempotencyKey: { userId: item.userId, idempotencyKey: item.idempotencyKey } },
    select: { id: true },
  });
  if (!event) return false;
  const application = await tx.application.findFirst({
    where: { id: item.applicationId, userId: item.userId, isDemo: false },
    select: { eventVersion: true, followUpAt: true, archivedAt: true },
  });
  if (!application) return false;
  const after = item.after as BulkFieldSnapshot;
  const matches = after.followUpAt !== undefined
    ? fieldValue(application.followUpAt) === after.followUpAt
    : fieldValue(application.archivedAt) === after.archivedAt;
  if (!matches) return false;
  await tx.bulkCommandItem.update({
    where: { id: item.id },
    data: {
      status: "applied",
      appliedVersion: application.eventVersion,
      appliedAfter: after as Prisma.InputJsonValue,
      appliedAt: now,
      verifiedAt: now,
      errorCode: null,
      errorMessage: null,
    },
  });
  return true;
}

async function applyNextItem(commandId: string, workerToken: string, now: Date): Promise<boolean> {
  const item = await prisma.bulkCommandItem.findFirst({
    where: {
      commandId,
      OR: [{ status: "pending" }, { status: "outcome_unknown", attempts: { lt: MAX_ITEM_ATTEMPTS } }],
    },
    orderBy: { ordinal: "asc" },
    select: { id: true },
  });
  if (!item) return false;
  try {
    await prisma.$transaction(async (tx) => {
      const currentItem = await tx.bulkCommandItem.findUnique({
        where: { id: item.id },
        include: { command: true },
      });
      if (!currentItem || !["pending", "outcome_unknown"].includes(currentItem.status)) return;
      if (currentItem.command.workerToken !== workerToken || currentItem.command.status !== "running") return;
      if (currentItem.command.expiresAt <= now) {
        await tx.bulkCommandItem.update({
          where: { id: currentItem.id },
          data: { status: "skipped", errorCode: "preview_expired", errorMessage: null },
        });
        return;
      }
      if (await reconcileExistingEvent(tx, currentItem, now)) return;
      const application = await tx.application.findFirst({
        where: { id: currentItem.applicationId, userId: currentItem.userId, isDemo: false },
        select: { eventVersion: true, followUpAt: true, archivedAt: true },
      });
      if (!application) {
        await tx.bulkCommandItem.update({
          where: { id: currentItem.id },
          data: { status: "skipped", attempts: { increment: 1 }, errorCode: "target_not_found", errorMessage: null },
        });
        return;
      }
      const actionType = currentItem.command.actionType as BulkActionType;
      const before = currentItem.before as BulkFieldSnapshot;
      const after = currentItem.after as BulkFieldSnapshot;
      const plan = planApplyMutation({
        actionType,
        expectedVersion: currentItem.expectedVersion,
        currentVersion: application.eventVersion,
        before,
        after,
        current: {
          followUpAt: fieldValue(application.followUpAt),
          archivedAt: fieldValue(application.archivedAt),
        },
      });
      if (plan.outcome === "stale") {
        await tx.bulkCommandItem.update({
          where: { id: currentItem.id },
          data: { status: "stale", attempts: { increment: 1 }, errorCode: plan.code, errorMessage: null },
        });
        return;
      }
      const updated = await tx.application.updateMany({
        where: {
          id: currentItem.applicationId,
          userId: currentItem.userId,
          isDemo: false,
          eventVersion: plan.expectedVersion,
        },
        data: { ...applicationChanges(plan.changes), eventVersion: { increment: 1 } },
      });
      if (updated.count !== 1) {
        await tx.bulkCommandItem.update({
          where: { id: currentItem.id },
          data: { status: "stale", attempts: { increment: 1 }, errorCode: "version_conflict", errorMessage: null },
        });
        return;
      }
      const appliedVersion = plan.expectedVersion + 1;
      const metadata = {
        taskId: currentItem.commandId,
        bulkItemId: currentItem.id,
        before,
        after,
        reason: currentItem.reason,
        ...(after.followUpAt !== undefined ? { followUpAt: after.followUpAt } : {}),
      };
      await tx.applicationEvent.create({
        data: {
          userId: currentItem.userId,
          applicationId: currentItem.applicationId,
          isDemo: false,
          type: eventType(actionType, false),
          idempotencyKey: currentItem.idempotencyKey,
          requestHash: stableDigest(metadata),
          occurredAt: now,
          source: "agent_bulk",
          actor: "user",
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      const verified = await tx.application.findFirstOrThrow({
        where: { id: currentItem.applicationId, userId: currentItem.userId, eventVersion: appliedVersion },
        select: { followUpAt: true, archivedAt: true },
      });
      const field = affectedField(actionType);
      const actual = fieldValue(verified[field]);
      if (actual !== (after[field] ?? null)) throw new Error("bulk_verification_failed");
      await tx.bulkCommandItem.update({
        where: { id: currentItem.id },
        data: {
          status: "applied",
          attempts: { increment: 1 },
          appliedVersion,
          appliedBefore: before as Prisma.InputJsonValue,
          appliedAfter: after as Prisma.InputJsonValue,
          appliedAt: now,
          verifiedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const failure = safeFailure(error);
    await prisma.bulkCommandItem.updateMany({
      where: { id: item.id, status: { in: ["pending", "outcome_unknown"] } },
      data: {
        status: failure.status,
        attempts: { increment: 1 },
        errorCode: failure.code,
        errorMessage: failure.message,
      },
    });
  }
  return true;
}

async function undoNextItem(commandId: string, workerToken: string, now: Date): Promise<boolean> {
  const item = await prisma.bulkCommandItem.findFirst({
    where: {
      commandId,
      status: "applied",
      OR: [{ undoStatus: "pending" }, { undoStatus: "outcome_unknown", attempts: { lt: MAX_ITEM_ATTEMPTS } }],
    },
    orderBy: { ordinal: "asc" },
    select: { id: true },
  });
  if (!item) return false;
  try {
    await prisma.$transaction(async (tx) => {
      const currentItem = await tx.bulkCommandItem.findUnique({ where: { id: item.id }, include: { command: true } });
      if (!currentItem || !["pending", "outcome_unknown"].includes(currentItem.undoStatus ?? "")) return;
      if (currentItem.command.workerToken !== workerToken || currentItem.command.status !== "undo_running") return;
      const undoIdempotencyKey = `bulk:${commandId}:${currentItem.id}:undo`;
      const existingUndo = await tx.applicationEvent.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: currentItem.userId,
            idempotencyKey: undoIdempotencyKey,
          },
        },
        select: { metadata: true },
      });
      if (existingUndo) {
        const metadata = existingUndo.metadata as { appliedVersion?: unknown } | null;
        const appliedVersion = typeof metadata?.appliedVersion === "number" ? metadata.appliedVersion : null;
        await tx.bulkCommandItem.update({
          where: { id: currentItem.id },
          data: {
            undoStatus: "applied",
            undoExpectedVersion: appliedVersion === null ? currentItem.undoExpectedVersion : appliedVersion - 1,
            undoAppliedAt: now,
            errorCode: null,
            errorMessage: null,
          },
        });
        return;
      }
      const application = await tx.application.findFirst({
        where: { id: currentItem.applicationId, userId: currentItem.userId, isDemo: false },
        select: { eventVersion: true, followUpAt: true, archivedAt: true },
      });
      if (!application || !currentItem.appliedBefore || !currentItem.appliedAfter) {
        await tx.bulkCommandItem.update({
          where: { id: currentItem.id },
          data: { undoStatus: "failed", errorCode: "undo_target_unavailable", errorMessage: null },
        });
        return;
      }
      const actionType = currentItem.command.actionType as BulkActionType;
      const appliedBefore = currentItem.appliedBefore as BulkFieldSnapshot;
      const appliedAfter = currentItem.appliedAfter as BulkFieldSnapshot;
      const plan = planUndoMutation({
        actionType,
        appliedVersion: currentItem.appliedVersion ?? -1,
        currentVersion: application.eventVersion,
        appliedBefore,
        appliedAfter,
        current: {
          followUpAt: fieldValue(application.followUpAt),
          archivedAt: fieldValue(application.archivedAt),
        },
      });
      if (plan.outcome === "stale") {
        await tx.bulkCommandItem.update({
          where: { id: currentItem.id },
          data: { undoStatus: "stale", undoExpectedVersion: application.eventVersion, errorCode: plan.code, errorMessage: null },
        });
        return;
      }
      const updated = await tx.application.updateMany({
        where: {
          id: currentItem.applicationId,
          userId: currentItem.userId,
          isDemo: false,
          eventVersion: plan.expectedVersion,
        },
        data: { ...applicationChanges(plan.changes), eventVersion: { increment: 1 } },
      });
      if (updated.count !== 1) {
        await tx.bulkCommandItem.update({
          where: { id: currentItem.id },
          data: { undoStatus: "stale", undoExpectedVersion: plan.expectedVersion, errorCode: "version_conflict", errorMessage: null },
        });
        return;
      }
      const metadata = {
        taskId: commandId,
        bulkItemId: currentItem.id,
        before: appliedAfter,
        after: appliedBefore,
        undoOf: currentItem.idempotencyKey,
        expectedVersion: plan.expectedVersion,
        appliedVersion: plan.expectedVersion + 1,
      };
      await tx.applicationEvent.create({
        data: {
          userId: currentItem.userId,
          applicationId: currentItem.applicationId,
          isDemo: false,
          type: eventType(actionType, true),
          idempotencyKey: undoIdempotencyKey,
          requestHash: stableDigest(metadata),
          occurredAt: now,
          source: "agent_bulk",
          actor: "user",
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      await tx.bulkCommandItem.update({
        where: { id: currentItem.id },
        data: {
          undoStatus: "applied",
          undoExpectedVersion: plan.expectedVersion,
          undoAppliedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const failure = safeFailure(error);
    await prisma.bulkCommandItem.updateMany({
      where: { id: item.id, undoStatus: { in: ["pending", "outcome_unknown"] } },
      data: {
        undoStatus: failure.status,
        attempts: { increment: 1 },
        errorCode: failure.code,
        errorMessage: failure.message,
      },
    });
  }
  return true;
}

async function finishUndoIfDone(commandId: string, workerToken: string, now: Date): Promise<boolean> {
  const items = await prisma.bulkCommandItem.findMany({
    where: { commandId, status: "applied" },
    select: { undoStatus: true, attempts: true },
  });
  if (items.some((item) =>
    ["pending", "running"].includes(item.undoStatus ?? "") ||
    (item.undoStatus === "outcome_unknown" && item.attempts < MAX_ITEM_ATTEMPTS),
  )) return false;
  const hasErrors = items.some((item) =>
    item.undoStatus === "failed" || item.undoStatus === "stale" || item.undoStatus === "outcome_unknown",
  );
  await prisma.bulkCommand.updateMany({
    where: { id: commandId, workerToken, status: "undo_running" },
    data: {
      status: hasErrors ? "undo_completed_with_errors" : "undo_completed",
      completedAt: now,
      workerToken: null,
      leaseExpiresAt: null,
    },
  });
  return true;
}

export async function processBulkJobsOnce(options: {
  now?: Date;
  workerToken?: string;
  sliceSize?: number;
} = {}): Promise<boolean> {
  const now = options.now ?? new Date();
  const workerToken = options.workerToken ?? randomUUID();
  const command = await claimCommand(workerToken, now);
  if (!command) return false;
  if (command.status === "undo_running") {
    for (let index = 0; index < (options.sliceSize ?? BULK_WORKER_SLICE_SIZE); index += 1) {
      if (!await undoNextItem(command.id, workerToken, new Date())) break;
    }
    if (!await finishUndoIfDone(command.id, workerToken, new Date())) {
      await prisma.bulkCommand.updateMany({
        where: { id: command.id, workerToken, status: "undo_running" },
        data: { workerToken: null, leaseExpiresAt: null },
      });
    }
    return true;
  }
  for (let index = 0; index < (options.sliceSize ?? BULK_WORKER_SLICE_SIZE); index += 1) {
    const counts = await loadCounts(command.id);
    if (!counts) break;
    const action = resolveWorkerAction(counts);
    if (action === "expire") {
      await markExpired(command.id, workerToken, new Date());
      return true;
    }
    if (action === "pause" || action === "cancel") {
      if (action === "cancel" && counts.outcomeUnknown > 0) {
        await reconcileUnknownItems(command.id, new Date());
        continue;
      }
      await markControlOutcome(command.id, workerToken, action, new Date());
      return true;
    }
    if (action === "complete" || action === "complete_with_errors") {
      await prisma.bulkCommand.updateMany({
        where: { id: command.id, workerToken, status: "running" },
        data: {
          status: action === "complete" ? "completed" : "completed_with_errors",
          completedAt: new Date(),
          workerToken: null,
          leaseExpiresAt: null,
        },
      });
      return true;
    }
    if (!await applyNextItem(command.id, workerToken, new Date())) break;
  }
  await prisma.bulkCommand.updateMany({
    where: { id: command.id, workerToken, status: "running" },
    data: { workerToken: null, leaseExpiresAt: null },
  });
  return true;
}
