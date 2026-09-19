import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireSessionAuth: vi.fn(),
	getAgentRunSnapshot: vi.fn(),
	reconcileStaleAgentRun: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
	requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/agent/run-events", () => ({
	getAgentRunSnapshot: mocks.getAgentRunSnapshot,
	reconcileStaleAgentRun: mocks.reconcileStaleAgentRun,
	prismaAgentRunEventRepository: {},
}));

import { GET } from "../route";

const context = { params: Promise.resolve({ id: "run-1" }) };

describe("GET /api/agent/runs/:id", () => {
	beforeEach(() => vi.clearAllMocks());

	it("requires an authenticated browser session", async () => {
		mocks.requireSessionAuth.mockResolvedValue(null);
		const response = await GET(new Request("http://test/api/agent/runs/run-1"), context);
		expect(response.status).toBe(401);
		expect(mocks.getAgentRunSnapshot).not.toHaveBeenCalled();
	});

	it("returns only the authenticated owner's reconstructed snapshot", async () => {
		mocks.requireSessionAuth.mockResolvedValue({ userId: "user-a" });
		mocks.getAgentRunSnapshot.mockResolvedValue({
			runId: "run-1",
			threadId: "thread-1",
			status: "running",
			lastSequence: 1,
			events: [],
			pendingEvents: [],
			pendingSequences: [],
			text: "",
			state: {},
			activities: [],
			tools: {},
		});
		const response = await GET(new Request("http://test/api/agent/runs/run-1"), context);
		expect(response.status).toBe(200);
		expect(mocks.reconcileStaleAgentRun).toHaveBeenCalledWith({}, "user-a", "run-1");
		expect(mocks.getAgentRunSnapshot).toHaveBeenCalledWith({}, "user-a", "run-1");
	});
});
