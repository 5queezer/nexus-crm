import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireSessionAuth: vi.fn(),
	listOwned: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
	requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/agent/run-events", () => ({
	prismaAgentRunEventRepository: { listOwned: mocks.listOwned },
}));

import { GET } from "../route";

const context = { params: Promise.resolve({ id: "run-1" }) };

describe("GET /api/agent/runs/:id/events", () => {
	beforeEach(() => vi.clearAllMocks());

	it("replays validated events after Last-Event-ID", async () => {
		mocks.requireSessionAuth.mockResolvedValue({ userId: "user-a" });
		mocks.listOwned.mockResolvedValue([
			{ eventId: "run-1:1", runId: "run-1", threadId: "thread-1", sequence: 1, timestamp: 1, type: "RUN_STARTED" },
			{ eventId: "run-1:2", runId: "run-1", threadId: "thread-1", sequence: 2, timestamp: 2, type: "RUN_FINISHED" },
		]);
		const response = await GET(new Request("http://test/api/agent/runs/run-1/events", {
			headers: { "Last-Event-ID": "run-1:1" },
		}), context);
		const body = await response.text();
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(body).not.toContain("run-1:1");
		expect(body).toContain("run-1:2");
	});

	it("returns 404 without disclosing an unowned run", async () => {
		mocks.requireSessionAuth.mockResolvedValue({ userId: "user-b" });
		mocks.listOwned.mockResolvedValue(null);
		const response = await GET(new Request("http://test/api/agent/runs/run-1/events"), context);
		expect(response.status).toBe(404);
	});
});
