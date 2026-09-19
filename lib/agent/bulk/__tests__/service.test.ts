import { describe, expect, it } from "vitest";
import type {
  BulkApplicationCandidate,
  BulkCommandCreate,
  BulkCommandRecord,
  BulkCommandRepository,
  BulkCommandTransition,
} from "../types";
import {
  approveBulkCommand,
  createBulkPreview,
  queueBulkCommand,
  requestBulkCancel,
  requestBulkPause,
  requestBulkUndo,
  resumeBulkCommand,
  reviseBulkPreview,
} from "../service";

const NOW = new Date("2026-09-19T10:00:00.000Z");

function candidate(index: number, overrides: Partial<BulkApplicationCandidate> = {}): BulkApplicationCandidate {
  return {
    id: String(index),
    company: `Company ${index}`,
    role: "Engineer",
    status: "applied",
    source: "manual",
    remote: true,
    workMode: "remote",
    followUpAt: new Date("2026-09-18T10:00:00.000Z"),
    archivedAt: null,
    notes: null,
    eventVersion: index,
    ...overrides,
  };
}

class MemoryBulkRepository implements BulkCommandRepository {
  commands: BulkCommandRecord[] = [];
  candidates: BulkApplicationCandidate[] = [];
  resolveCalls = 0;

  async resolveApplications() {
    this.resolveCalls += 1;
    return this.candidates.map((value) => ({ ...value }));
  }

  async findByIdempotencyKey(userId: string, key: string) {
    return this.commands.find((command) => command.userId === userId && command.idempotencyKey === key) ?? null;
  }

  async createCommand(input: BulkCommandCreate) {
    const command: BulkCommandRecord = {
      ...input,
      approvedDigest: null,
      approvedAt: null,
      startedAt: null,
      completedAt: null,
      pauseRequestedAt: null,
      cancelRequestedAt: null,
      undoRequestedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      items: input.items.map((item, index) => ({
        ...item,
        id: `item-${this.commands.length + 1}-${index + 1}`,
        commandId: input.id,
        status: "pending",
        attempts: 0,
        errorCode: null,
        errorMessage: null,
        appliedVersion: null,
        appliedBefore: null,
        appliedAfter: null,
        appliedAt: null,
        verifiedAt: null,
        undoStatus: null,
        undoExpectedVersion: null,
        undoAppliedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    };
    this.commands.push(command);
    return command;
  }

  async findCommand(userId: string, id: string) {
    return this.commands.find((command) => command.userId === userId && command.id === id) ?? null;
  }

  async createRevision(userId: string, sourceId: string, sourceDigest: string, input: BulkCommandCreate) {
    const source = await this.findCommand(userId, sourceId);
    if (!source || source.digest !== sourceDigest) return null;
    if (source.status === "preview") source.status = "superseded";
    return this.createCommand(input);
  }

  async transitionCommand(userId: string, id: string, transition: BulkCommandTransition) {
    const command = await this.findCommand(userId, id);
    if (!command || !transition.from.includes(command.status)) return null;
    if (transition.digest !== undefined && command.digest !== transition.digest) return null;
    if (transition.notExpiredAt && command.expiresAt <= transition.notExpiredAt) return null;
    Object.assign(command, transition.patch, { updatedAt: NOW });
    return command;
  }

  async queueUndo(userId: string, id: string, digest: string, now: Date) {
    const command = await this.findCommand(userId, id);
    if (!command || command.digest !== digest || !["completed", "completed_with_errors"].includes(command.status)) return null;
    if (!command.items.some((item) => item.status === "applied")) return null;
    command.status = "undo_queued";
    command.undoRequestedAt = now;
    command.items.forEach((item) => {
      if (item.status === "applied") item.undoStatus = "pending";
    });
    return command;
  }
}

describe("bulk preview lifecycle", () => {
  it("freezes every server-matched row beyond the visible page and excludes explicit wait instructions", async () => {
    const repository = new MemoryBulkRepository();
    repository.candidates = Array.from({ length: 32 }, (_, index) => candidate(index + 1));
    repository.candidates[7] = candidate(8, { notes: "Wait for recruiter feedback; do not follow up yet." });

    const preview = await createBulkPreview({
      repository,
      userId: "user-a",
      actionType: "reschedule_follow_up",
      scope: { mode: "all_matching", filters: { statuses: ["applied"] } },
      changes: { followUpAt: "2026-09-21T09:00:00.000Z" },
      reason: "Move overdue follow-ups to Monday",
      idempotencyKey: "preview-1",
      now: NOW,
      idFactory: () => "command-1",
    });

    expect(repository.resolveCalls).toBe(1);
    expect(preview.items).toHaveLength(31);
    expect(preview.items.at(-1)?.applicationId).toBe("32");
    expect(preview.exclusions).toEqual([
      expect.objectContaining({ applicationId: "8", code: "explicit_wait_instruction" }),
    ]);
    expect(preview.items[0]).toMatchObject({
      expectedVersion: 1,
      before: { followUpAt: "2026-09-18T10:00:00.000Z" },
      after: { followUpAt: "2026-09-21T09:00:00.000Z" },
    });
    expect(preview.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a selected scope when any supplied id is not owner-resolved", async () => {
    const repository = new MemoryBulkRepository();
    repository.candidates = [candidate(1)];

    await expect(createBulkPreview({
      repository,
      userId: "user-a",
      actionType: "archive",
      scope: { mode: "selected", applicationIds: ["1", "999"] },
      idempotencyKey: "preview-2",
      now: NOW,
    })).rejects.toThrow("One or more applications are unavailable");
  });

  it("fails explicitly instead of silently truncating an oversized all-matching scope", async () => {
    const repository = new MemoryBulkRepository();
    repository.candidates = Array.from({ length: 10_001 }, (_, index) => candidate(index + 1));
    await expect(createBulkPreview({
      repository,
      userId: "user-a",
      actionType: "archive",
      scope: { mode: "all_matching", filters: {} },
      idempotencyKey: "oversized-preview",
      now: NOW,
    })).rejects.toThrow("Bulk scope exceeds the 10000 target budget");
    expect(repository.commands).toHaveLength(0);
  });

  it("creates a fresh identity and digest after edits and refreshes expected versions", async () => {
    const repository = new MemoryBulkRepository();
    repository.candidates = [candidate(1)];
    const original = await createBulkPreview({
      repository,
      userId: "user-a",
      actionType: "reschedule_follow_up",
      scope: { mode: "selected", applicationIds: ["1"] },
      changes: { followUpAt: "2026-09-21T09:00:00.000Z" },
      idempotencyKey: "preview-original",
      now: NOW,
      idFactory: () => "command-original",
    });
    repository.candidates = [candidate(1, {
      eventVersion: 9,
      followUpAt: new Date("2026-09-20T12:00:00.000Z"),
    })];

    const revised = await reviseBulkPreview({
      repository,
      userId: "user-a",
      commandId: original.id,
      digest: original.digest,
      itemChanges: [{ applicationId: "1", followUpAt: "2026-09-22T09:00:00.000Z" }],
      idempotencyKey: "preview-revised",
      now: NOW,
      idFactory: () => "command-revised",
    });

    expect(revised.id).toBe("command-revised");
    expect(revised.digest).not.toBe(original.digest);
    expect(revised.supersedesId).toBe(original.id);
    expect(revised.items[0]).toMatchObject({
      expectedVersion: 9,
      before: { followUpAt: "2026-09-20T12:00:00.000Z" },
      after: { followUpAt: "2026-09-22T09:00:00.000Z" },
    });
    expect(repository.commands[0].status).toBe("superseded");
  });

  it("preserves heterogeneous row dates across successive revisions", async () => {
    const repository = new MemoryBulkRepository();
    repository.candidates = [candidate(1), candidate(2), candidate(3)];
    const original = await createBulkPreview({
      repository,
      userId: "user-a",
      actionType: "reschedule_follow_up",
      scope: { mode: "selected", applicationIds: ["1", "2", "3"] },
      changes: { followUpAt: "2026-09-21T09:00:00.000Z" },
      idempotencyKey: "heterogeneous-original",
      now: NOW,
    });
    const firstRevision = await reviseBulkPreview({
      repository,
      userId: "user-a",
      commandId: original.id,
      digest: original.digest,
      itemChanges: [{ applicationId: "1", followUpAt: "2026-09-22T09:00:00.000Z" }],
      idempotencyKey: "heterogeneous-first",
      now: NOW,
    });
    const secondRevision = await reviseBulkPreview({
      repository,
      userId: "user-a",
      commandId: firstRevision.id,
      digest: firstRevision.digest,
      itemChanges: [{ applicationId: "2", followUpAt: "2026-09-23T09:00:00.000Z" }],
      idempotencyKey: "heterogeneous-second",
      now: NOW,
    });

    expect(secondRevision.items.map((item) => item.after.followUpAt)).toEqual([
      "2026-09-22T09:00:00.000Z",
      "2026-09-23T09:00:00.000Z",
      "2026-09-21T09:00:00.000Z",
    ]);
  });

  it("binds revision idempotency to its source and exact edits", async () => {
    const repository = new MemoryBulkRepository();
    repository.candidates = [candidate(1), candidate(2)];
    const original = await createBulkPreview({
      repository,
      userId: "user-a",
      actionType: "reschedule_follow_up",
      scope: { mode: "selected", applicationIds: ["1", "2"] },
      changes: { followUpAt: "2026-09-21T09:00:00.000Z" },
      idempotencyKey: "revision-binding-original",
      now: NOW,
    });
    const revisionInput = {
      repository,
      userId: "user-a",
      commandId: original.id,
      digest: original.digest,
      excludedApplicationIds: ["2"],
      idempotencyKey: "revision-binding-edit",
      now: NOW,
    };
    const revision = await reviseBulkPreview(revisionInput);
    expect(await reviseBulkPreview(revisionInput)).toBe(revision);
    await expect(reviseBulkPreview({
      ...revisionInput,
      excludedApplicationIds: [],
    })).rejects.toThrow("Bulk idempotency key was reused with different input");
    await expect(reviseBulkPreview({
      ...revisionInput,
      idempotencyKey: "revision-binding-original",
    })).rejects.toThrow("Bulk idempotency key was reused with different input");

    const originalLookup = repository.findByIdempotencyKey.bind(repository);
    let raceLookups = 0;
    repository.findByIdempotencyKey = async (userId, key) => {
      if (key === "revision-binding-edit" && ++raceLookups === 1) return null;
      return originalLookup(userId, key);
    };
    repository.createRevision = async () => null;
    await expect(reviseBulkPreview(revisionInput)).resolves.toBe(revision);
  });

  it("binds approval and execution to the exact unexpired digest", async () => {
    const repository = new MemoryBulkRepository();
    repository.candidates = [candidate(1)];
    const preview = await createBulkPreview({
      repository,
      userId: "user-a",
      actionType: "archive",
      scope: { mode: "selected", applicationIds: ["1"] },
      idempotencyKey: "preview-3",
      now: NOW,
    });

    await expect(approveBulkCommand(repository, "user-a", preview.id, "wrong", NOW))
      .rejects.toThrow("Bulk preview changed or is unavailable");
    const approved = await approveBulkCommand(repository, "user-a", preview.id, preview.digest, NOW);
    expect(approved).toMatchObject({ status: "approved", approvedDigest: preview.digest });
    await expect(queueBulkCommand(repository, "user-a", preview.id, "wrong", NOW))
      .rejects.toThrow("Bulk approval does not match this plan");
    await expect(queueBulkCommand(repository, "user-b", preview.id, preview.digest, NOW))
      .rejects.toThrow("Bulk approval does not match this plan");
    const queued = await queueBulkCommand(repository, "user-a", preview.id, preview.digest, NOW);
    expect(queued.status).toBe("queued");
    expect(await approveBulkCommand(repository, "user-a", preview.id, preview.digest, NOW)).toBe(queued);
    expect(await queueBulkCommand(repository, "user-a", preview.id, preview.digest, NOW)).toBe(queued);
  });

  it("persists pause, resume, cancel, and undo as distinct lifecycle operations", async () => {
    const repository = new MemoryBulkRepository();
    repository.candidates = [candidate(1)];
    const preview = await createBulkPreview({
      repository,
      userId: "user-a",
      actionType: "archive",
      scope: { mode: "selected", applicationIds: ["1"] },
      idempotencyKey: "control-preview",
      now: NOW,
    });
    await approveBulkCommand(repository, "user-a", preview.id, preview.digest, NOW);
    await queueBulkCommand(repository, "user-a", preview.id, preview.digest, NOW);
    expect((await requestBulkPause(repository, "user-a", preview.id)).status).toBe("pause_requested");
    repository.commands[0].status = "paused";
    expect((await resumeBulkCommand(repository, "user-a", preview.id)).status).toBe("queued");
    expect((await requestBulkCancel(repository, "user-a", preview.id)).status).toBe("cancel_requested");
    repository.commands[0].status = "completed";
    repository.commands[0].items[0].status = "applied";
    expect((await requestBulkUndo(repository, "user-a", preview.id, preview.digest, NOW))).toMatchObject({
      status: "undo_queued",
      items: [expect.objectContaining({ undoStatus: "pending" })],
    });
  });
});
