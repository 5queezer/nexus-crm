import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DatabaseAdapter } from "@/lib/db/adapter";

export const APPLICATION_STATUSES = [
  "inbound",
  "applied",
  "interview",
  "offer",
  "rejected",
] as const;

export type ApplicationProposalChanges = {
  status?: string;
  followUpAt?: string | null;
  lastContact?: string | null;
  notes?: string | null;
  rating?: number | null;
};

export type ProposalDiff = { field: string; from: unknown; to: unknown };

export type ProposalRecord = {
  id: string;
  userId: string;
  threadId?: string | null;
  runId?: string | null;
  toolInvocationId?: string | null;
  kind: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  expectedDiff: ProposalDiff[];
  assumptions?: unknown;
  baseVersion?: Date | null;
  idempotencyKey: string;
  status: string;
  expiresAt: Date;
  executedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ProposalRepository {
  create(
    input: Omit<ProposalRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<ProposalRecord>;
  findByIdempotencyKey(userId: string, key: string): Promise<ProposalRecord | null>;
}

function mapProposal(record: {
  id: string;
  userId: string;
  threadId: string | null;
  runId: string | null;
  toolInvocationId: string | null;
  kind: string;
  targetType: string;
  targetId: string;
  payload: unknown;
  expectedDiff: unknown;
  assumptions: unknown;
  baseVersion: Date | null;
  idempotencyKey: string;
  status: string;
  expiresAt: Date;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ProposalRecord {
  return {
    ...record,
    payload: record.payload as Record<string, unknown>,
    expectedDiff: record.expectedDiff as ProposalDiff[],
  };
}

export const prismaProposalRepository: ProposalRepository = {
  async create(input) {
    const record = await prisma.actionProposal.create({
      data: {
        userId: input.userId,
        threadId: input.threadId ?? null,
        runId: input.runId ?? null,
        toolInvocationId: input.toolInvocationId ?? null,
        kind: input.kind,
        targetType: input.targetType,
        targetId: input.targetId,
        payload: input.payload as Prisma.InputJsonValue,
        expectedDiff: input.expectedDiff as unknown as Prisma.InputJsonValue,
        assumptions: input.assumptions as Prisma.InputJsonValue | undefined,
        baseVersion: input.baseVersion ?? null,
        idempotencyKey: input.idempotencyKey,
        status: input.status,
        expiresAt: input.expiresAt,
        executedAt: input.executedAt ?? null,
      },
    });
    return mapProposal(record);
  },
  async findByIdempotencyKey(userId, key) {
    const record = await prisma.actionProposal.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    });
    return record ? mapProposal(record) : null;
  },
};

const ALLOWED_STATUSES = new Set<string>(APPLICATION_STATUSES);
const ALLOWED_FIELDS = new Set(["status", "followUpAt", "lastContact", "notes", "rating"]);

function canonicalizeChanges(changes: ApplicationProposalChanges): ApplicationProposalChanges {
  for (const field of Object.keys(changes)) {
    if (!ALLOWED_FIELDS.has(field)) throw new Error("Unsupported application change");
  }
  const canonical: ApplicationProposalChanges = {};
  if (changes.status !== undefined) {
    if (!ALLOWED_STATUSES.has(changes.status)) throw new Error("Unsupported application status");
    canonical.status = changes.status;
  }
  for (const field of ["followUpAt", "lastContact"] as const) {
    const value = changes[field];
    if (value !== undefined) {
      if (value === null) canonical[field] = null;
      else {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field}`);
        canonical[field] = date.toISOString();
      }
    }
  }
  if (changes.notes !== undefined) {
    if (changes.notes !== null && changes.notes.length > 5_000) throw new Error("Notes are too long");
    canonical.notes = changes.notes;
  }
  if (changes.rating !== undefined) {
    if (changes.rating !== null && (!Number.isInteger(changes.rating) || changes.rating < 1 || changes.rating > 5)) {
      throw new Error("Rating must be between 1 and 5");
    }
    canonical.rating = changes.rating;
  }
  if (!Object.keys(canonical).length) throw new Error("At least one application change is required");
  return canonical;
}

async function revalidateProposalTarget(
  db: DatabaseAdapter,
  userId: string,
  proposal: ProposalRecord,
): Promise<ProposalRecord> {
  const application = await db.getApplication(proposal.targetId, userId, {
    demoVisibility: "exclude",
  });
  if (!application) throw new Error("Application not found");
  return proposal;
}

export async function proposeApplicationUpdate(input: {
  db: DatabaseAdapter;
  repository: ProposalRepository;
  userId: string;
  threadId?: string;
  runId?: string;
  toolInvocationId?: string;
  applicationId: string;
  changes: ApplicationProposalChanges;
  reason: string;
  idempotencyKey?: string;
}) {
  const key = input.idempotencyKey ?? randomUUID();
  const existing = await input.repository.findByIdempotencyKey(input.userId, key);
  if (existing) return revalidateProposalTarget(input.db, input.userId, existing);

  const application = await input.db.getApplication(input.applicationId, input.userId, {
    demoVisibility: "exclude",
  });
  if (!application) throw new Error("Application not found");
  const payload = canonicalizeChanges(input.changes);
  const expectedDiff: ProposalDiff[] = Object.entries(payload).map(([field, to]) => {
    const current = application[field as keyof typeof application];
    return {
      field,
      from: current instanceof Date ? current.toISOString() : current,
      to,
    };
  });

  try {
    return await input.repository.create({
      userId: input.userId,
      threadId: input.threadId ?? null,
      runId: input.runId ?? null,
      toolInvocationId: input.toolInvocationId ?? null,
      kind: "update_application",
      targetType: "application",
      targetId: application.id,
      payload: payload as Record<string, unknown>,
      expectedDiff,
      assumptions: { reason: input.reason.trim().slice(0, 1_000) },
      baseVersion: application.updatedAt,
      idempotencyKey: key,
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      executedAt: null,
    });
  } catch (error) {
    const details = error && typeof error === "object"
      ? error as { code?: unknown; meta?: { target?: unknown } }
      : null;
    const target = details?.meta?.target;
    const idempotencyTarget =
      target === "ActionProposal_userId_idempotencyKey_key" ||
      (Array.isArray(target) &&
        target.length === 2 &&
        target.includes("userId") &&
        target.includes("idempotencyKey"));
    if (String(details?.code ?? "") !== "P2002" || !idempotencyTarget) throw error;
    const winner = await input.repository.findByIdempotencyKey(input.userId, key);
    if (!winner) throw error;
    return revalidateProposalTarget(input.db, input.userId, winner);
  }
}
