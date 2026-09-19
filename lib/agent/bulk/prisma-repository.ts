import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSourceCategory } from "@/types";
import type {
  BulkActionType,
  BulkApplicationCandidate,
  BulkCommandCreate,
  BulkCommandItemRecord,
  BulkCommandRecord,
  BulkCommandRepository,
  BulkCommandStatus,
  BulkCommandTransition,
  BulkScope,
} from "./types";

type CommandWithItems = Prisma.BulkCommandGetPayload<{ include: { items: true } }>;

const BULK_RESOLUTION_PAGE_SIZE = 500;
const BULK_MAX_MATCHES = 10_000;
const BULK_MAX_SCANNED_ROWS = 50_000;
const BULK_RESOLUTION_TIME_MS = 5_000;

const bulkApplicationSelect = {
  id: true,
  company: true,
  role: true,
  status: true,
  source: true,
  remote: true,
  workMode: true,
  followUpAt: true,
  archivedAt: true,
  notes: true,
  jobSummary: true,
  nextAction: true,
  triageQuality: true,
  contacts: { select: { name: true } },
  eventVersion: true,
} satisfies Prisma.ApplicationSelect;

type BulkApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof bulkApplicationSelect }>;

export async function collectSourceFilteredRows<T extends { id: number; source: string | null }>(input: {
  fetchPage(cursor: number | undefined, take: number): Promise<T[]>;
  sourceCategories?: string[];
  pageSize?: number;
  maxMatches?: number;
  maxScanned?: number;
  deadlineMs?: number;
  now?: () => number;
}): Promise<T[]> {
  const pageSize = input.pageSize ?? BULK_RESOLUTION_PAGE_SIZE;
  const maxMatches = input.maxMatches ?? BULK_MAX_MATCHES;
  const maxScanned = input.maxScanned ?? BULK_MAX_SCANNED_ROWS;
  const now = input.now ?? Date.now;
  const deadlineMs = input.deadlineMs ?? now() + BULK_RESOLUTION_TIME_MS;
  const categories = input.sourceCategories ?? [];
  const matches: T[] = [];
  let cursor: number | undefined;
  let scanned = 0;
  while (true) {
    if (scanned >= maxScanned) {
      throw new Error(`Bulk scope exceeds the ${maxScanned} row scan budget; refine filters`);
    }
    if (now() > deadlineMs) throw new Error("Bulk scope resolution exceeded the time budget; refine filters");
    const take = Math.min(pageSize, maxScanned - scanned);
    const page = await input.fetchPage(cursor, take);
    scanned += page.length;
    for (const row of page) {
      if (!categories.length || categories.includes(getSourceCategory(row.source))) matches.push(row);
      if (matches.length > maxMatches) {
        throw new Error(`Bulk scope exceeds the ${maxMatches} target budget`);
      }
    }
    if (page.length < take) return matches;
    if (now() > deadlineMs) throw new Error("Bulk scope resolution exceeded the time budget; refine filters");
    cursor = page[page.length - 1].id;
  }
}

function numericId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid application id");
  return id;
}

export function buildBulkApplicationWhere(
  userId: string,
  scope: BulkScope,
  actionType: BulkActionType,
): Prisma.ApplicationWhereInput {
  const where: Prisma.ApplicationWhereInput = { userId, isDemo: false };
  if (scope.mode === "selected") {
    where.id = { in: scope.applicationIds.map(numericId) };
  } else {
    const { filters } = scope;
    if (filters.query) where.OR = [
      { company: { contains: filters.query, mode: "insensitive" } },
      { role: { contains: filters.query, mode: "insensitive" } },
      { source: { contains: filters.query, mode: "insensitive" } },
      { notes: { contains: filters.query, mode: "insensitive" } },
      { contacts: { some: { name: { contains: filters.query, mode: "insensitive" } } } },
    ];
    if (filters.statuses?.length) where.status = { in: filters.statuses };
    if (filters.remote !== undefined) where.remote = filters.remote;
    if (filters.workModes?.length) {
      if (filters.workModes.includes("remote")) {
        where.AND = [{
          OR: [
            { workMode: { in: filters.workModes } },
            { workMode: null, remote: true },
          ],
        }];
      } else {
        where.workMode = { in: filters.workModes };
      }
    }
    if (filters.triageQualityMin !== undefined) where.triageQuality = { gte: filters.triageQualityMin };
    if (filters.followUpBefore) where.followUpAt = { lt: new Date(filters.followUpBefore) };
    if (actionType === "reschedule_follow_up") {
      if (filters.archived === "archived") where.archivedAt = { not: null };
      else if (filters.archived !== "all") where.archivedAt = null;
    }
  }
  if (actionType === "archive") where.archivedAt = null;
  if (actionType === "restore") where.archivedAt = { not: null };
  return where;
}

function mapItem(record: CommandWithItems["items"][number]): BulkCommandItemRecord {
  return {
    id: record.id,
    commandId: record.commandId,
    applicationId: String(record.applicationId),
    company: record.company,
    role: record.role,
    ordinal: record.ordinal,
    expectedVersion: record.expectedVersion,
    before: record.before as BulkCommandItemRecord["before"],
    after: record.after as BulkCommandItemRecord["after"],
    reason: record.reason,
    evidence: record.evidence,
    idempotencyKey: record.idempotencyKey,
    status: record.status as BulkCommandItemRecord["status"],
    attempts: record.attempts,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    appliedVersion: record.appliedVersion,
    appliedBefore: record.appliedBefore as BulkCommandItemRecord["appliedBefore"],
    appliedAfter: record.appliedAfter as BulkCommandItemRecord["appliedAfter"],
    appliedAt: record.appliedAt,
    verifiedAt: record.verifiedAt,
    undoStatus: record.undoStatus as BulkCommandItemRecord["undoStatus"],
    undoExpectedVersion: record.undoExpectedVersion,
    undoAppliedAt: record.undoAppliedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapCommand(record: CommandWithItems): BulkCommandRecord {
  return {
    id: record.id,
    userId: record.userId,
    threadId: record.threadId,
    runId: record.runId,
    actionType: record.actionType as BulkActionType,
    scope: record.scope as BulkScope,
    reason: record.reason,
    exclusions: record.exclusions as BulkCommandRecord["exclusions"],
    requestHash: record.requestHash,
    digest: record.digest,
    approvedDigest: record.approvedDigest,
    idempotencyKey: record.idempotencyKey,
    status: record.status as BulkCommandStatus,
    expiresAt: record.expiresAt,
    approvedAt: record.approvedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    pauseRequestedAt: record.pauseRequestedAt,
    cancelRequestedAt: record.cancelRequestedAt,
    undoRequestedAt: record.undoRequestedAt,
    supersedesId: record.supersedesId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    items: record.items.map(mapItem),
  };
}

function commandData(input: BulkCommandCreate): Prisma.BulkCommandCreateInput {
  return {
    id: input.id,
    user: { connect: { id: input.userId } },
    ...(input.threadId ? { thread: { connect: { id: input.threadId } } } : {}),
    ...(input.runId ? { run: { connect: { id: input.runId } } } : {}),
    ...(input.supersedesId ? { supersedes: { connect: { id: input.supersedesId } } } : {}),
    actionType: input.actionType,
    scope: input.scope as Prisma.InputJsonValue,
    reason: input.reason,
    exclusions: input.exclusions as unknown as Prisma.InputJsonValue,
    requestHash: input.requestHash,
    digest: input.digest,
    idempotencyKey: input.idempotencyKey,
    status: input.status,
    expiresAt: input.expiresAt,
    items: {
      create: input.items.map((item) => ({
        userId: input.userId,
        applicationId: numericId(item.applicationId),
        isDemo: false,
        company: item.company,
        role: item.role,
        ordinal: item.ordinal,
        expectedVersion: item.expectedVersion,
        before: item.before as Prisma.InputJsonValue,
        after: item.after as Prisma.InputJsonValue,
        reason: item.reason,
        evidence: item.evidence as Prisma.InputJsonValue,
        idempotencyKey: item.idempotencyKey,
      })),
    },
  };
}

async function findCommand(userId: string, id: string): Promise<BulkCommandRecord | null> {
  const record = await prisma.bulkCommand.findFirst({
    where: { id, userId },
    include: { items: { orderBy: { ordinal: "asc" } } },
  });
  return record ? mapCommand(record) : null;
}

function transitionData(transition: BulkCommandTransition): Prisma.BulkCommandUpdateManyMutationInput {
  const patch = transition.patch;
  return {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.approvedDigest !== undefined ? { approvedDigest: patch.approvedDigest } : {}),
    ...(patch.approvedAt !== undefined ? { approvedAt: patch.approvedAt } : {}),
    ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
    ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
    ...(patch.pauseRequestedAt !== undefined ? { pauseRequestedAt: patch.pauseRequestedAt } : {}),
    ...(patch.cancelRequestedAt !== undefined ? { cancelRequestedAt: patch.cancelRequestedAt } : {}),
    ...(patch.undoRequestedAt !== undefined ? { undoRequestedAt: patch.undoRequestedAt } : {}),
  };
}

export const prismaBulkCommandRepository: BulkCommandRepository = {
  async resolveApplications(userId, scope, actionType): Promise<BulkApplicationCandidate[]> {
    const where = buildBulkApplicationWhere(userId, scope, actionType);
    let rows: BulkApplicationRow[];
    if (scope.mode === "selected") {
      rows = await prisma.application.findMany({
        where,
        orderBy: { id: "asc" },
        select: bulkApplicationSelect,
      });
    } else {
      rows = await collectSourceFilteredRows({
        sourceCategories: scope.filters.sources,
        fetchPage: (cursor, take) => prisma.application.findMany({
          where,
          orderBy: { id: "asc" },
          take,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
          select: bulkApplicationSelect,
        }),
      });
    }
    return rows.map((row) => ({ ...row, id: String(row.id) }));
  },

  async findByIdempotencyKey(userId, key) {
    const record = await prisma.bulkCommand.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
      include: { items: { orderBy: { ordinal: "asc" } } },
    });
    return record ? mapCommand(record) : null;
  },

  async createCommand(input) {
    try {
      return mapCommand(await prisma.$transaction(async (tx) => {
        if (input.threadId) {
          const thread = await tx.agentThread.count({ where: { id: input.threadId, userId: input.userId } });
          if (thread !== 1) throw new Error("Agent thread not found");
        }
        if (input.runId) {
          const run = await tx.agentRun.findFirst({
            where: { id: input.runId, userId: input.userId },
            select: { threadId: true },
          });
          if (!run || (input.threadId && run.threadId !== input.threadId)) throw new Error("Agent run not found");
        }
        return tx.bulkCommand.create({
          data: commandData(input),
          include: { items: { orderBy: { ordinal: "asc" } } },
        });
      }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.findByIdempotencyKey(input.userId, input.idempotencyKey);
        if (winner && winner.requestHash === input.requestHash) return winner;
      }
      throw error;
    }
  },

  findCommand,

  async createRevision(userId, sourceId, sourceDigest, input) {
    return prisma.$transaction(async (tx) => {
      const source = await tx.bulkCommand.findFirst({
        where: { id: sourceId, userId, digest: sourceDigest },
        select: { id: true, status: true },
      });
      if (!source) return null;
      if (!["preview", "approved", "completed", "completed_with_errors", "cancelled"].includes(source.status)) {
        return null;
      }
      if (["preview", "approved"].includes(source.status)) {
        const invalidated = await tx.bulkCommand.updateMany({
          where: { id: sourceId, userId, digest: sourceDigest, status: { in: ["preview", "approved"] } },
          data: { status: "superseded", approvedDigest: null, approvedAt: null },
        });
        if (invalidated.count !== 1) return null;
      }
      const record = await tx.bulkCommand.create({
        data: commandData(input),
        include: { items: { orderBy: { ordinal: "asc" } } },
      });
      return mapCommand(record);
    });
  },

  async transitionCommand(userId, id, transition) {
    const result = await prisma.bulkCommand.updateMany({
      where: {
        id,
        userId,
        status: { in: transition.from },
        ...(transition.digest !== undefined ? { digest: transition.digest } : {}),
        ...(transition.notExpiredAt ? { expiresAt: { gt: transition.notExpiredAt } } : {}),
      },
      data: transitionData(transition),
    });
    return result.count === 1 ? findCommand(userId, id) : null;
  },

  async queueUndo(userId, id, digest, now) {
    return prisma.$transaction(async (tx) => {
      const command = await tx.bulkCommand.findFirst({
        where: {
          id,
          userId,
          digest,
          status: { in: ["completed", "completed_with_errors", "cancelled"] },
          items: { some: { status: "applied" } },
        },
        select: { id: true, status: true },
      });
      if (!command) return null;
      const transitioned = await tx.bulkCommand.updateMany({
        where: { id, userId, digest, status: command.status },
        data: {
          status: "undo_queued",
          undoRequestedAt: now,
          completedAt: null,
          workerToken: null,
          leaseExpiresAt: null,
        },
      });
      if (transitioned.count !== 1) return null;
      await tx.bulkCommandItem.updateMany({
        where: { commandId: id, userId, status: "applied", undoStatus: null },
        data: { undoStatus: "pending", attempts: 0, errorCode: null, errorMessage: null },
      });
      const record = await tx.bulkCommand.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { ordinal: "asc" } } },
      });
      return mapCommand(record);
    });
  },
};
