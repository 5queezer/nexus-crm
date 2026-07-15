import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AgentMessageView = {
  id: string;
  userId: string;
  threadId: string;
  runId?: string | null;
  role: string;
  content: string;
  metadata?: unknown;
  createdAt: Date;
};

export type AgentActivityView = {
  id: string;
  type: "run" | "tool";
  runId: string;
  toolName: string | null;
  status: string;
  durationMs: number | null;
  proposalId: string | null;
  createdAt: Date;
};

export type AgentThreadView = {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: AgentMessageView[];
  proposals: unknown[];
  activities: AgentActivityView[];
};

export interface AgentRepository {
  createThread(userId: string, title: string): Promise<AgentThreadView>;
  listThreads(userId: string): Promise<AgentThreadView[]>;
  findThread(userId: string, threadId: string): Promise<AgentThreadView | null>;
  removeThread(userId: string, threadId: string): Promise<boolean>;
  createMessageForOwnedThread(
    input: Omit<AgentMessageView, "id" | "createdAt">,
  ): Promise<AgentMessageView | null>;
}

function normalizeVisibleText(value: string, maximum: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maximum);
}

function normalizeMessageText(value: string, maximum: number): string {
  return value.replace(/\r\n?/g, "\n").trim().slice(0, maximum);
}

function mapThread(record: {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{
    id: string;
    userId: string;
    threadId: string;
    runId: string | null;
    role: string;
    content: string;
    metadata: unknown;
    createdAt: Date;
  }>;
  proposals?: unknown[];
  runs?: Array<{
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    toolInvocations: Array<{
      id: string;
      runId: string;
      toolName: string;
      status: string;
      durationMs: number | null;
      createdAt: Date;
      proposal: { id: string } | null;
    }>;
  }>;
}): AgentThreadView {
  const activities: AgentActivityView[] = (record.runs ?? []).flatMap((run) => [
    {
      id: run.id,
      type: "run" as const,
      runId: run.id,
      toolName: null,
      status: run.status,
      durationMs: run.finishedAt
        ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime())
        : null,
      proposalId: null,
      createdAt: run.startedAt,
    },
    ...run.toolInvocations.map((invocation) => ({
      id: invocation.id,
      type: "tool" as const,
      runId: invocation.runId,
      toolName: invocation.toolName,
      status: invocation.status,
      durationMs: invocation.durationMs,
      proposalId: invocation.proposal?.id ?? null,
      createdAt: invocation.createdAt,
    })),
  ]).sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messages: [...(record.messages ?? [])]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((message) => ({
        ...message,
        metadata: message.metadata ?? undefined,
      })),
    proposals: record.proposals ?? [],
    activities,
  };
}

export const prismaAgentRepository: AgentRepository = {
  async createThread(userId, title) {
    return mapThread(await prisma.agentThread.create({ data: { userId, title } }));
  },
  async listThreads(userId) {
    const records = await prisma.agentThread.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return records.map(mapThread);
  },
  async findThread(userId, threadId) {
    const record = await prisma.agentThread.findFirst({
      where: { id: threadId, userId },
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 200 },
        proposals: {
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { verification: true },
        },
        runs: {
          orderBy: { startedAt: "desc" },
          take: 100,
          include: {
            toolInvocations: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                runId: true,
                toolName: true,
                status: true,
                durationMs: true,
                createdAt: true,
                proposal: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    return record ? mapThread(record) : null;
  },
  async removeThread(userId, threadId) {
    const result = await prisma.agentThread.deleteMany({
      where: { id: threadId, userId },
    });
    return result.count > 0;
  },
  async createMessageForOwnedThread(input) {
    return prisma.$transaction(async (transaction) => {
      const thread = await transaction.agentThread.findFirst({
        where: { id: input.threadId, userId: input.userId },
        select: { id: true },
      });
      if (!thread) return null;
      const record = await transaction.agentMessage.create({
        data: {
          userId: input.userId,
          threadId: input.threadId,
          runId: input.runId ?? null,
          role: input.role,
          content: input.content,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      await transaction.agentThread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      });
      return { ...record, metadata: record.metadata ?? undefined };
    });
  },
};

export function createAgentThread(
  repository: AgentRepository,
  userId: string,
  title: string,
) {
  const normalized = normalizeVisibleText(title, 100) || "New conversation";
  return repository.createThread(userId, normalized);
}

export function listAgentThreads(repository: AgentRepository, userId: string) {
  return repository.listThreads(userId);
}

export function getAgentThread(
  repository: AgentRepository,
  userId: string,
  threadId: string,
) {
  return repository.findThread(userId, threadId);
}

export function deleteAgentThread(
  repository: AgentRepository,
  userId: string,
  threadId: string,
) {
  return repository.removeThread(userId, threadId);
}

export async function addThreadMessage(
  repository: AgentRepository,
  userId: string,
  threadId: string,
  input: { role: string; content: string; runId?: string | null; metadata?: unknown },
) {
  const content = normalizeMessageText(input.content, 32_000);
  if (!content) throw new Error("Message content is required");
  const message = await repository.createMessageForOwnedThread({
    userId,
    threadId,
    runId: input.runId,
    role: input.role,
    content,
    metadata: input.metadata,
  });
  if (!message) throw new Error("Thread not found");
  return message;
}

export async function createAgentRun(input: {
  userId: string;
  threadId: string;
  provider: string;
  model: string;
}) {
  return prisma.agentRun.create({ data: input });
}

export async function completeAgentRun(
  userId: string,
  runId: string,
  input: {
    status: "completed" | "failed" | "aborted";
    finishReason?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    errorCode?: string | null;
  },
) {
  return prisma.agentRun.updateMany({
    where: { id: runId, userId, status: "running" },
    data: { ...input, finishedAt: new Date() },
  });
}
