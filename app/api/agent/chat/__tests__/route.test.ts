import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  getAgentThread: vi.fn(),
  loadCredentialSecret: vi.fn(),
	addThreadMessage: vi.fn(),
	completeAgentRun: vi.fn(),
	createAgentRun: vi.fn(),
	streamText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return { ...actual, streamText: mocks.streamText };
});

vi.mock("@/lib/session", () => ({
  requireAuth: mocks.requireAuth,
  requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agent/credentials", () => ({
  loadCredentialSecret: mocks.loadCredentialSecret,
  prismaCredentialRepository: {},
}));
vi.mock("@/lib/agent/providers", () => ({
	SUPPORTED_PROVIDERS: ["openai"],
	createUserLanguageModel: vi.fn(() => ({})),
}));
vi.mock("@/lib/agent/store", () => ({
  getAgentThread: mocks.getAgentThread,
  prismaAgentRepository: {},
  addThreadMessage: mocks.addThreadMessage,
  completeAgentRun: mocks.completeAgentRun,
  createAgentRun: mocks.createAgentRun,
}));
vi.mock("@/lib/agent/proposals", () => ({
	APPLICATION_STATUSES: ["inbound", "applied", "interview", "offer", "rejected"],
	prismaProposalRepository: {},
}));
vi.mock("@/lib/agent/connectors", () => ({ prismaConnectorRepository: {} }));
vi.mock("@/lib/agent/run-events", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/agent/run-events")>();
	return {
		...actual,
		prismaAgentRunEventRepository: {
			appendOwned: vi.fn().mockResolvedValue(true),
			listOwned: vi.fn().mockResolvedValue([]),
		},
		createAgentRunEventPublisher: vi.fn((input: { runId: string; threadId: string }) => {
			let sequence = 0;
			return async (event: Record<string, unknown>) => {
				sequence += 1;
				return {
					...event,
					eventId: `${input.runId}:${sequence}`,
					runId: input.runId,
					threadId: input.threadId,
					sequence,
					timestamp: sequence,
				};
			};
		}),
	};
});

import { POST } from "../route";

function request() {
  return new Request("http://test/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-1",
      provider: "openai",
      message: "Review my pipeline",
    }),
  });
}

describe("POST /api/agent/chat preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "session" });
    mocks.requireSessionAuth.mockImplementation(async (options: { allowDevBypass: boolean }) => {
      const authResult = await mocks.requireAuth(options);
      return authResult?.authType === "session" ? authResult : null;
    });
  });

  it("rejects bearer-token authentication", async () => {
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "api_token" });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.getAgentThread).not.toHaveBeenCalled();
  });

  it("returns 413 for declared and streamed oversized JSON before Zod or repository work", async () => {
    const declared = new Request("http://test/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(70 * 1024) },
      body: "{}",
    });
    expect((await POST(declared)).status).toBe(413);

    const chunk = new Uint8Array(40 * 1024).fill(120);
    const streamed = new Request("http://test/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await POST(streamed)).status).toBe(413);
    expect(mocks.getAgentThread).not.toHaveBeenCalled();
  });

  it("returns a safe 400 for malformed JSON", async () => {
    const response = await POST(new Request("http://test/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{malformed",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request body" });
  });

  it("does not disclose a thread owned by another user", async () => {
    mocks.getAgentThread.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.loadCredentialSecret).not.toHaveBeenCalled();
  });

  it("requires the authenticated user's own provider credential", async () => {
    mocks.getAgentThread.mockResolvedValue({
      id: "thread-1",
      userId: "user-a",
      title: "New conversation",
      messages: [],
      proposals: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mocks.loadCredentialSecret.mockResolvedValue(null);

    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Configure your model credential before starting a run",
    });
    expect(mocks.loadCredentialSecret).toHaveBeenCalledWith({}, "user-a", "openai");
  });

	it("rejects a second active run for the same thread", async () => {
		mocks.getAgentThread.mockResolvedValue({
			id: "thread-1", userId: "user-a", title: "Review", messages: [], proposals: [], createdAt: new Date(), updatedAt: new Date(),
		});
		mocks.loadCredentialSecret.mockResolvedValue({ provider: "openai", model: "gpt" });
		mocks.createAgentRun.mockRejectedValue(
			Object.assign(new Error("active"), { name: "AgentRunConflictError", runId: "run-existing" }),
		);
		const response = await POST(request());
		expect(response.status).toBe(409);
		expect(mocks.streamText).not.toHaveBeenCalled();
	});

	it("streams typed validated events with page context instead of plain text", async () => {
		mocks.getAgentThread.mockResolvedValue({
			id: "thread-1",
			userId: "user-a",
			title: "Review",
			messages: [],
			proposals: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		mocks.loadCredentialSecret.mockResolvedValue({
			provider: "openai",
			model: "gpt-5.4-mini",
		});
		mocks.createAgentRun.mockResolvedValue({ id: "run-1" });
		mocks.streamText.mockImplementation(() => ({
			stream: (async function* () {
				yield { type: "text-start", id: "message-1" };
				yield { type: "text-delta", id: "message-1", text: "Review ready" };
				yield { type: "text-end", id: "message-1" };
			})(),
		}));

		const response = await POST(new Request("http://test/api/agent/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				threadId: "thread-1",
				provider: "openai",
				message: "Review my selection",
				context: {
					route: "/opportunities",
					activeRecordId: null,
					filters: {},
					visibleIds: ["application-1"],
					visibleCount: 1,
					selectedIds: ["application-1"],
					dirtyEditorIds: [],
					capabilities: ["open_record"],
					taskIds: [],
					taskProgress: [],
				},
			}),
		}));
		const body = await response.text();

		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("x-agent-run-id")).toBe("run-1");
		expect(body).toContain('"type":"RUN_STARTED"');
		expect(body).toContain('"type":"STATE_SNAPSHOT"');
		expect(body).toContain('"selectedIds":["application-1"]');
		expect(body).toContain('"type":"TEXT_MESSAGE_CONTENT"');
		expect(body).toContain('"type":"RUN_FINISHED"');
		expect(body).not.toBe("Review ready");
		const call = mocks.streamText.mock.calls[0]?.[0];
		expect(Object.keys(call.tools)).toContain("open_opportunity");
		expect(Object.keys(call.tools)).toContain("preview_bulk_change");
		expect(Object.keys(call.tools)).toContain("get_analytics_summary");
		expect(Object.keys(call.tools)).toContain("list_documents");
		expect(Object.keys(call.tools)).toContain("list_email_review");
		expect(call.instructions).toContain("application-1");
		expect(call.instructions).toContain("never use it as proof of ownership");
	});
});
