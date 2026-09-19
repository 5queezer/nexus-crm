import { randomUUID } from "node:crypto";
import { followUpHoldReason } from "@/lib/applications/follow-up-policy";
import { stableDigest } from "./digest";
import type {
  BulkApplicationCandidate,
  BulkCommandCreate,
  BulkCommandItemCreate,
  BulkCommandRecord,
  BulkCommandRepository,
  BulkFieldSnapshot,
  BulkPreviewRequest,
  BulkScope,
} from "./types";

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;

function normalizeReason(reason: string | undefined): string | null {
  const normalized = reason?.trim().replace(/\s+/g, " ").slice(0, 1_000);
  return normalized || null;
}

function normalizeIdList(values: string[]): string[] {
  const ids = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  if (!ids.length || ids.length > 10_000) throw new Error("Bulk scope must contain between 1 and 10000 targets");
  return ids;
}

function normalizeScope(scope: BulkScope): BulkScope {
  if (scope.mode === "selected") return { mode: "selected", applicationIds: normalizeIdList(scope.applicationIds) };
  const filters = scope.filters;
  return {
    mode: "all_matching",
    filters: {
      ...(filters.query?.trim() ? { query: filters.query.trim().slice(0, 200) } : {}),
      ...(filters.statuses?.length ? { statuses: [...new Set(filters.statuses)].sort() } : {}),
      ...(filters.sources?.length ? { sources: [...new Set(filters.sources)].sort() } : {}),
      ...(filters.remote !== undefined ? { remote: filters.remote } : {}),
      ...(filters.workModes?.length ? { workModes: [...new Set(filters.workModes)].sort() } : {}),
      ...(filters.triageQualityMin !== undefined
        ? { triageQualityMin: Math.max(1, Math.min(5, Math.trunc(filters.triageQualityMin))) }
        : {}),
      ...(filters.followUpBefore
        ? { followUpBefore: isoTimestamp(filters.followUpBefore, "followUpBefore") }
        : {}),
      ...(filters.archived ? { archived: filters.archived } : {}),
    },
  };
}

function isoTimestamp(value: string | undefined, field: string): string {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`${field} must include a time zone`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid timestamp`);
  return date.toISOString();
}

function snapshots(
  actionType: BulkPreviewRequest["actionType"],
  application: BulkApplicationCandidate,
  changes: BulkPreviewRequest["changes"],
  now: Date,
): { before: BulkFieldSnapshot; after: BulkFieldSnapshot } {
  if (actionType === "reschedule_follow_up") {
    return {
      before: { followUpAt: application.followUpAt?.toISOString() ?? null },
      after: { followUpAt: isoTimestamp(changes?.followUpAt, "followUpAt") },
    };
  }
  const archivedAt = application.archivedAt?.toISOString() ?? null;
  return actionType === "archive"
    ? { before: { archivedAt }, after: { archivedAt: now.toISOString() } }
    : { before: { archivedAt }, after: { archivedAt: null } };
}

function buildExclusion(
  application: BulkApplicationCandidate,
  code: string,
  reason: string,
) {
  return {
    applicationId: application.id,
    company: application.company,
    role: application.role,
    code,
    reason,
  };
}

async function buildCommand(input: BulkPreviewRequest & {
  id: string;
  supersedesId: string | null;
  forcedChanges?: Map<string, string>;
  excludedApplicationIds?: Set<string>;
}): Promise<BulkCommandCreate> {
  const now = input.now ?? new Date();
  const scope = normalizeScope(input.scope);
  const applications = await input.repository.resolveApplications(input.userId, scope, input.actionType);
  if (applications.length > 10_000) throw new Error("Bulk scope exceeds the 10000 target budget");
  if (scope.mode === "selected") {
    const resolved = new Set(applications.map((application) => application.id));
    if (scope.applicationIds.some((id) => !resolved.has(id))) {
      throw new Error("One or more applications are unavailable");
    }
  }
  const reason = normalizeReason(input.reason);
  const exclusions: BulkCommandCreate["exclusions"] = [];
  const items: BulkCommandItemCreate[] = [];
  for (const application of applications.sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true }),
  )) {
    if (input.excludedApplicationIds?.has(application.id)) {
      exclusions.push(buildExclusion(application, "user_excluded", "Excluded during review"));
      continue;
    }
    if (input.actionType === "archive" && application.archivedAt) {
      exclusions.push(buildExclusion(application, "already_archived", "Application is already archived"));
      continue;
    }
    if (input.actionType === "restore" && !application.archivedAt) {
      exclusions.push(buildExclusion(application, "not_archived", "Application is not archived"));
      continue;
    }
    if (input.actionType === "reschedule_follow_up") {
      const holdReason = followUpHoldReason(application);
      if (holdReason) {
        exclusions.push(buildExclusion(application, "explicit_wait_instruction", holdReason));
        continue;
      }
    }
    const itemChanges = input.forcedChanges?.has(application.id)
      ? { followUpAt: input.forcedChanges.get(application.id) }
      : input.changes;
    const { before, after } = snapshots(input.actionType, application, itemChanges, now);
    if (stableDigest(before) === stableDigest(after)) {
      exclusions.push(buildExclusion(application, "no_change", "Application already has the proposed value"));
      continue;
    }
    const ordinal = items.length;
    items.push({
      applicationId: application.id,
      company: application.company,
      role: application.role,
      ordinal,
      expectedVersion: application.eventVersion,
      before,
      after,
      reason,
      evidence: { source: "server_resolved_preview" },
      idempotencyKey: `bulk:${input.id}:${application.id}:apply`,
    });
  }
  if (!items.length) throw new Error("Bulk preview has no applicable targets");
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
  const executablePlan = {
    version: 1,
    id: input.id,
    userId: input.userId,
    actionType: input.actionType,
    scope,
    reason,
    exclusions,
    expiresAt: expiresAt.toISOString(),
    items: items.map(({ applicationId, expectedVersion, before, after, reason: itemReason, evidence }) => ({
      applicationId,
      expectedVersion,
      before,
      after,
      reason: itemReason,
      evidence,
    })),
  };
  const requestHash = stableDigest({ actionType: input.actionType, scope, changes: input.changes ?? null, reason });
  return {
    id: input.id,
    userId: input.userId,
    threadId: input.threadId ?? null,
    runId: input.runId ?? null,
    actionType: input.actionType,
    scope,
    reason,
    exclusions,
    requestHash,
    digest: stableDigest(executablePlan),
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    status: "preview",
    expiresAt,
    supersedesId: input.supersedesId,
    items,
  };
}

export async function createBulkPreview(input: BulkPreviewRequest): Promise<BulkCommandRecord> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const existing = await input.repository.findByIdempotencyKey(input.userId, idempotencyKey);
  if (existing) {
    const normalizedScope = normalizeScope(input.scope);
    const requestHash = stableDigest({
      actionType: input.actionType,
      scope: normalizedScope,
      changes: input.changes ?? null,
      reason: normalizeReason(input.reason),
    });
    if (existing.requestHash !== requestHash) throw new Error("Bulk idempotency key was reused with different input");
    return existing;
  }
  const command = await buildCommand({
    ...input,
    idempotencyKey,
    id: input.idFactory?.() ?? randomUUID(),
    supersedesId: null,
  });
  return input.repository.createCommand(command);
}

export async function reviseBulkPreview(input: {
  repository: BulkCommandRepository;
  userId: string;
  commandId: string;
  digest: string;
  excludedApplicationIds?: string[];
  itemChanges?: Array<{ applicationId: string; followUpAt: string }>;
  reason?: string;
  idempotencyKey?: string;
  now?: Date;
  idFactory?: () => string;
}): Promise<BulkCommandRecord> {
  const source = await input.repository.findCommand(input.userId, input.commandId);
  if (!source || source.digest !== input.digest) throw new Error("Bulk preview changed or is unavailable");
  const normalizedExcluded = [...new Set(input.excludedApplicationIds ?? [])].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  const excluded = new Set(normalizedExcluded);
  const sourceIds = new Set(source.items.map((item) => item.applicationId));
  if ([...excluded].some((id) => !sourceIds.has(id))) throw new Error("Revision contains an unknown target");
  const forcedChanges = new Map<string, string>(
    source.actionType === "reschedule_follow_up"
      ? source.items.map((item) => [item.applicationId, String(item.after.followUpAt)])
      : [],
  );
  const canonicalChanges = (input.itemChanges ?? []).map((change) => ({
    applicationId: change.applicationId,
    followUpAt: isoTimestamp(change.followUpAt, "followUpAt"),
  })).sort((left, right) => left.applicationId.localeCompare(right.applicationId, undefined, { numeric: true }));
  if (new Set(canonicalChanges.map((change) => change.applicationId)).size !== canonicalChanges.length) {
    throw new Error("Revision contains duplicate target changes");
  }
  for (const change of canonicalChanges) {
    if (!sourceIds.has(change.applicationId)) throw new Error("Revision contains an unknown target");
    forcedChanges.set(change.applicationId, change.followUpAt);
  }
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const revisionReason = normalizeReason(input.reason ?? source.reason ?? undefined);
  const revisionRequestHash = stableDigest({
    sourceId: source.id,
    sourceDigest: source.digest,
    excludedApplicationIds: normalizedExcluded,
    itemChanges: canonicalChanges,
    reason: revisionReason,
  });
  const existing = await input.repository.findByIdempotencyKey(input.userId, idempotencyKey);
  if (existing) {
    if (existing.requestHash !== revisionRequestHash || existing.supersedesId !== source.id) {
      throw new Error("Bulk idempotency key was reused with different input");
    }
    return existing;
  }
  const id = input.idFactory?.() ?? randomUUID();
  const command = await buildCommand({
    repository: input.repository,
    userId: input.userId,
    actionType: source.actionType,
    scope: { mode: "selected", applicationIds: source.items.map((item) => item.applicationId) },
    changes: source.actionType === "reschedule_follow_up"
      ? { followUpAt: String(source.items[0]?.after.followUpAt) }
      : undefined,
    reason: revisionReason ?? undefined,
    threadId: source.threadId ?? undefined,
    runId: source.runId ?? undefined,
    idempotencyKey,
    now: input.now,
    id,
    supersedesId: source.id,
    forcedChanges,
    excludedApplicationIds: excluded,
  });
  command.requestHash = revisionRequestHash;
  const created = await input.repository.createRevision(input.userId, source.id, source.digest, command);
  if (!created) {
    const winner = await input.repository.findByIdempotencyKey(input.userId, idempotencyKey);
    if (
      winner &&
      winner.requestHash === revisionRequestHash &&
      winner.supersedesId === source.id
    ) return winner;
    throw new Error("Bulk preview changed or is unavailable");
  }
  return created;
}

export async function approveBulkCommand(
  repository: BulkCommandRepository,
  userId: string,
  commandId: string,
  digest: string,
  now = new Date(),
): Promise<BulkCommandRecord> {
  const existing = await repository.findCommand(userId, commandId);
  if (
    existing &&
    existing.digest === digest &&
    existing.approvedDigest === digest &&
    existing.status !== "preview" &&
    existing.status !== "superseded"
  ) return existing;
  const approved = await repository.transitionCommand(userId, commandId, {
    from: ["preview"],
    digest,
    notExpiredAt: now,
    patch: { status: "approved", approvedDigest: digest, approvedAt: now },
  });
  if (!approved) throw new Error("Bulk preview changed or is unavailable");
  return approved;
}

export async function queueBulkCommand(
  repository: BulkCommandRepository,
  userId: string,
  commandId: string,
  digest: string,
  now = new Date(),
): Promise<BulkCommandRecord> {
  const command = await repository.findCommand(userId, commandId);
  if (
    command &&
    command.digest === digest &&
    command.approvedDigest === digest &&
    [
      "queued", "running", "pause_requested", "paused", "cancel_requested", "cancelled",
      "completed", "completed_with_errors", "undo_queued", "undo_running", "undo_completed",
      "undo_completed_with_errors",
    ].includes(command.status)
  ) return command;
  if (
    !command ||
    command.status !== "approved" ||
    command.digest !== digest ||
    command.approvedDigest !== digest ||
    command.expiresAt <= now
  ) throw new Error("Bulk approval does not match this plan");
  const queued = await repository.transitionCommand(userId, commandId, {
    from: ["approved"],
    digest,
    notExpiredAt: now,
    patch: { status: "queued" },
  });
  if (!queued) throw new Error("Bulk approval does not match this plan");
  return queued;
}

export async function requestBulkPause(
  repository: BulkCommandRepository,
  userId: string,
  commandId: string,
  now = new Date(),
): Promise<BulkCommandRecord> {
  const existing = await repository.findCommand(userId, commandId);
  if (existing && ["pause_requested", "paused"].includes(existing.status)) return existing;
  const command = await repository.transitionCommand(userId, commandId, {
    from: ["queued", "running"],
    patch: { status: "pause_requested", pauseRequestedAt: now },
  });
  if (!command) throw new Error("Bulk command cannot be paused");
  return command;
}

export async function resumeBulkCommand(
  repository: BulkCommandRepository,
  userId: string,
  commandId: string,
): Promise<BulkCommandRecord> {
  const existing = await repository.findCommand(userId, commandId);
  if (existing?.status === "queued") return existing;
  const command = await repository.transitionCommand(userId, commandId, {
    from: ["paused", "pause_requested"],
    patch: { status: "queued", pauseRequestedAt: null },
  });
  if (!command) throw new Error("Bulk command cannot be resumed");
  return command;
}

export async function requestBulkCancel(
  repository: BulkCommandRepository,
  userId: string,
  commandId: string,
  now = new Date(),
): Promise<BulkCommandRecord> {
  const existing = await repository.findCommand(userId, commandId);
  if (existing && ["cancel_requested", "cancelled"].includes(existing.status)) return existing;
  const command = await repository.transitionCommand(userId, commandId, {
    from: ["queued", "running", "pause_requested", "paused"],
    patch: { status: "cancel_requested", cancelRequestedAt: now },
  });
  if (!command) throw new Error("Bulk command cannot be cancelled");
  return command;
}

export async function requestBulkUndo(
  repository: BulkCommandRepository,
  userId: string,
  commandId: string,
  digest: string,
  now = new Date(),
): Promise<BulkCommandRecord> {
  const existing = await repository.findCommand(userId, commandId);
  if (
    existing &&
    existing.digest === digest &&
    ["undo_queued", "undo_running", "undo_completed", "undo_completed_with_errors"].includes(existing.status)
  ) return existing;
  const command = await repository.queueUndo(userId, commandId, digest, now);
  if (!command) throw new Error("Bulk command cannot be undone");
  return command;
}
