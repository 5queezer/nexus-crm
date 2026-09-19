import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
	agentRunEventSchema,
	createEmptyRunSnapshot,
	reduceAgentRunEvents,
	type AgentRunEvent,
	type AgentRunEventPayload,
	type AgentRunSnapshot,
} from "./protocol";

const PROTOCOL_VERSION = "nexus-agent-events/v1";

export interface AgentRunEventRepository {
	appendOwned(userId: string, event: AgentRunEvent): Promise<boolean>;
	listOwned(userId: string, runId: string): Promise<AgentRunEvent[] | null>;
}

export const prismaAgentRunEventRepository: AgentRunEventRepository = {
	async appendOwned(userId, event) {
		return prisma.$transaction(async (transaction) => {
			const run = await transaction.agentRun.findFirst({
				where: {
					id: event.runId,
					userId,
					threadId: event.threadId,
				},
				select: { id: true },
			});
			if (!run) return false;
			const existing = await transaction.agentMessage.findFirst({
				where: {
					userId,
					runId: event.runId,
					role: "event",
					content: event.eventId,
				},
				select: { id: true },
			});
			if (existing) return true;
			await transaction.agentMessage.create({
				data: {
					userId,
					threadId: event.threadId,
					runId: event.runId,
					role: "event",
					content: event.eventId,
					metadata: {
						protocol: PROTOCOL_VERSION,
						event,
					} as Prisma.InputJsonValue,
				},
			});
			return true;
		});
	},
	async listOwned(userId, runId) {
		const run = await prisma.agentRun.findFirst({
			where: { id: runId, userId },
			select: { id: true },
		});
		if (!run) return null;
		const messages = await prisma.agentMessage.findMany({
			where: { userId, runId, role: "event" },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			select: { metadata: true },
		});
		return messages.flatMap((message) => {
			const metadata = message.metadata;
			if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
				return [];
			}
			const record = metadata as Record<string, unknown>;
			if (record.protocol !== PROTOCOL_VERSION) return [];
			const parsed = agentRunEventSchema.safeParse(record.event);
			return parsed.success ? [parsed.data] : [];
		});
	},
};

export async function appendAgentRunEvent(
	repository: AgentRunEventRepository,
	userId: string,
	event: AgentRunEvent,
): Promise<void> {
	const parsed = agentRunEventSchema.parse(event);
	if (!(await repository.appendOwned(userId, parsed))) {
		throw new Error("Agent run not found");
	}
}

export async function getAgentRunSnapshot(
	repository: AgentRunEventRepository,
	userId: string,
	runId: string,
): Promise<AgentRunSnapshot | null> {
	const events = await repository.listOwned(userId, runId);
	if (events === null) return null;
	const first = events[0];
	if (!first) return createEmptyRunSnapshot(runId, "");
	return reduceAgentRunEvents(
		createEmptyRunSnapshot(runId, first.threadId),
		events,
	);
}

type StaleRunDependencies = {
	findRun: (
		userId: string,
		runId: string,
	) => Promise<{
		threadId: string;
		status: string;
		startedAt: Date;
	} | null>;
	failRun: (userId: string, runId: string, finishedAt: Date) => Promise<boolean>;
};

const defaultStaleRunDependencies: StaleRunDependencies = {
	findRun: (userId, runId) =>
		prisma.agentRun.findFirst({
			where: { id: runId, userId },
			select: { threadId: true, status: true, startedAt: true },
		}),
	async failRun(userId, runId, finishedAt) {
		const result = await prisma.agentRun.updateMany({
			where: { id: runId, userId, status: "running" },
			data: {
				status: "failed",
				finishedAt,
				finishReason: "interrupted",
				errorCode: "STALE_RUN",
			},
		});
		return result.count === 1;
	},
};

export async function reconcileStaleAgentRun(
	repository: AgentRunEventRepository,
	userId: string,
	runId: string,
	now = new Date(),
	dependencies: StaleRunDependencies = defaultStaleRunDependencies,
): Promise<boolean> {
	const run = await dependencies.findRun(userId, runId);
	if (
		!run ||
		run.status !== "running" ||
		now.getTime() - run.startedAt.getTime() <= 90_000
	) {
		return false;
	}
	if (!(await dependencies.failRun(userId, runId, now))) return false;
	const events = (await repository.listOwned(userId, runId)) ?? [];
	const sequence = events.reduce(
		(maximum, event) => Math.max(maximum, event.sequence),
		0,
	) + 1;
	await appendAgentRunEvent(repository, userId, {
		eventId: `${runId}:${sequence}`,
		runId,
		threadId: run.threadId,
		sequence,
		timestamp: now.getTime(),
		type: "RUN_ERROR",
		message: "The run was interrupted before a terminal event was recorded.",
		code: "STALE_RUN",
	});
	return true;
}

export function createAgentRunEventPublisher(input: {
	userId: string;
	runId: string;
	threadId: string;
	repository?: AgentRunEventRepository;
	now?: () => number;
}) {
	let sequence = 0;
	const repository = input.repository ?? prismaAgentRunEventRepository;
	const now = input.now ?? Date.now;
	return async function publish(
		event: AgentRunEventPayload,
	): Promise<AgentRunEvent> {
		sequence += 1;
		const parsed = agentRunEventSchema.parse({
			...event,
			eventId: `${input.runId}:${sequence}`,
			runId: input.runId,
			threadId: input.threadId,
			sequence,
			timestamp: now(),
		});
		await appendAgentRunEvent(repository, input.userId, parsed);
		return parsed;
	};
}
