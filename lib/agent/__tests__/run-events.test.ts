import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "../protocol";
import {
	appendAgentRunEvent,
	getAgentRunSnapshot,
	reconcileStaleAgentRun,
	type AgentRunEventRepository,
} from "../run-events";

const event = (sequence: number, type: AgentRunEvent["type"] = "RUN_STARTED") =>
	({
		eventId: `run-1:${sequence}`,
		runId: "run-1",
		threadId: "thread-1",
		sequence,
		timestamp: sequence,
		type,
	}) as AgentRunEvent;

class MemoryEvents implements AgentRunEventRepository {
	items: AgentRunEvent[] = [];
	async appendOwned(userId: string, value: AgentRunEvent) {
		if (userId !== "user-a" || value.runId !== "run-1") return false;
		if (!this.items.some((item) => item.eventId === value.eventId)) {
			this.items.push(value);
		}
		return true;
	}
	async listOwned(userId: string, runId: string) {
		return userId === "user-a" && runId === "run-1" ? this.items : null;
	}
}

describe("persisted agent run events", () => {
	it("stores duplicate event ids once and reconstructs an ordered snapshot", async () => {
		const repository = new MemoryEvents();
		await appendAgentRunEvent(repository, "user-a", event(2, "RUN_FINISHED"));
		await appendAgentRunEvent(repository, "user-a", event(1));
		await appendAgentRunEvent(repository, "user-a", event(1));

		const snapshot = await getAgentRunSnapshot(repository, "user-a", "run-1");
		expect(repository.items).toHaveLength(2);
		expect(snapshot?.events.map((item) => item.sequence)).toEqual([1, 2]);
		expect(snapshot?.status).toBe("completed");
	});

	it("does not disclose another user's run", async () => {
		const repository = new MemoryEvents();
		await appendAgentRunEvent(repository, "user-a", event(1));
		expect(await getAgentRunSnapshot(repository, "user-b", "run-1")).toBeNull();
	});

	it("marks an owned overdue run failed and appends one terminal event", async () => {
		const repository = new MemoryEvents();
		await appendAgentRunEvent(repository, "user-a", event(1));
		let failed = false;
		const changed = await reconcileStaleAgentRun(
			repository,
			"user-a",
			"run-1",
			new Date("2026-09-19T12:02:00.000Z"),
			{
				findRun: async () => ({
					threadId: "thread-1",
					status: "running",
					startedAt: new Date("2026-09-19T12:00:00.000Z"),
				}),
				failRun: async () => {
					failed = true;
					return true;
				},
			},
		);
		expect(changed).toBe(true);
		expect(failed).toBe(true);
		expect(repository.items.at(-1)).toMatchObject({
			sequence: 2,
			type: "RUN_ERROR",
			code: "STALE_RUN",
		});
	});
});
