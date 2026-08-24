import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "hermes-secret-key-0123456789";

const mocks = vi.hoisted(() => ({
  requireSessionAuth: vi.fn(),
  db: {
    listCareerOpsThreads: vi.fn(),
    getCareerOpsThread: vi.fn(),
    createCareerOpsThread: vi.fn(),
    renameCareerOpsThread: vi.fn(),
    deleteCareerOpsThread: vi.fn(),
    getCareerOpsRun: vi.fn(),
    claimCareerOpsRun: vi.fn(),
    updateCareerOpsRunStatus: vi.fn(),
    bindCareerOpsRunHermesId: vi.fn(),
    deleteCareerOpsRun: vi.fn(),
    getLatestCareerOpsRun: vi.fn(),
    findCareerOpsRunByClientRequestId: vi.fn(),
    recordCareerOpsApprovalDecision: vi.fn(),
    settleCareerOpsApprovalDecision: vi.fn(),
    openCareerOpsApprovalGate: vi.fn(),
    claimCareerOpsApprovalGate: vi.fn(),
    releaseCareerOpsApprovalGate: vi.fn(),
    recoverCareerOpsApprovalGate: vi.fn(),
    getApplication: vi.fn(),
  },
  client: {
    health: vi.fn(),
    capabilities: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    listSessionMessages: vi.fn(),
    createRun: vi.fn(),
    getRun: vi.fn(),
    stopRun: vi.fn(),
    resolveApproval: vi.fn(),
    openRunEvents: vi.fn(),
  },
}));

vi.mock("@/lib/session", () => ({
  requireSessionAuth: mocks.requireSessionAuth,
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/career-ops/hermes-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/career-ops/hermes-client")>(
    "@/lib/career-ops/hermes-client",
  );
  return { ...actual, createHermesClient: () => mocks.client };
});

import { HermesError } from "@/lib/career-ops/hermes-client";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { GET as getStatus } from "../status/route";
import { GET as listThreads, POST as createThread } from "../threads/route";
import { GET as getThread, DELETE as deleteThread } from "../threads/[id]/route";
import { GET as getMessages } from "../threads/[id]/messages/route";
import { POST as startRun } from "../threads/[id]/runs/route";
import { GET as getRun } from "../runs/[id]/route";
import { POST as stopRun } from "../runs/[id]/stop/route";
import { POST as approveRun } from "../runs/[id]/approval/route";
import { GET as runEvents } from "../runs/[id]/events/route";

const THREAD = {
  id: "thread-1",
  userId: "user-a",
  hermesSessionId: "sess-1",
  title: "Career Ops",
  applicationId: null,
  applicationScoped: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const RUN = {
  id: "run-1",
  userId: "user-a",
  threadId: "thread-1",
  hermesRunId: "run_1",
  clientRequestId: "client-request-1",
  status: "queued" as const,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const threadContext = { params: Promise.resolve({ id: "thread-1" }) };
const runContext = { params: Promise.resolve({ id: "run-1" }) };

function post(body: unknown, url = "http://test") {
  const payload = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(payload.length) },
    body: payload,
  });
}

function enable() {
  process.env.HERMES_CAREER_OPS_ENABLED = "true";
  process.env.HERMES_CAREER_OPS_BASE_URL = "http://127.0.0.1:8642/p/career-ops";
  process.env.HERMES_CAREER_OPS_API_KEY = SECRET;
  process.env.HERMES_CAREER_OPS_OWNER_USER_ID = "user-a";
}

function disable() {
  delete process.env.HERMES_CAREER_OPS_ENABLED;
  delete process.env.HERMES_CAREER_OPS_BASE_URL;
  delete process.env.HERMES_CAREER_OPS_API_KEY;
  delete process.env.HERMES_CAREER_OPS_OWNER_USER_ID;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitsForTests();
  enable();
  mocks.requireSessionAuth.mockResolvedValue({
    userId: "user-a",
    readScopeUserId: "user-a",
    user: { id: "user-a", email: "a@example.com", name: null, image: null, isAdmin: false },
    authType: "session",
  });
  mocks.client.health.mockResolvedValue({ healthy: true, version: "1.0.0" });
  mocks.client.capabilities.mockResolvedValue({
    runs: true,
    runStatus: true,
    runEvents: true,
    stop: true,
    approvals: true,
    sessions: true,
  });
  mocks.client.stopRun.mockResolvedValue(undefined);
  // Prior turns are read before every submission; empty is the first-turn case.
  mocks.client.listSessionMessages.mockResolvedValue([]);
  mocks.client.resolveApproval.mockResolvedValue(undefined);
  mocks.client.deleteSession.mockResolvedValue(undefined);
  mocks.db.getCareerOpsThread.mockResolvedValue(null);
  mocks.db.getCareerOpsRun.mockResolvedValue(null);
  mocks.db.listCareerOpsThreads.mockResolvedValue([]);
  mocks.db.deleteCareerOpsRun.mockResolvedValue(undefined);
  mocks.db.updateCareerOpsRunStatus.mockResolvedValue(undefined);
  mocks.db.bindCareerOpsRunHermesId.mockResolvedValue({ ...RUN });
  mocks.db.getLatestCareerOpsRun.mockResolvedValue(null);
  mocks.db.findCareerOpsRunByClientRequestId.mockResolvedValue(null);
  mocks.db.recordCareerOpsApprovalDecision.mockResolvedValue(undefined);
  mocks.db.settleCareerOpsApprovalDecision.mockResolvedValue(true);
  mocks.db.openCareerOpsApprovalGate.mockResolvedValue(true);
  mocks.db.claimCareerOpsApprovalGate.mockResolvedValue({ challengeId: "" });
  mocks.db.releaseCareerOpsApprovalGate.mockResolvedValue(undefined);
  mocks.db.recoverCareerOpsApprovalGate.mockResolvedValue(false);
});

describe("authentication", () => {
  const invocations: Array<[string, () => Promise<Response>]> = [
    ["status", () => getStatus()],
    ["thread list", () => listThreads()],
    ["thread create", () => createThread(post({}))],
    ["thread get", () => getThread(new Request("http://test"), threadContext)],
    ["thread delete", () => deleteThread(new Request("http://test"), threadContext)],
    ["thread messages", () => getMessages(new Request("http://test"), threadContext)],
    ["run start", () => startRun(post({ message: "hi", clientRequestId: "client-request-1" }), threadContext)],
    ["run status", () => getRun(new Request("http://test"), runContext)],
    ["run stop", () => stopRun(new Request("http://test", { method: "POST" }), runContext)],
    ["run approval", () => approveRun(post({ choice: "once" }), runContext)],
    ["run events", () => runEvents(new Request("http://test"), runContext)],
  ];

  it.each(invocations)("rejects an unauthenticated caller for %s", async (_name, invoke) => {
    mocks.requireSessionAuth.mockResolvedValue(null);
    const response = await invoke();
    expect(response.status).toBe(401);
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it.each(invocations)("rejects a bearer-token caller for %s", async (_name, invoke) => {
    // requireSessionAuth already filters non-session credentials; assert the
    // routes go through it rather than requireAuth.
    mocks.requireSessionAuth.mockResolvedValue(null);
    expect((await invoke()).status).toBe(401);
  });
});

describe("GET /api/career-ops/status", () => {
  it("reports the disabled state without contacting Hermes", async () => {
    disable();
    const response = await getStatus();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ enabled: false, available: false });
    expect(mocks.client.health).not.toHaveBeenCalled();
  });

  it("reports availability and capabilities", async () => {
    const response = await getStatus();
    await expect(response.json()).resolves.toMatchObject({
      enabled: true,
      available: true,
      reason: null,
      capabilities: { stop: true, approvals: true, streaming: true },
    });
  });

  it("never leaks the upstream credential", async () => {
    mocks.client.health.mockRejectedValue(
      new HermesError("upstream_error", `Bearer ${SECRET}`, `Bearer ${SECRET}`),
    );
    const response = await getStatus();
    expect(await response.text()).not.toContain(SECRET);
  });
});

describe("threads", () => {
  it("lists only the caller's threads and hides the Hermes session id", async () => {
    mocks.db.listCareerOpsThreads.mockResolvedValue([THREAD]);
    const response = await listThreads();
    const body = await response.json();
    expect(body.threads).toEqual([
      {
        id: "thread-1",
        title: "Career Ops",
        applicationId: null,
        scopeLost: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("sess-1");
  });

  it("returns 404 for another user's thread", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(null);
    expect((await getThread(new Request("http://test"), threadContext)).status).toBe(404);
    expect((await deleteThread(new Request("http://test"), threadContext)).status).toBe(404);
    expect((await getMessages(new Request("http://test"), threadContext)).status).toBe(404);
  });

  it("names the opportunity an application-scoped thread acts on", async () => {
    // The drawer cannot label the target from the thread row alone, and a
    // stored label could name a record the agent can no longer read.
    mocks.db.getCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });
    mocks.db.getApplication.mockResolvedValue({ id: "42", company: "Acme", role: "Engineer" });

    const response = await getThread(new Request("http://test"), threadContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.application).toEqual({ id: "42", company: "Acme", role: "Engineer" });
    expect(mocks.db.getApplication).toHaveBeenCalledWith("42", "user-a", {
      demoVisibility: "exclude",
    });
    expect(JSON.stringify(body)).not.toContain("sess-1");
  });

  it("reports no opportunity when the link is no longer agent-visible", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });
    mocks.db.getApplication.mockResolvedValue(null);

    const body = await (await getThread(new Request("http://test"), threadContext)).json();
    expect(body.application).toBeNull();
  });

  it("rejects malformed JSON with 400", async () => {
    const request = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect((await createThread(request)).status).toBe(400);
    expect(mocks.client.createSession).not.toHaveBeenCalled();
  });

  it("rejects an oversized chunked body without buffering it", async () => {
    // No Content-Length, so the declared-size check cannot fire. Materializing
    // the body first would let any authenticated caller exhaust memory before
    // the owner gate is even reached.
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(64 * 1024)));
        if (produced > 5_000) controller.close();
      },
    });
    const request = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // @ts-expect-error duplex is required for a streaming request body
      duplex: "half",
    });

    expect((await createThread(request)).status).toBe(413);
    // It gave up early rather than reading the whole stream.
    expect(produced).toBeLessThan(1_000);
    expect(mocks.client.createSession).not.toHaveBeenCalled();
  });

  it("rejects an oversized body with 413", async () => {
    const request = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(10 * 1024 * 1024) },
      body: JSON.stringify({ title: "x" }),
    });
    expect((await createThread(request)).status).toBe(413);
  });

  it("returns 404 when the requested application belongs to someone else", async () => {
    // The owner-scoped read is the check; a foreign id simply resolves to null.
    mocks.db.getApplication.mockResolvedValue(null);
    const response = await createThread(post({ applicationId: "42" }));
    expect(response.status).toBe(404);
    expect(mocks.client.createSession).not.toHaveBeenCalled();
  });

  it("returns 404 for a demo application the agent could not read via MCP", async () => {
    mocks.db.getApplication.mockResolvedValue(null);
    const response = await createThread(post({ applicationId: "42" }));
    expect(response.status).toBe(404);
    expect(mocks.db.getApplication).toHaveBeenCalledWith("42", "user-a", {
      demoVisibility: "exclude",
    });
    expect(mocks.client.createSession).not.toHaveBeenCalled();
  });

  it("creates an owned application-scoped thread", async () => {
    mocks.db.getApplication.mockResolvedValue({ id: "42", company: "Acme", role: "Engineer" });
    mocks.client.createSession.mockResolvedValue({ id: "sess-new" });
    mocks.db.createCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });

    const response = await createThread(post({ applicationId: "42" }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      thread: { applicationId: "42" },
    });
  });

  it("returns a controlled unavailable status when the integration is disabled", async () => {
    disable();
    const response = await listThreads();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "unavailable" });
  });
});

describe("run creation", () => {
  beforeEach(() => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.client.createRun.mockResolvedValue({ runId: "run_1" });
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "claimed", run: RUN });
  });

  it("starts a run and returns 202", async () => {
    const response = await startRun(
      post({ message: "hello", clientRequestId: "client-request-1" }),
      threadContext,
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ run: { id: "run-1", status: "queued" } });
  });

  it("rejects an empty or missing message with 400", async () => {
    expect((await startRun(post({ clientRequestId: "client-request-1" }), threadContext)).status).toBe(400);
    expect(
      (await startRun(post({ message: "   ", clientRequestId: "client-request-1" }), threadContext)).status,
    ).toBe(400);
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("rejects an oversized message with 400 before contacting Hermes", async () => {
    const response = await startRun(
      post({ message: "x".repeat(20_000), clientRequestId: "client-request-1" }),
      threadContext,
    );
    expect(response.status).toBe(400);
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("rejects a malformed client request id with 400", async () => {
    for (const clientRequestId of ["", "short", "spaces here", "!!!!!!!!"]) {
      const response = await startRun(post({ message: "hi", clientRequestId }), threadContext);
      expect(response.status, clientRequestId).toBe(400);
    }
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("does not start a second upstream run for a duplicate client request id", async () => {
    mocks.db.claimCareerOpsRun.mockResolvedValue({
      outcome: "existing",
      run: { ...RUN, hermesRunId: "run_first", status: "running" },
    });
    const response = await startRun(
      post({ message: "hello", clientRequestId: "client-request-1" }),
      threadContext,
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ run: { id: "run-1" } });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign thread", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(null);
    const response = await startRun(
      post({ message: "hello", clientRequestId: "client-request-1" }),
      threadContext,
    );
    expect(response.status).toBe(404);
  });

  it("rate limits repeated run creation", async () => {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      last = await startRun(
        post({ message: "hello", clientRequestId: `client-request-${attempt}0` }),
        threadContext,
      );
      if (last.status === 429) break;
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("upstream failure mapping", () => {
  beforeEach(() => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
  });

  it.each([
    ["unauthorized", 503],
    ["rate_limited", 429],
    ["upstream_error", 502],
    ["timeout", 502],
    ["unreachable", 502],
  ] as const)("maps a %s upstream failure to %i", async (kind, status) => {
    mocks.client.createRun.mockRejectedValue(new HermesError(kind, "upstream", `Bearer ${SECRET}`));
    const response = await startRun(
      post({ message: "hello", clientRequestId: "client-request-1" }),
      threadContext,
    );
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain(SECRET);
  });
});

describe("run controls", () => {
  beforeEach(() => {
    mocks.db.getCareerOpsRun.mockResolvedValue(RUN);
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
  });

  it("returns run status for an owned run", async () => {
    mocks.client.getRun.mockResolvedValue({
      runId: "run_1",
      status: "completed",
      output: "done",
      error: null,
    });
    const response = await getRun(new Request("http://test"), runContext);
    await expect(response.json()).resolves.toEqual({
      status: "completed",
      output: "done",
      error: null,
    });
    expect(mocks.db.updateCareerOpsRunStatus).toHaveBeenCalledWith("run-1", "user-a", "completed");
  });

  it("returns 404 for another user's run on every control", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue(null);
    expect((await getRun(new Request("http://test"), runContext)).status).toBe(404);
    expect((await stopRun(new Request("http://test", { method: "POST" }), runContext)).status).toBe(404);
    expect((await approveRun(post({ choice: "once" }), runContext)).status).toBe(404);
    expect((await runEvents(new Request("http://test"), runContext)).status).toBe(404);
    expect(mocks.client.stopRun).not.toHaveBeenCalled();
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
    expect(mocks.client.openRunEvents).not.toHaveBeenCalled();
  });

  it("stops an owned run", async () => {
    const response = await stopRun(new Request("http://test", { method: "POST" }), runContext);
    expect(response.status).toBe(200);
    expect(mocks.client.stopRun).toHaveBeenCalledWith("run_1");
  });

  it("forwards a valid approval decision", async () => {
    // A decision only means something while the run is at a gate; the event
    // route records `waiting_for_approval` when it discloses the prompt.
    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, status: "waiting_for_approval" });
    const response = await approveRun(post({ choice: "deny" }), runContext);
    expect(response.status).toBe(200);
    expect(mocks.client.resolveApproval).toHaveBeenCalledWith("run_1", "deny");
  });

  it("rejects an unknown approval decision with 400", async () => {
    for (const choice of ["yes", "", null, 1, undefined]) {
      const response = await approveRun(post({ choice }), runContext);
      expect(response.status).toBe(400);
    }
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("maps an upstream approval conflict to 409", async () => {
    mocks.client.resolveApproval.mockRejectedValue(
      new HermesError("conflict", "not pending", `Bearer ${SECRET}`),
    );
    // Denial needs no challenge, so this exercises the upstream mapping rather
    // than the disclosure check.
    const response = await approveRun(post({ choice: "deny" }), runContext);
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(SECRET);
  });

  it("rejects a granting decision that carries no challenge", async () => {
    const response = await approveRun(post({ choice: "once" }), runContext);
    expect(response.status).toBe(400);
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });
});

describe("run event stream", () => {
  beforeEach(() => {
    mocks.db.getCareerOpsRun.mockResolvedValue(RUN);
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
  });

  function upstreamStream(chunks: string[]) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  it("re-emits normalized events and drops unknown upstream frames", async () => {
    mocks.client.openRunEvents.mockResolvedValue(
      upstreamStream([
        'data: {"event":"message.delta","delta":"Hel"}\n\n',
        'data: {"event":"reasoning.available","text":"private chain of thought"}\n\n',
        'data: {"event":"tool.started","tool":"list_applications","preview":"x"}\n\n',
        'data: {"event":"run.completed","output":"Hello"}\n\n',
      ]),
    );

    const response = await runEvents(new Request("http://test"), runContext);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response.text();

    expect(body).toContain('{"type":"delta","text":"Hel"}');
    expect(body).toContain('{"type":"tool_started","tool":"list_applications"}');
    expect(body).toContain('{"type":"completed","output":"Hello"}');
    expect(body).not.toContain("private chain of thought");
    expect(body).not.toContain("message.delta");
    expect(mocks.db.updateCareerOpsRunStatus).toHaveBeenCalledWith("run-1", "user-a", "completed");
  });

  it("does not declare a run finished it could not record as finished", async () => {
    // Emitting the terminal event re-enables the composer. If the status never
    // landed, the stored run is still active, so the next submission is refused
    // by the one-active-run invariant — and this client never polls, because it
    // already saw the run finish. Saying the stream broke sends it to status
    // recovery, which can settle and retry the write.
    mocks.db.updateCareerOpsRunStatus.mockRejectedValue(new Error("database down"));
    mocks.client.openRunEvents.mockResolvedValue(
      upstreamStream([
        'data: {"event":"message.delta","delta":"Hel"}\n\n',
        'data: {"event":"run.completed","output":"Hello"}\n\n',
      ]),
    );

    const response = await runEvents(new Request("http://test"), runContext);
    const body = await response.text();

    expect(body).toContain('{"type":"delta","text":"Hel"}');
    expect(body).toContain('"type":"error"');
    expect(body).not.toContain('{"type":"completed"');
  });

  it("survives a malformed upstream frame", async () => {
    mocks.client.openRunEvents.mockResolvedValue(
      upstreamStream([
        "data: {broken\n\n",
        'data: {"event":"run.failed","error":"nope"}\n\n',
      ]),
    );
    const body = await (await runEvents(new Request("http://test"), runContext)).text();
    expect(body).toContain('"type":"failed"');
  });

  it("records the waiting-for-approval state when Hermes asks for a decision", async () => {
    mocks.client.openRunEvents.mockResolvedValue(
      upstreamStream([
        'data: {"event":"approval.request","command":"rm -rf x","description":"Delete","choices":["once","deny"]}\n\n',
      ]),
    );
    const body = await (await runEvents(new Request("http://test"), runContext)).text();
    expect(body).toContain('"type":"approval_required"');
    expect(mocks.db.updateCareerOpsRunStatus).toHaveBeenCalledWith(
      "run-1",
      "user-a",
      "waiting_for_approval",
    );
  });

  it("bounds a stream that goes quiet without closing", async () => {
    process.env.HERMES_CAREER_OPS_STREAM_IDLE_TIMEOUT_MS = "1000";
    // A stream that never emits and never closes.
    mocks.client.openRunEvents.mockResolvedValue(
      new ReadableStream<Uint8Array>({ start() {} }),
    );
    const response = await runEvents(new Request("http://test"), runContext);
    const body = await response.text();
    expect(body).toContain('"type":"error"');
    expect(body).toContain("stream_timeout");
    delete process.env.HERMES_CAREER_OPS_STREAM_IDLE_TIMEOUT_MS;
  }, 15_000);

  it("maps an upstream stream failure to a controlled status", async () => {
    mocks.client.openRunEvents.mockRejectedValue(
      new HermesError("unreachable", "gone", `Bearer ${SECRET}`),
    );
    const response = await runEvents(new Request("http://test"), runContext);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(SECRET);
  });
});
