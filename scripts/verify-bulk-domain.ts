import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { prismaBulkCommandRepository } from "../lib/agent/bulk/prisma-repository";
import {
  approveBulkCommand,
  createBulkPreview,
  queueBulkCommand,
  requestBulkCancel,
  requestBulkPause,
  requestBulkUndo,
  resumeBulkCommand,
  reviseBulkPreview,
} from "../lib/agent/bulk/service";
import { processBulkJobsOnce } from "../lib/agent/bulk/worker";

const USER_ID = `bulk-domain-check-${randomUUID()}`;
const NOW = new Date("2026-09-19T10:00:00.000Z");
const OLD_FOLLOW_UP = new Date("2026-09-18T10:00:00.000Z");
const NEW_FOLLOW_UP = "2026-09-21T09:00:00.000Z";

async function load(id: string) {
  const command = await prismaBulkCommandRepository.findCommand(USER_ID, id);
  assert(command, `missing command ${id}`);
  return command;
}

async function drain(id: string, terminal: string[], sliceSize = 25) {
  for (let index = 0; index < 100; index += 1) {
    const command = await load(id);
    if (terminal.includes(command.status)) return command;
    assert.equal(await processBulkJobsOnce({ sliceSize }), true);
  }
  throw new Error(`command ${id} did not reach ${terminal.join("/")}`);
}

async function createApplication(suffix: string) {
  return prisma.application.create({
    data: {
      userId: USER_ID,
      company: `Bulk ${suffix}`,
      role: "Engineer",
      status: "applied",
      source: "LinkedIn",
      remote: true,
      workMode: "remote",
      triageQuality: 4,
      followUpAt: OLD_FOLLOW_UP,
    },
  });
}

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/(?:test|check)/i.test(database.pathname)) {
    throw new Error("Bulk verification requires an isolated local test database");
  }
  await prisma.user.create({
    data: { id: USER_ID, email: `${USER_ID}@example.invalid`, name: "Bulk Domain Check" },
  });
  try {
    await prisma.application.createMany({
      data: Array.from({ length: 32 }, (_, index) => ({
        userId: USER_ID,
        company: `Batch ${index + 1}`,
        role: "Engineer",
        status: "applied",
        source: "LinkedIn recruiter",
        remote: true,
        workMode: "remote",
        triageQuality: 4,
        followUpAt: OLD_FOLLOW_UP,
        notes: index === 7 ? "Wait for recruiter feedback; do not follow up yet." : null,
      })),
    });

    const preview = await createBulkPreview({
      repository: prismaBulkCommandRepository,
      userId: USER_ID,
      actionType: "reschedule_follow_up",
      scope: {
        mode: "all_matching",
        filters: {
          query: "Batch",
          statuses: ["applied"],
          sources: ["linkedin"],
          triageQualityMin: 4,
          followUpBefore: "2026-09-19T22:00:00.000Z",
        },
      },
      changes: { followUpAt: NEW_FOLLOW_UP },
      reason: "Move overdue follow-ups to Monday",
      idempotencyKey: "integration-31-preview",
      now: NOW,
    });
    assert.equal(preview.items.length, 31);
    assert.equal(preview.exclusions.length, 1);
    const approved = await approveBulkCommand(prismaBulkCommandRepository, USER_ID, preview.id, preview.digest, NOW);
    assert.equal((await approveBulkCommand(prismaBulkCommandRepository, USER_ID, preview.id, preview.digest, NOW)).id, approved.id);
    const queued = await queueBulkCommand(prismaBulkCommandRepository, USER_ID, preview.id, preview.digest, NOW);
    assert.equal((await queueBulkCommand(prismaBulkCommandRepository, USER_ID, preview.id, preview.digest, NOW)).id, queued.id);
    const complete = await drain(preview.id, ["completed", "completed_with_errors"]);
    assert.equal(complete.status, "completed");
    assert.equal(complete.items.filter((item) => item.status === "applied").length, 31);
    assert.equal(await prisma.applicationEvent.count({ where: { userId: USER_ID, source: "agent_bulk" } }), 31);

    const staleApplication = await createApplication("stale");
    const stalePreview = await createBulkPreview({
      repository: prismaBulkCommandRepository,
      userId: USER_ID,
      actionType: "reschedule_follow_up",
      scope: { mode: "selected", applicationIds: [String(staleApplication.id)] },
      changes: { followUpAt: NEW_FOLLOW_UP },
      idempotencyKey: "integration-stale-preview",
      now: NOW,
    });
    await prisma.application.update({
      where: { id: staleApplication.id },
      data: { status: "interview", eventVersion: { increment: 1 } },
    });
    await approveBulkCommand(prismaBulkCommandRepository, USER_ID, stalePreview.id, stalePreview.digest, NOW);
    await queueBulkCommand(prismaBulkCommandRepository, USER_ID, stalePreview.id, stalePreview.digest, NOW);
    const stale = await drain(stalePreview.id, ["completed_with_errors"]);
    assert.equal(stale.items[0].status, "stale");

    const refreshed = await reviseBulkPreview({
      repository: prismaBulkCommandRepository,
      userId: USER_ID,
      commandId: stale.id,
      digest: stale.digest,
      itemChanges: [{ applicationId: String(staleApplication.id), followUpAt: "2026-09-22T09:00:00.000Z" }],
      idempotencyKey: "integration-stale-refreshed",
      now: NOW,
    });
    assert.notEqual(refreshed.digest, stale.digest);
    assert.equal(refreshed.items[0].expectedVersion, 1);
    await approveBulkCommand(prismaBulkCommandRepository, USER_ID, refreshed.id, refreshed.digest, NOW);
    await queueBulkCommand(prismaBulkCommandRepository, USER_ID, refreshed.id, refreshed.digest, NOW);
    const refreshedComplete = await drain(refreshed.id, ["completed"]);
    assert.deepEqual(refreshedComplete.items[0].appliedBefore, { followUpAt: OLD_FOLLOW_UP.toISOString() });
    await requestBulkUndo(prismaBulkCommandRepository, USER_ID, refreshed.id, refreshed.digest, NOW);
    await drain(refreshed.id, ["undo_completed"]);
    const conflictUndo = await prisma.application.findUniqueOrThrow({ where: { id: staleApplication.id } });
    assert.equal(conflictUndo.followUpAt?.toISOString(), OLD_FOLLOW_UP.toISOString());

    const laterEditPreview = await createBulkPreview({
      repository: prismaBulkCommandRepository,
      userId: USER_ID,
      actionType: "reschedule_follow_up",
      scope: { mode: "selected", applicationIds: [String(staleApplication.id)] },
      changes: { followUpAt: "2026-09-23T09:00:00.000Z" },
      idempotencyKey: "integration-later-edit-preview",
      now: NOW,
    });
    await approveBulkCommand(prismaBulkCommandRepository, USER_ID, laterEditPreview.id, laterEditPreview.digest, NOW);
    await queueBulkCommand(prismaBulkCommandRepository, USER_ID, laterEditPreview.id, laterEditPreview.digest, NOW);
    await drain(laterEditPreview.id, ["completed"]);
    await prisma.application.update({
      where: { id: staleApplication.id },
      data: { status: "offer", eventVersion: { increment: 1 } },
    });
    await requestBulkUndo(prismaBulkCommandRepository, USER_ID, laterEditPreview.id, laterEditPreview.digest, NOW);
    const protectedUndo = await drain(laterEditPreview.id, ["undo_completed_with_errors"]);
    assert.equal(protectedUndo.items[0].undoStatus, "stale");
    const undone = await prisma.application.findUniqueOrThrow({ where: { id: staleApplication.id } });
    assert.equal(undone.followUpAt?.toISOString(), "2026-09-23T09:00:00.000Z");
    assert.equal(undone.status, "offer");

    const cancellableApplications = await Promise.all(["cancel-1", "cancel-2", "cancel-3"].map(createApplication));
    const cancellable = await createBulkPreview({
      repository: prismaBulkCommandRepository,
      userId: USER_ID,
      actionType: "archive",
      scope: { mode: "selected", applicationIds: cancellableApplications.map((application) => String(application.id)) },
      idempotencyKey: "integration-cancel-preview",
      now: NOW,
    });
    await approveBulkCommand(prismaBulkCommandRepository, USER_ID, cancellable.id, cancellable.digest, NOW);
    await queueBulkCommand(prismaBulkCommandRepository, USER_ID, cancellable.id, cancellable.digest, NOW);
    await requestBulkPause(prismaBulkCommandRepository, USER_ID, cancellable.id, NOW);
    assert.equal((await drain(cancellable.id, ["paused"])).status, "paused");
    await resumeBulkCommand(prismaBulkCommandRepository, USER_ID, cancellable.id);
    await processBulkJobsOnce({ sliceSize: 1 });
    await requestBulkCancel(prismaBulkCommandRepository, USER_ID, cancellable.id, NOW);
    const cancelled = await drain(cancellable.id, ["cancelled"]);
    assert.equal(cancelled.items.filter((item) => item.status === "applied").length, 1);
    assert.equal(cancelled.items.filter((item) => item.status === "cancelled").length, 2);
    await requestBulkUndo(prismaBulkCommandRepository, USER_ID, cancelled.id, cancelled.digest, NOW);
    const cancelledUndo = await drain(cancelled.id, ["undo_completed"]);
    assert.equal(cancelledUndo.items.filter((item) => item.undoStatus === "applied").length, 1);

    process.stdout.write(JSON.stringify({
      allMatchingTargets: preview.items.length,
      explicitWaitExclusions: preview.exclusions.length,
      applied: complete.items.filter((item) => item.status === "applied").length,
      staleDetected: stale.items[0].status,
      refreshedVersion: refreshed.items[0].expectedVersion,
      conflictResolutionUndoRestored: conflictUndo.followUpAt?.toISOString(),
      laterEditUndoOutcome: protectedUndo.items[0].undoStatus,
      laterStatusPreserved: undone.status,
      partialAppliedBeforeCancel: cancelled.items.filter((item) => item.status === "applied").length,
      cancelledRemaining: cancelled.items.filter((item) => item.status === "cancelled").length,
      partialUndoApplied: cancelledUndo.items.filter((item) => item.undoStatus === "applied").length,
    }, null, 2) + "\n");
  } finally {
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  }
}

main()
  .catch(() => {
    console.error("Bulk domain verification failed");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
