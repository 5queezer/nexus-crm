import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    listCareerOpsThreads: vi.fn(),
    getCareerOpsThread: vi.fn(),
    createCareerOpsThread: vi.fn(),
    renameCareerOpsThread: vi.fn(),
    deleteCareerOpsThread: vi.fn(),
    getCareerOpsRun: vi.fn(),
    claimCareerOpsRun: vi.fn(),
    updateCareerOpsRunStatus: vi.fn(),
    expireCareerOpsRunReservation: vi.fn(),
    getLatestCareerOpsRun: vi.fn(),
    findCareerOpsRunByClientRequestId: vi.fn(),
    recordCareerOpsApprovalDecision: vi.fn(),
    settleCareerOpsApprovalDecision: vi.fn(),
    openCareerOpsApprovalGate: vi.fn(),
    claimCareerOpsApprovalGate: vi.fn(),
    releaseCareerOpsApprovalGate: vi.fn(),
    recoverCareerOpsApprovalGate: vi.fn(),
    bindCareerOpsRunHermesId: vi.fn(),
    deleteCareerOpsRun: vi.fn(),
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

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("../hermes-client", async () => {
  const actual = await vi.importActual<typeof import("../hermes-client")>("../hermes-client");
  return { ...actual, createHermesClient: () => mocks.client };
});

import { HermesError } from "../hermes-client";
import {
  CareerOpsServiceError,
  createCareerOpsThread,
  deleteCareerOpsThread,
  getActiveCareerOpsRun,
  getCareerOpsThreadRunState,
  getCareerOpsRunStatus,
  getCareerOpsStatus,
  listCareerOpsThreadMessages,
  listCareerOpsThreads,
  requireOwnedRun,
  requireOwnedThread,
  resetCareerOpsCapabilityCacheForTests,
  resolveCareerOpsThreadApplication,
  careerOpsApprovalChallengeFor,
  resolveCareerOpsApproval,
  startCareerOpsRun,
  stopCareerOpsRun,
} from "../service";

const SECRET = "hermes-secret-key-0123456789";

const SESSION_A = { userId: "user-a", user: { isAdmin: false } };
const ADMIN = { userId: "admin-1", user: { isAdmin: true } };

const THREAD = {
  id: "thread-1",
  userId: "user-a",
  hermesSessionId: "sess-1",
  title: "Career Ops",
  applicationId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

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
  enable();
  resetCareerOpsCapabilityCacheForTests();
  mocks.client.capabilities.mockResolvedValue({
    runs: true,
    runStatus: true,
    runEvents: true,
    stop: true,
    approvals: true,
    sessions: true,
  });
  mocks.client.health.mockResolvedValue({ healthy: true, version: "1.0.0" });
  mocks.client.stopRun.mockResolvedValue(undefined);
  mocks.client.getRun.mockResolvedValue({
    runId: "run_1",
    status: "cancelled",
    output: "",
    error: null,
  });
  mocks.client.resolveApproval.mockResolvedValue(undefined);
  mocks.client.deleteSession.mockResolvedValue(undefined);
  mocks.db.deleteCareerOpsRun.mockResolvedValue(undefined);
  mocks.db.updateCareerOpsRunStatus.mockResolvedValue(undefined);
  // Models the adapters' single conditional transition rather than answering
  // yes to everything: unbound, still active, and created before the cutoff.
  // A fake that ignored those would let a test pass while the production write
  // matched nothing — or worse, matched a live bound run.
  mocks.db.expireCareerOpsRunReservation.mockImplementation(
    async (id: string, userId: string, cutoff: Date) => {
      const run = await mocks.db.getLatestCareerOpsRun();
      if (!run || run.id !== id || run.userId !== userId) return false;
      if (run.hermesRunId !== "") return false;
      if (!["queued", "running", "waiting_for_approval", "stopping"].includes(run.status)) {
        return false;
      }
      return run.createdAt.getTime() < cutoff.getTime();
    },
  );
  mocks.db.getCareerOpsThread.mockResolvedValue(null);
  mocks.db.getCareerOpsRun.mockResolvedValue(null);
  mocks.db.getLatestCareerOpsRun.mockResolvedValue(null);
  mocks.db.findCareerOpsRunByClientRequestId.mockResolvedValue(null);
  mocks.db.recordCareerOpsApprovalDecision.mockResolvedValue(undefined);
  mocks.db.settleCareerOpsApprovalDecision.mockResolvedValue(true);
  mocks.db.recoverCareerOpsApprovalGate.mockResolvedValue(false);
  mocks.db.openCareerOpsApprovalGate.mockResolvedValue(true);
});

describe("getCareerOpsStatus", () => {
  it("reports disabled when the integration is not configured", async () => {
    disable();
    await expect(getCareerOpsStatus()).resolves.toEqual({
      enabled: false,
      available: false,
      reason: "not_configured",
      capabilities: { stop: false, approvals: false, streaming: false },
      runTimeoutMs: 0,
    });
    expect(mocks.client.health).not.toHaveBeenCalled();
  });

  it("tells a non-owner the feature is unavailable without probing Hermes", async () => {
    await expect(getCareerOpsStatus({ userId: "user-b", user: { isAdmin: true } })).resolves.toMatchObject({
      enabled: false,
      available: false,
      reason: "not_owner",
    });
    expect(mocks.client.health).not.toHaveBeenCalled();
    expect(mocks.client.capabilities).not.toHaveBeenCalled();
  });

  it("reports the configured run lifetime so the client can size its polling", async () => {
    const status = await getCareerOpsStatus();
    expect(status.runTimeoutMs).toBeGreaterThan(0);
  });

  it("reports available with the advertised capabilities", async () => {
    await expect(getCareerOpsStatus()).resolves.toMatchObject({
      enabled: true,
      available: true,
      reason: null,
      capabilities: { stop: true, approvals: true, streaming: true },
    });
  });

  it("reports unavailable when Hermes is unreachable, without upstream detail", async () => {
    mocks.client.health.mockRejectedValue(
      new HermesError("unreachable", "Hermes is unreachable", `Bearer ${SECRET}`),
    );
    const status = await getCareerOpsStatus();
    expect(status).toMatchObject({
      enabled: true,
      available: false,
      reason: "unreachable",
      capabilities: { stop: false, approvals: false, streaming: false },
    });
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });

  it("reports unavailable when Hermes reports a degraded health status", async () => {
    mocks.client.health.mockResolvedValue({ healthy: false, version: null });
    await expect(getCareerOpsStatus()).resolves.toMatchObject({
      available: false,
      reason: "degraded",
    });
  });

  it("reflects partial capability support", async () => {
    mocks.client.capabilities.mockResolvedValue({
      runs: true,
      runStatus: true,
      runEvents: true,
      stop: false,
      approvals: false,
      sessions: true,
    });
    await expect(getCareerOpsStatus()).resolves.toMatchObject({
      available: true,
      capabilities: { stop: false, approvals: false, streaming: true },
    });
  });

  it("reports unavailable when run status polling is unsupported", async () => {
    // Status polling is the only recovery path after the event stream drops.
    mocks.client.capabilities.mockResolvedValue({
      runs: true,
      runStatus: false,
      runEvents: true,
      stop: true,
      approvals: true,
      sessions: true,
    });
    await expect(getCareerOpsStatus()).resolves.toMatchObject({
      available: false,
      reason: "unsupported",
    });
  });

  it("reports unavailable when Hermes cannot submit runs at all", async () => {
    mocks.client.capabilities.mockResolvedValue({
      runs: false,
      runStatus: false,
      runEvents: false,
      stop: false,
      approvals: false,
      sessions: false,
    });
    await expect(getCareerOpsStatus()).resolves.toMatchObject({
      available: false,
      reason: "unsupported",
    });
  });
});

describe("the feature is bound to the MCP token owner", () => {
  const OTHER = { userId: "user-b", user: { isAdmin: false } };

  it("refuses every operation for a user who is not the token owner", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    for (const invoke of [
      () => listCareerOpsThreads(OTHER),
      () => requireOwnedThread(OTHER, "thread-1"),
      () => createCareerOpsThread(OTHER, {}),
      () => startCareerOpsRun(OTHER, "thread-1", {
        message: "hi",
        clientRequestId: "client-id-1",
      }),
    ]) {
      await expect(invoke()).rejects.toMatchObject({ code: "unavailable" });
    }
    // Their run would have acted as the owner, reading the owner's CRM data.
    expect(mocks.client.createRun).not.toHaveBeenCalled();
    expect(mocks.client.createSession).not.toHaveBeenCalled();
  });

  it("serves the token owner normally", async () => {
    mocks.db.listCareerOpsThreads.mockResolvedValue([THREAD]);
    await expect(listCareerOpsThreads(SESSION_A)).resolves.toEqual([THREAD]);
  });
});

describe("ownership resolution", () => {
  it("returns the thread for its owner", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    await expect(requireOwnedThread(SESSION_A, "thread-1")).resolves.toEqual(THREAD);
    expect(mocks.db.getCareerOpsThread).toHaveBeenCalledWith("thread-1", "user-a");
  });

  it("rejects a foreign thread as not found", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(null);
    await expect(requireOwnedThread(SESSION_A, "thread-9")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("does not exempt administrators from ownership", async () => {
    // Make the administrator the token owner, so the check under test is
    // thread ownership rather than the owner binding.
    process.env.HERMES_CAREER_OPS_OWNER_USER_ID = "admin-1";
    mocks.db.getCareerOpsThread.mockResolvedValue(null);
    await expect(requireOwnedThread(ADMIN, "thread-1")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(mocks.db.getCareerOpsThread).toHaveBeenCalledWith("thread-1", "admin-1");
  });

  it("does not let an administrator borrow the token owner's agent", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    await expect(requireOwnedThread(ADMIN, "thread-1")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("rejects a foreign run and never resolves its thread", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue(null);
    await expect(requireOwnedRun(SESSION_A, "run-9")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(mocks.db.getCareerOpsThread).not.toHaveBeenCalled();
  });

  it("rejects a run whose thread is no longer owned", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue({
      id: "run-1",
      userId: "user-a",
      threadId: "thread-1",
      hermesRunId: "run_1",
      clientRequestId: "client-id-1",
      status: "running",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    mocks.db.getCareerOpsThread.mockResolvedValue(null);
    await expect(requireOwnedRun(SESSION_A, "run-1")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("thread lifecycle", () => {
  it("removes the upstream session when the mapping cannot be persisted", async () => {
    mocks.client.createSession.mockResolvedValue({ id: "sess-orphan" });
    mocks.db.createCareerOpsThread.mockRejectedValue(new Error("db down"));

    await expect(createCareerOpsThread(SESSION_A, {})).rejects.toBeInstanceOf(
      CareerOpsServiceError,
    );
    expect(mocks.client.deleteSession).toHaveBeenCalledWith("sess-orphan");
  });

  it("creates a global thread and a Hermes session scoped to the user's memory key", async () => {
    mocks.client.createSession.mockResolvedValue({ id: "sess-new" });
    mocks.db.createCareerOpsThread.mockResolvedValue({ ...THREAD, hermesSessionId: "sess-new" });

    const thread = await createCareerOpsThread(SESSION_A, { title: "Pipeline" });

    expect(thread.hermesSessionId).toBe("sess-new");
    const [sessionArgs] = mocks.client.createSession.mock.calls[0];
    expect(sessionArgs.memoryScope).toMatch(/^agent:career-ops:nexus:dm:[0-9a-f]{32}$/);
    expect(mocks.db.createCareerOpsThread).toHaveBeenCalledWith("user-a", {
      hermesSessionId: "sess-new",
      title: "Pipeline",
      applicationId: null,
    });
  });

  it("verifies application ownership before linking", async () => {
    mocks.db.getApplication.mockResolvedValue(null);
    await expect(
      createCareerOpsThread(SESSION_A, { applicationId: "42" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.client.createSession).not.toHaveBeenCalled();
  });

  it("links an owned application and names the thread after it", async () => {
    mocks.db.getApplication.mockResolvedValue({ id: "42", company: "Acme", role: "Engineer" });
    mocks.client.createSession.mockResolvedValue({ id: "sess-new" });
    mocks.db.createCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });

    await createCareerOpsThread(SESSION_A, { applicationId: "42" });

    expect(mocks.db.createCareerOpsThread).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ applicationId: "42", title: expect.stringContaining("Acme") }),
    );
  });

  it("resolves the application with an agent-visible, demo-excluding read", async () => {
    mocks.db.getApplication.mockResolvedValue({ id: "42", company: "Acme", role: "Engineer" });
    mocks.client.createSession.mockResolvedValue({ id: "sess-new" });
    mocks.db.createCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });

    await createCareerOpsThread(SESSION_A, { applicationId: "42" });

    expect(mocks.db.getApplication).toHaveBeenCalledWith("42", "user-a", {
      demoVisibility: "exclude",
    });
  });

  it("refuses a demo application, which the agent could never read through Nexus MCP", async () => {
    // The demo-excluding read is what the MCP server itself uses, so an
    // application it cannot see must not become a conversation's context.
    mocks.db.getApplication.mockResolvedValue(null);

    await expect(
      createCareerOpsThread(SESSION_A, { applicationId: "42" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.client.createSession).not.toHaveBeenCalled();
    expect(mocks.db.createCareerOpsThread).not.toHaveBeenCalled();
  });

  it("lists only the caller's threads", async () => {
    mocks.db.listCareerOpsThreads.mockResolvedValue([THREAD]);
    await expect(listCareerOpsThreads(SESSION_A)).resolves.toEqual([THREAD]);
    expect(mocks.db.listCareerOpsThreads).toHaveBeenCalledWith("user-a");
  });

  it("reports when the last run settled, so a stale transcript is detectable", async () => {
    // The drawer reads the transcript and the run state separately, and a run
    // that finishes between them is invisible to both. This timestamp is the
    // only thing that makes the older snapshot detectable.
    const settledAt = new Date("2026-02-02T10:00:00.000Z");
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      id: "run-1",
      userId: "user-a",
      threadId: "thread-1",
      hermesRunId: "run_done",
      clientRequestId: "client-id-1",
      status: "completed",
      createdAt: new Date(0),
      updatedAt: settledAt,
    });

    await expect(getCareerOpsThreadRunState(SESSION_A, "thread-1")).resolves.toEqual({
      activeRun: null,
      settledAt,
    });
  });

  it("reports no settle time while a run is still in flight", async () => {
    // Nothing has settled, so there is nothing a transcript could be older
    // than; the live run is what the drawer rejoins instead.
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      id: "run-1",
      userId: "user-a",
      threadId: "thread-1",
      hermesRunId: "run_live",
      clientRequestId: "client-id-1",
      status: "running",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const state = await getCareerOpsThreadRunState(SESSION_A, "thread-1");
    expect(state.activeRun?.id).toBe("run-1");
    expect(state.settledAt).toBeNull();
  });

  it("stops an active run before its mapping disappears", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      id: "run-1",
      userId: "user-a",
      threadId: "thread-1",
      hermesRunId: "run_live",
      clientRequestId: "client-id-1",
      status: "running",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    mocks.db.deleteCareerOpsThread.mockResolvedValue(THREAD);

    await deleteCareerOpsThread(SESSION_A, "thread-1");

    // Deleting a Hermes session does not stop its runs, and the stop call is
    // only an acknowledgement — deletion waits for an observed terminal state.
    expect(mocks.client.stopRun).toHaveBeenCalledWith("run_live");
    expect(mocks.client.getRun).toHaveBeenCalledWith("run_live");
    expect(mocks.db.deleteCareerOpsThread).toHaveBeenCalledWith("thread-1", "user-a");
  });

  it("refuses deletion while a stopped run has not reached a terminal state", async () => {
    // Failure injection: Hermes accepts the stop but the run stays `stopping`,
    // which is what a tool call that has not yet honoured cancellation looks
    // like. Deleting here would discard the last handle on a privileged run.
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "run_live",
      status: "running",
    });
    mocks.client.getRun.mockResolvedValue({
      runId: "run_live",
      status: "stopping",
      output: "",
      error: null,
    });

    // Drive the confirmation window with fake timers so the assertion is about
    // the refusal, not about how long the poll waits.
    vi.useFakeTimers();
    try {
      const pending = deleteCareerOpsThread(SESSION_A, "thread-1");
      const settled = expect(pending).rejects.toMatchObject({ code: "conflict" });
      await vi.advanceTimersByTimeAsync(30_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
    expect(mocks.db.deleteCareerOpsThread).not.toHaveBeenCalled();
    expect(mocks.client.deleteSession).not.toHaveBeenCalled();
  });

  it("refuses deletion when the stop request itself fails", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "run_live",
      status: "running",
    });
    mocks.client.stopRun.mockRejectedValue(new Error("upstream down"));

    await expect(deleteCareerOpsThread(SESSION_A, "thread-1")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(mocks.db.deleteCareerOpsThread).not.toHaveBeenCalled();
  });

  it("refuses to delete a conversation whose run has no stoppable id", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "",
      status: "queued",
      createdAt: new Date(),
    });

    await expect(deleteCareerOpsThread(SESSION_A, "thread-1")).rejects.toMatchObject({
      code: "conflict",
    });
    // Deleting the Hermes session would not stop the run, and no id remains.
    expect(mocks.db.deleteCareerOpsThread).not.toHaveBeenCalled();
    expect(mocks.client.deleteSession).not.toHaveBeenCalled();
  });

  it("keeps the conversation when an active run could not be stopped", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "run_live",
      status: "running",
    });
    mocks.client.stopRun.mockRejectedValue(new HermesError("upstream_error", "boom"));

    await expect(deleteCareerOpsThread(SESSION_A, "thread-1")).rejects.toMatchObject({
      code: "conflict",
    });
    // Deleting would have destroyed the last handle on a live privileged run.
    expect(mocks.db.deleteCareerOpsThread).not.toHaveBeenCalled();
  });

  it("deletes the Nexus mapping even when the upstream session delete fails", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.db.deleteCareerOpsThread.mockResolvedValue(THREAD);
    mocks.client.deleteSession.mockRejectedValue(
      new HermesError("upstream_error", "boom", `Bearer ${SECRET}`),
    );

    await expect(deleteCareerOpsThread(SESSION_A, "thread-1")).resolves.toBeUndefined();
    expect(mocks.db.deleteCareerOpsThread).toHaveBeenCalledWith("thread-1", "user-a");
  });

  it("refuses to delete a thread the caller does not own", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(null);
    await expect(deleteCareerOpsThread(SESSION_A, "thread-9")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(mocks.client.deleteSession).not.toHaveBeenCalled();
  });

  it("reads messages from the owned Hermes session only", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.client.listSessionMessages.mockResolvedValue([
      { id: "1", role: "user", content: "hi", createdAt: 1 },
    ]);
    await expect(listCareerOpsThreadMessages(SESSION_A, "thread-1")).resolves.toHaveLength(1);
    expect(mocks.client.listSessionMessages).toHaveBeenCalledWith("sess-1");
  });
});

const RESERVATION = {
  id: "run-1",
  userId: "user-a",
  threadId: "thread-1",
  hermesRunId: "run_1",
  clientRequestId: "client-id-1",
  status: "queued" as const,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("startCareerOpsRun", () => {
  beforeEach(() => {
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
    mocks.client.listSessionMessages.mockResolvedValue([]);
    mocks.client.createRun.mockResolvedValue({ runId: "run_1" });
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "claimed", run: { ...RESERVATION } });
    mocks.db.bindCareerOpsRunHermesId.mockResolvedValue({ ...RESERVATION });
  });

  it("starts a run for an owned thread", async () => {
    const run = await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "hello",
      clientRequestId: "client-id-1",
    });
    expect(run.hermesRunId).toBe("run_1");
    const [args] = mocks.client.createRun.mock.calls[0];
    expect(args.sessionId).toBe("sess-1");
    expect(args.input).toBe("hello");
  });

  it("refuses a request id reused for different text", async () => {
    // Idempotency that ignores the body is not idempotency: the client would be
    // shown the earlier run's answer to a question it no longer asked.
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "request_mismatch" });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "a different question",
        clientRequestId: "client-id-reused",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("binds the request id to the message it was claimed for", async () => {
    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "  hello there\r\n",
      clientRequestId: "client-id-hash",
    });
    const [, claimed] = mocks.db.claimCareerOpsRun.mock.calls[0];
    expect(claimed.requestHash).toBeTruthy();
    // The digest, never the text: Nexus does not duplicate the conversation.
    expect(claimed.requestHash).not.toContain("hello");

    // Normalized, so trimming and line endings do not read as a new question.
    mocks.db.claimCareerOpsRun.mockClear();
    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "hello there",
      clientRequestId: "client-id-hash",
    });
    const [, again] = mocks.db.claimCareerOpsRun.mock.calls[0];
    expect(again.requestHash).toBe(claimed.requestHash);
  });

  it("carries the earlier turns into the next one", async () => {
    // The Runs API assembles model history from explicit request fields; it
    // does not hydrate stored messages from `session_id`. Sending the session
    // id alone gave a drawer that displayed a continuous conversation while
    // every turn started from nothing — and no mock caught it, because the mock
    // answered whatever contract this client sent.
    mocks.client.listSessionMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "my target is a staff role", createdAt: 1 },
      { id: "m2", role: "assistant", content: "noted, staff level", createdAt: 2 },
    ]);

    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "which of my applications match it?",
      clientRequestId: "client-id-turn-two",
    });

    const [args] = mocks.client.createRun.mock.calls[0];
    // Turn two must be able to answer "it" — the referent is only in turn one.
    expect(args.history).toEqual([
      { role: "user", content: "my target is a staff role" },
      { role: "assistant", content: "noted, staff level" },
    ]);
  });

  it("bounds the replayed history by turns and by size, keeping the newest", async () => {
    // This text is assistant output, so it is attacker-influenced and shares
    // the request-body limits of everything else on this path. A follow-up
    // refers to the newest turns, so those are the ones worth the budget.
    mocks.client.listSessionMessages.mockResolvedValue(
      Array.from({ length: 60 }, (_, index) => ({
        id: `m${index}`,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `turn ${index}`,
        createdAt: index,
      })),
    );

    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "and now?",
      clientRequestId: "client-id-bounded-history",
    });

    const [args] = mocks.client.createRun.mock.calls[0];
    expect(args.history.length).toBeLessThanOrEqual(20);
    // Oldest first within what was kept, and the newest turn is present.
    expect(args.history.at(-1)).toEqual({ role: "assistant", content: "turn 59" });
    expect(args.history.map((m: { content: string }) => m.content)).not.toContain("turn 0");
  });

  it("keeps a bounded portion of an oversized turn rather than none of it", async () => {
    // Transcript content is accepted up to 200 000 characters, so one message
    // can exceed the whole budget. Ending the walk there returned no history at
    // all — the next turn lost even the question it was answering, while the
    // drawer still showed a continuous conversation.
    mocks.client.listSessionMessages.mockResolvedValue([
      { id: "m1", role: "user", content: "what did I ask?", createdAt: 1 },
      { id: "m2", role: "assistant", content: "x".repeat(200_000), createdAt: 2 },
    ]);

    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "continue",
      clientRequestId: "client-id-oversized",
    });

    const [args] = mocks.client.createRun.mock.calls[0];
    expect(args.history.length).toBeGreaterThan(0);
    expect(args.history.at(-1).content.length).toBeLessThan(200_000);
    expect(args.history.at(-1).role).toBe("assistant");
  });

  it("refuses to start a turn whose earlier turns it could not read", async () => {
    // Failing closed: a conversation that silently forgets is the defect this
    // history exists to fix, so an unreadable transcript is reported rather
    // than papered over with a run that starts from nothing.
    mocks.client.listSessionMessages.mockRejectedValue(
      new HermesError("upstream_error", "transcript unavailable"),
    );

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "continue",
        clientRequestId: "client-id-no-history",
      }),
    ).rejects.toBeTruthy();
    expect(mocks.client.createRun).not.toHaveBeenCalled();
    // Nothing was sent upstream, so the conversation must not stay reserved.
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledWith("run-1", "user-a");
  });

  it("claims the client request id before starting anything upstream", async () => {
    const order: string[] = [];
    mocks.db.claimCareerOpsRun.mockImplementation(async () => {
      order.push("reserve");
      return {
        outcome: "claimed" as const,
        run: { ...RESERVATION, hermesRunId: "" },
      };
    });
    mocks.client.createRun.mockImplementation(async () => {
      order.push("createRun");
      return { runId: "run_1" };
    });

    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "hello",
      clientRequestId: "client-id-1",
    });

    expect(order).toEqual(["reserve", "createRun"]);
    expect(mocks.db.bindCareerOpsRunHermesId).toHaveBeenCalledWith("run-1", "user-a", "run_1");
  });

  it("starts no upstream run at all for a repeated client request id", async () => {
    mocks.db.claimCareerOpsRun.mockResolvedValue({
      outcome: "existing",
      run: { ...RESERVATION, hermesRunId: "run_first", status: "running" },
    });

    const run = await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "hello",
      clientRequestId: "client-id-1",
    });

    expect(run.hermesRunId).toBe("run_first");
    // The whole point of reserving first: no duplicate agent run is ever
    // started, so there is nothing to stop after the fact.
    expect(mocks.client.createRun).not.toHaveBeenCalled();
    expect(mocks.client.stopRun).not.toHaveBeenCalled();
  });

  it("kills the orphan and releases the claim when binding the run id fails", async () => {
    mocks.db.claimCareerOpsRun.mockResolvedValue({
      outcome: "claimed",
      run: { ...RESERVATION, hermesRunId: "" },
    });
    mocks.db.bindCareerOpsRunHermesId.mockRejectedValue(new Error("db unavailable"));

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).rejects.toBeInstanceOf(CareerOpsServiceError);

    // Otherwise a live agent run would be left that nothing can address, and a
    // retry would keep returning the unbound reservation. The stop is awaited
    // and confirmed terminal before the claim is released.
    expect(mocks.client.stopRun).toHaveBeenCalledWith("run_1");
    expect(mocks.client.getRun).toHaveBeenCalledWith("run_1");
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledWith("run-1", "user-a");
  });

  it("keeps the claim when an orphaned run cannot be confirmed stopped", async () => {
    // Failure injection for the process-death case the reviewer raised: if the
    // stop cannot be confirmed, releasing the slot would let a retry start a
    // second privileged run beside one that may still be executing.
    mocks.db.claimCareerOpsRun.mockResolvedValue({
      outcome: "claimed",
      run: { ...RESERVATION, hermesRunId: "" },
    });
    mocks.db.bindCareerOpsRunHermesId.mockRejectedValue(new Error("db unavailable"));
    mocks.client.stopRun.mockRejectedValue(new Error("upstream down"));

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).rejects.toBeInstanceOf(CareerOpsServiceError);

    expect(mocks.db.deleteCareerOpsRun).not.toHaveBeenCalled();
    expect(mocks.db.updateCareerOpsRunStatus).toHaveBeenCalledWith("run-1", "user-a", "stopping");
  });

  it("stops the upstream run when its reservation disappeared", async () => {
    mocks.db.claimCareerOpsRun.mockResolvedValue({
      outcome: "claimed",
      run: { ...RESERVATION, hermesRunId: "" },
    });
    mocks.db.bindCareerOpsRunHermesId.mockResolvedValue(null);

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.client.stopRun).toHaveBeenCalledWith("run_1");
  });

  it.each([
    ["unauthorized" as const],
    ["rate_limited" as const],
  ])("releases the claim when Hermes definitively rejected the request (%s)", async (kind) => {
    mocks.db.claimCareerOpsRun.mockResolvedValue({
      outcome: "claimed",
      run: { ...RESERVATION, hermesRunId: "" },
    });
    mocks.client.createRun.mockRejectedValue(new HermesError(kind, "rejected"));

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).rejects.toBeInstanceOf(CareerOpsServiceError);

    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledWith("run-1", "user-a");
  });

  it.each([
    ["timeout" as const],
    ["upstream_error" as const],
    ["unreachable" as const],
  ])("keeps the claim when the outcome is ambiguous (%s)", async (kind) => {
    mocks.db.claimCareerOpsRun.mockResolvedValue({
      outcome: "claimed",
      run: { ...RESERVATION, hermesRunId: "" },
    });
    mocks.client.createRun.mockRejectedValue(new HermesError(kind, "ambiguous"));

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).rejects.toBeInstanceOf(CareerOpsServiceError);

    // The run may already be executing upstream; releasing would let a retry
    // with the same id start a second privileged run.
    expect(mocks.db.deleteCareerOpsRun).not.toHaveBeenCalled();
  });

  it("refuses to start a run when Hermes no longer supports run status", async () => {
    mocks.client.capabilities.mockResolvedValue({
      runs: true,
      runStatus: false,
      runEvents: true,
      stop: true,
      approvals: true,
      sessions: true,
    });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
    expect(mocks.db.claimCareerOpsRun).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", { message: "   ", clientRequestId: "client-id-1" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("rejects an oversized message", async () => {
    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "x".repeat(50_000),
        clientRequestId: "client-id-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("rejects a malformed client request id", async () => {
    for (const value of ["", "short", "has spaces!!", "x".repeat(200)]) {
      await expect(
        startCareerOpsRun(SESSION_A, "thread-1", { message: "hello", clientRequestId: value }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("passes application context as instructions without the job description", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });
    mocks.db.getApplication.mockResolvedValue({
      id: "42",
      company: "Acme",
      role: "Engineer",
      jobDescription: "TOP SECRET JOB TEXT",
    });

    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "hello",
      clientRequestId: "client-id-1",
    });

    const [args] = mocks.client.createRun.mock.calls[0];
    expect(args.instructions).toContain("42");
    expect(args.instructions).toContain("Acme");
    expect(args.instructions).not.toContain("TOP SECRET JOB TEXT");
    expect(mocks.db.getApplication).toHaveBeenCalledWith("42", "user-a", {
      demoVisibility: "exclude",
    });
  });

  it("refuses to run when the conversation's application is no longer agent-visible", async () => {
    // Falling back to global instructions would silently widen the run's scope:
    // the surface still shows application context, so the user would believe
    // the agent is confined to one opportunity while it could act CRM-wide.
    mocks.db.getCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });
    mocks.db.getApplication.mockResolvedValue(null);

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(mocks.client.createRun).not.toHaveBeenCalled();
    // Nothing was submitted, so the conversation must not stay claimed.
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledWith("run-1", "user-a");
  });

  it("releases the claim when Hermes explicitly refuses the submission", async () => {
    // A stated refusal means no run was accepted, so holding the claim would
    // block the conversation for the whole run lifetime over a request that
    // provably did nothing.
    mocks.client.createRun.mockRejectedValue(new HermesError("conflict", "already running"));

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-refused",
      }),
    ).rejects.toBeInstanceOf(CareerOpsServiceError);
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledWith("run-1", "user-a");
  });

  it("reclaims an expired reservation for a retry that reuses its request id", async () => {
    // After a lost response the browser deliberately resends the same request
    // id, so every retry lands on the existing reservation — never on the
    // active-run branch, which was the only place expiry was attempted. The
    // bounded recovery was therefore unreachable from the path clients take:
    // the conversation stayed blocked past the cutoff.
    const stale = {
      ...RESERVATION,
      id: "run-stale",
      hermesRunId: "",
      clientRequestId: "client-id-retry",
    };
    mocks.db.claimCareerOpsRun
      .mockResolvedValueOnce({ outcome: "existing", run: stale })
      .mockResolvedValueOnce({ outcome: "claimed", run: { ...RESERVATION, id: "run-fresh" } });
    // Past the cutoff: Nexus has given up on ever observing this run.
    mocks.db.expireCareerOpsRunReservation.mockResolvedValue(true);

    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "hello",
      clientRequestId: "client-id-retry",
    });

    // Settled, freed, and claimed again — the retry goes through rather than
    // being told to keep waiting.
    expect(mocks.db.expireCareerOpsRunReservation).toHaveBeenCalled();
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledWith("run-stale", "user-a");
    expect(mocks.db.claimCareerOpsRun).toHaveBeenCalledTimes(2);
    expect(mocks.client.createRun).toHaveBeenCalled();
  });

  it("still refuses a retry whose reservation has not expired", async () => {
    // Before the cutoff the earlier attempt may genuinely be executing, and
    // Nexus has no id to observe or stop it with. Reclaiming then would start a
    // second privileged run alongside the first.
    const stale = {
      ...RESERVATION,
      id: "run-stale",
      hermesRunId: "",
      clientRequestId: "client-id-retry",
    };
    // A second claim would succeed, so if the reservation were reclaimed here
    // the run would go through — which is exactly what must not happen.
    mocks.db.claimCareerOpsRun
      .mockResolvedValueOnce({ outcome: "existing", run: stale })
      .mockResolvedValue({ outcome: "claimed", run: { ...RESERVATION, id: "run-fresh" } });
    mocks.db.expireCareerOpsRunReservation.mockResolvedValue(false);

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-retry",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("settles a reservation it could not delete before submitting", async () => {
    // The pre-submission failures free the slot for the same reason a stated
    // refusal does — nothing reached Hermes — so a lost delete strands the
    // conversation just as thoroughly. One durable release covers all of them.
    mocks.db.getCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });
    mocks.db.getApplication.mockRejectedValue(new Error("database unavailable"));
    mocks.db.deleteCareerOpsRun.mockRejectedValue(new Error("database unavailable"));

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-presubmit-release-fails",
      }),
    ).rejects.toBeInstanceOf(CareerOpsServiceError);

    expect(mocks.client.createRun).not.toHaveBeenCalled();
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledTimes(3);
    expect(mocks.db.updateCareerOpsRunStatus).toHaveBeenCalledWith(
      "run-1",
      "user-a",
      "abandoned",
    );
  });

  it("settles a reservation it could not delete after a stated refusal", async () => {
    // The reservation holds the conversation's one active slot. Discarding a
    // failed release blocked the conversation for the whole reservation
    // lifetime over a request Hermes had explicitly refused: the same request
    // id reports an ambiguous start, a new one is refused by the active-run
    // invariant, and nothing on screen explains either.
    mocks.client.createRun.mockRejectedValue(new HermesError("conflict", "already running"));
    mocks.db.deleteCareerOpsRun.mockRejectedValue(new Error("database unavailable"));

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-release-fails",
      }),
    ).rejects.toBeInstanceOf(CareerOpsServiceError);

    // Retried, then settled terminal so the partial index frees the slot.
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledTimes(3);
    expect(mocks.db.updateCareerOpsRunStatus).toHaveBeenCalledWith(
      "run-1",
      "user-a",
      "abandoned",
    );
  });

  it("releases the reservation when resolving application context fails", async () => {
    // The failure is provably before submission: nothing reached Hermes. Holding
    // the claim would stall the conversation for the whole reservation lifetime
    // over a transient read error.
    mocks.db.getCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });
    mocks.db.getApplication.mockRejectedValue(new Error("database unavailable"));

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).rejects.toBeInstanceOf(CareerOpsServiceError);

    expect(mocks.client.createRun).not.toHaveBeenCalled();
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledWith("run-1", "user-a");
  });

  it("holds an ambiguous reservation for the whole run lifetime, not a grace period", async () => {
    // A run Hermes accepted may still be executing; expiring early would let a
    // fresh request id start a second privileged agent on the same session.
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "active_run_exists" });
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "",
      status: "queued",
      createdAt: new Date(Date.now() - 3 * 60_000),
    });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-still-held",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
    // Not yet past the cutoff, so the conditional transition matches nothing.
    await expect(
      mocks.db.expireCareerOpsRunReservation.mock.results.at(-1)?.value,
    ).resolves.toBe(false);
    expect(mocks.db.updateCareerOpsRunStatus).not.toHaveBeenCalled();
  });

  it("settles an expired reservation when it is read, not only on the next submission", async () => {
    // The adapters enforce the active-run invariant on the stored status, so a
    // row this call treats as inactive while the database still counts it as
    // active leaves the conversation impossible to delete.
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "",
      status: "queued",
      createdAt: new Date(Date.now() - 60 * 60_000),
    });

    await expect(getActiveCareerOpsRun(SESSION_A, "thread-1")).resolves.toBeNull();
    // `abandoned`, never `failed`: Nexus holds no upstream id for this run, so
    // it never observed an outcome and must not assert one. And the decision is
    // the database's — one conditional transition that binding cannot race.
    expect(mocks.db.expireCareerOpsRunReservation).toHaveBeenCalledWith(
      "run-1",
      "user-a",
      expect.any(Date),
    );
    expect(mocks.db.updateCareerOpsRunStatus).not.toHaveBeenCalled();
  });

  it("settles an expired ambiguous reservation so the conversation is usable again", async () => {
    // Past the reservation lifetime the run can no longer be executing, and a
    // row nothing can settle would otherwise wedge the conversation forever now
    // that only one active run is admitted.
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "active_run_exists" });
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "",
      status: "queued",
      createdAt: new Date(Date.now() - 60 * 60_000),
    });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-after-expiry",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.db.expireCareerOpsRunReservation).toHaveBeenCalledWith(
      "run-1",
      "user-a",
      expect.any(Date),
    );
    expect(mocks.db.updateCareerOpsRunStatus).not.toHaveBeenCalled();
  });

  it("lets the conversation recover after an ambiguous submission expires", async () => {
    // Regression: an unbound reservation counted as an active run forever, so a
    // single timeout permanently refused every later message on the thread.
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "",
      status: "queued",
      createdAt: new Date(Date.now() - 60 * 60_000),
    });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-after-expiry",
      }),
    ).resolves.toBeTruthy();
    expect(mocks.client.createRun).toHaveBeenCalled();
  });

  it("still refuses while an ambiguous submission is recent", async () => {
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "active_run_exists" });
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "",
      status: "queued",
      createdAt: new Date(),
    });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-too-soon",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("returns its own run on an idempotent retry rather than refusing it", async () => {
    // The first attempt's reservation IS the active run; refusing the retry
    // would tell a client whose response was lost that the run failed.
    const claimed = { ...RESERVATION, hermesRunId: "run_first", status: "running" as const };
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "existing", run: claimed });
    mocks.db.getLatestCareerOpsRun.mockResolvedValue(claimed);

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-1",
      }),
    ).resolves.toMatchObject({ hermesRunId: "run_first" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("refuses a second concurrent run on the same thread", async () => {
    // The refusal now comes from the database claim, not from a prior read, so
    // two simultaneous submissions cannot both pass it.
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "active_run_exists" });
    mocks.db.getLatestCareerOpsRun.mockResolvedValue({
      ...RESERVATION,
      hermesRunId: "run_inflight",
      status: "running",
    });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-second",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
    // A bound run is still live; it must never be settled away to free the
    // slot, and expiry is not even attempted for one that carries an upstream id.
    expect(mocks.db.updateCareerOpsRunStatus).not.toHaveBeenCalled();
    expect(mocks.db.expireCareerOpsRunReservation).not.toHaveBeenCalled();
  });

  it("reports a claim against a deleted conversation as not found", async () => {
    mocks.db.claimCareerOpsRun.mockResolvedValue({ outcome: "thread_gone" });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-gone",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });

  it("refuses to start a run on a foreign thread", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(null);
    await expect(
      startCareerOpsRun(SESSION_A, "thread-9", { message: "hi", clientRequestId: "client-id-1" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });
});

/**
 * Mint a real challenge the way the event route does, and reflect the run state
 * that disclosure produces: the challenge becomes the run's outstanding one.
 */
async function challengeFor(
  runId: string,
  choices: Array<"once" | "session" | "always" | "deny">,
) {
  const token = await careerOpsApprovalChallengeFor(SESSION_A, runId, {
    operation: "shell",
    summary: "Update the application",
    details: "nexus update 42",
    choices,
  });
  return token;
}

describe("run controls", () => {
  const RUN = {
    id: "run-1",
    userId: "user-a",
    threadId: "thread-1",
    hermesRunId: "run_1",
    clientRequestId: "client-id-1",
    status: "running" as const,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  /** Mirrors the run's outstanding-approval slot the way the adapters do. */
  let outstandingChallenge: string | null = null;
  /** The run's own status, which is the other signal that a gate is open. */
  let runStatus: string = RUN.status;

  /**
   * Put the run at a gate with no recoverable prompt: the event route records
   * `waiting_for_approval` when it emits the prompt, and the challenge may
   * never have landed or may already have been claimed. This is the state the
   * "denial is always available" requirement is about — a run that is merely
   * executing is not at a gate at all.
   */
  function atGateWithoutPrompt() {
    runStatus = "waiting_for_approval";
    outstandingChallenge = null;
  }

  beforeEach(() => {
    outstandingChallenge = null;
    runStatus = RUN.status;
    mocks.db.openCareerOpsApprovalGate.mockImplementation(
      async (_id: string, _userId: string, challengeId: string | null) => {
        // Guarded in both backends: a run that has already settled has no gate,
        // and the write reports that rather than throwing. A fake that always
        // succeeds cannot tell a disclosed prompt from a refused one.
        if (["completed", "failed", "cancelled", "abandoned"].includes(runStatus)) {
          return false;
        }
        outstandingChallenge = challengeId;
        // Disclosing a prompt means the run *is* at a gate: the event route
        // records `waiting_for_approval` as it emits. Leaving the fixture at
        // `running` is what made the old race test pass for the wrong reason —
        // denial was refused for having no gate, not for losing one.
        if (challengeId) runStatus = "waiting_for_approval";
        return true;
      },
    );
    // Models the adapters' single conditional claim. Crucially it also moves
    // the run out of `waiting_for_approval`, the way both backends do — a fake
    // that only cleared the challenge would let a denial keep reading an open
    // gate that a grant had already taken, which is the bug this replaced.
    mocks.db.claimCareerOpsApprovalGate.mockImplementation(
      async (_id: string, _userId: string, challengeId: string | null) => {
        if (runStatus !== "waiting_for_approval") return null;
        const outstanding = outstandingChallenge ?? "";
        if (challengeId !== null && outstanding !== challengeId) return null;
        outstandingChallenge = null;
        runStatus = "running";
        return { challengeId: outstanding };
      },
    );
    mocks.db.releaseCareerOpsApprovalGate.mockImplementation(
      async (_id: string, _userId: string, challengeId: string) => {
        if (runStatus !== "running" || outstandingChallenge) return;
        runStatus = "waiting_for_approval";
        outstandingChallenge = challengeId || null;
      },
    );
    mocks.db.getCareerOpsRun.mockImplementation(async () => ({
      ...RUN,
      status: runStatus,
      pendingApprovalChallengeId: outstandingChallenge,
    }));
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
  });

  it("stops an owned run", async () => {
    await expect(stopCareerOpsRun(SESSION_A, "run-1")).resolves.toBeUndefined();
    expect(mocks.client.stopRun).toHaveBeenCalledWith("run_1");
  });

  it("treats stopping an already-finished run as satisfied", async () => {
    // A delayed stop for a run that already settled must not become an error
    // just because Hermes no longer has it.
    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, status: "completed" });
    await expect(stopCareerOpsRun(SESSION_A, "run-1")).resolves.toBeUndefined();
    expect(mocks.client.stopRun).not.toHaveBeenCalled();
  });

  it("refuses to stop a run that was never bound upstream", async () => {
    // Ambiguous submission: Hermes may be executing it, but Nexus has no id to
    // stop it with. Returning quietly would report "stopping" to the user when
    // nothing was sent anywhere.
    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, hermesRunId: "" });
    await expect(stopCareerOpsRun(SESSION_A, "run-1")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(mocks.client.stopRun).not.toHaveBeenCalled();
  });

  it("refuses to stop a foreign run", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue(null);
    await expect(stopCareerOpsRun(SESSION_A, "run-1")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(mocks.client.stopRun).not.toHaveBeenCalled();
  });

  it("forwards an approval decision for an owned run", async () => {
    atGateWithoutPrompt();
    await resolveCareerOpsApproval(SESSION_A, "run-1", "deny");
    expect(mocks.client.resolveApproval).toHaveBeenCalledWith("run_1", "deny");
  });

  it("records the decision for attribution after forwarding it", async () => {
    atGateWithoutPrompt();
    await resolveCareerOpsApproval(SESSION_A, "run-1", "deny");
    // Intent first, outcome second: a decision Hermes accepted must never be
    // invisible to Nexus just because the later write failed.
    expect(mocks.db.recordCareerOpsApprovalDecision).toHaveBeenNthCalledWith(
      1,
      "run-1",
      "user-a",
      "deny",
      "",
      "pending",
    );
    // The outcome is a *conditional* transition, not another blind write:
    // Hermes may have reached the next gate while the call was in flight.
    expect(mocks.db.settleCareerOpsApprovalDecision).toHaveBeenLastCalledWith(
      "run-1",
      "user-a",
      "",
      "effect_completed",
    );
  });

  it("records a stated upstream refusal as a known non-effect", async () => {
    mocks.client.resolveApproval.mockRejectedValue(new HermesError("conflict", "not pending"));
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", await challengeFor("run-1", ["once", "deny"])),
    ).rejects.toBeTruthy();
    // Hermes said no, so nothing happened — and the audit says exactly that
    // rather than leaving the decision looking still in flight.
    expect(mocks.db.settleCareerOpsApprovalDecision).toHaveBeenLastCalledWith(
      "run-1",
      "user-a",
      expect.any(String),
      "not_applied",
    );
  });

  it("does not forward a decision it cannot record", async () => {
    // Recording first exists so a privileged action is never taken without
    // attribution. Forwarding anyway when the record fails would defeat that.
    mocks.db.recordCareerOpsApprovalDecision.mockRejectedValue(new Error("db down"));
    atGateWithoutPrompt();
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "deny")).rejects.toMatchObject({
      code: "upstream_error",
    });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("rejects an unsupported approval decision", async () => {
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "maybe" as never),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("refuses an approval decision for a foreign run", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue(null);
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "once", await challengeFor("run-1", ["once", "deny"]))).rejects.toMatchObject({
      code: "not_found",
    });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("surfaces an upstream conflict as a conflict, without upstream text", async () => {
    mocks.client.resolveApproval.mockRejectedValue(
      new HermesError("conflict", "no pending approval", `Bearer ${SECRET}`),
    );
    const error = await resolveCareerOpsApproval(SESSION_A, "run-1", "once", await challengeFor("run-1", ["once", "deny"])).catch((r) => r);
    expect(error).toBeInstanceOf(CareerOpsServiceError);
    expect(error.code).toBe("conflict");
    expect(JSON.stringify({ message: error.message })).not.toContain(SECRET);
  });

  it("refuses to submit a run when Hermes withdrew run submission", async () => {
    // A partial downgrade: run status still advertised, submission gone. A
    // stale tab would otherwise submit to an endpoint that no longer exists and
    // leave an ambiguous reservation holding the conversation.
    resetCareerOpsCapabilityCacheForTests();
    mocks.client.capabilities.mockResolvedValue({
      runs: false,
      runStatus: true,
      runEvents: true,
      stop: true,
      approvals: true,
      sessions: true,
    });

    await expect(
      startCareerOpsRun(SESSION_A, "thread-1", {
        message: "hello",
        clientRequestId: "client-id-downgraded",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
    expect(mocks.db.claimCareerOpsRun).not.toHaveBeenCalled();
  });

  it("marks the outcome unknown when the upstream call is ambiguous", async () => {
    // A transport failure does not say whether Hermes applied the decision, so
    // the record must not claim it did — nor silently disappear.
    mocks.client.resolveApproval.mockRejectedValue(new HermesError("timeout", "gone quiet"));
    atGateWithoutPrompt();

    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "deny")).rejects.toBeTruthy();
    expect(mocks.db.settleCareerOpsApprovalDecision).toHaveBeenLastCalledWith(
      "run-1",
      "user-a",
      "",
      "outcome_unknown",
    );
  });

  it("returns the challenge when the decision could not be recorded", async () => {
    // Nothing was sent upstream, so restoring it is not a replay risk — and
    // the prompt came from a single-consumer stream that cannot reissue it.
    const challenge = await challengeFor("run-1", ["once"]);
    mocks.db.recordCareerOpsApprovalDecision.mockRejectedValueOnce(new Error("db down"));

    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).rejects.toMatchObject({ code: "upstream_error" });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();

    // The retry succeeds because the challenge is outstanding again.
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).resolves.toBeUndefined();
  });

  it("refuses a granting decision that carries no challenge", async () => {
    // Ownership of the run is not consent to a specific action: without proof
    // that Nexus disclosed this prompt, an authenticated request could approve
    // something the browser never displayed.
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "once")).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("refuses a decision broader than the prompt offered", async () => {
    await expect(
      resolveCareerOpsApproval(
        SESSION_A,
        "run-1",
        "always",
        await challengeFor("run-1", ["once", "deny"]),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("refuses a challenge minted for a different run", async () => {
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", await challengeFor("run-other", ["once"])),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("refuses to replay a challenge that was already consumed", async () => {
    const challenge = await challengeFor("run-1", ["once", "deny"]);
    await resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge);
    const consumedId = mocks.db.recordCareerOpsApprovalDecision.mock.calls.at(-1)?.[3] as string;
    expect(consumedId).toBeTruthy();

    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, approvalChallengeId: consumedId });
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses a token minted for an earlier gate on the same run", async () => {
    // The bypass this closes: one run can reach several gates inside a
    // challenge lifetime. Checking only "not the one already consumed" left
    // gate A's token verifying against run, owner and choice — and it could
    // then authorize whatever action is pending now.
    const gateA = await challengeFor("run-1", ["once", "deny"]);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await challengeFor("run-1", ["once", "deny"]); // gate B is now outstanding

    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", gateA),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("consumes the outstanding challenge so it cannot be presented twice", async () => {
    const challenge = await challengeFor("run-1", ["once"]);
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).resolves.toBeUndefined();

    // The claim is what closes the gate, in the same statement that checks it.
    expect(mocks.db.claimCareerOpsApprovalGate).toHaveBeenCalledWith(
      "run-1",
      "user-a",
      expect.any(String),
    );
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("lets only one of two concurrent decisions carrying the same challenge through", async () => {
    // Both requests read the same outstanding id; only the database can decide
    // which one owns it. The loser must not reach Hermes, or it could land
    // after the winner advanced the run to a different gate.
    const challenge = await challengeFor("run-1", ["once"]);
    const results = await Promise.allSettled([
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(mocks.client.resolveApproval).toHaveBeenCalledTimes(1);
  });

  it("invalidates the outstanding challenge when denying", async () => {
    // Otherwise a denial can reach Hermes first, the run can advance to the
    // next gate, and a grant still carrying the previous gate's token would be
    // applied to the new action.
    const challenge = await challengeFor("run-1", ["once"]);
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "deny")).resolves.toBeUndefined();

    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mocks.client.resolveApproval).toHaveBeenCalledTimes(1);
  });

  it("lets only one of a racing grant and denial reach the agent", async () => {
    // The regression the owner reproduced: both requests read an open gate.
    // With the challenge consumed by the grant, the denial's own claim came
    // back empty — but it then proceeded on the run's still-`waiting_for_approval`
    // status, so both were audited and both were forwarded, and whichever
    // arrived second could answer a gate the agent had already moved on to.
    const challenge = await challengeFor("run-1", ["once"]);
    expect(runStatus).toBe("waiting_for_approval");

    const results = await Promise.allSettled([
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
      resolveCareerOpsApproval(SESSION_A, "run-1", "deny"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mocks.client.resolveApproval).toHaveBeenCalledTimes(1);
    // And the audit records one decision, not two.
    expect(mocks.db.recordCareerOpsApprovalDecision.mock.calls.map((call) => call[2])).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    const decided = new Set(
      mocks.db.recordCareerOpsApprovalDecision.mock.calls.map((call) => call[2]),
    );
    expect(decided.size).toBe(1);
  });

  it("always lets the owner deny, even with no recoverable prompt", async () => {
    // After the single-consumer stream drops, the prompt cannot be reissued.
    // Denial grants nothing, so requiring proof of disclosure for it would take
    // away the safe option in exactly the case that needs it.
    atGateWithoutPrompt();
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "deny")).resolves.toBeUndefined();
    expect(mocks.client.resolveApproval).toHaveBeenCalledWith("run_1", "deny");
  });

  it("recovers a gate that only polling ever saw", async () => {
    // The event stream is single-consumer and Hermes need not support it at
    // all, so `waiting_for_approval` is sometimes first observed by status
    // recovery. Without opening a gate there, the browser shows the recovered
    // denial-only prompt while every decision is refused for having none, and
    // Hermes waits forever.
    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, status: "running" });
    mocks.client.getRun.mockResolvedValue({
      runId: "run_1",
      status: "waiting_for_approval",
      output: "",
      error: null,
    });

    await getCareerOpsRunStatus(SESSION_A, "run-1");
    expect(mocks.db.recoverCareerOpsApprovalGate).toHaveBeenCalledWith("run-1", "user-a");
  });

  it("reports a forgotten run as gone only once Nexus has recorded it", async () => {
    // Hermes keeps run status for a bounded window; a definitive 404 means the
    // run no longer exists, and the local row is reconciled to terminal so the
    // conversation is not wedged by the one-active-run invariant.
    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, status: "running" });
    mocks.client.getRun.mockRejectedValue(new HermesError("not_found", "forgotten"));

    await expect(getCareerOpsRunStatus(SESSION_A, "run-1")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(mocks.db.updateCareerOpsRunStatus).toHaveBeenCalledWith("run-1", "user-a", "failed");
  });

  it("does not answer 404 for a forgotten run it could not reconcile", async () => {
    // The client treats a 404 as conclusive: it declares the run failed and
    // re-enables the composer. Answering one while the row is still active left
    // the next submission refused by the one-active-run invariant, with nothing
    // on screen to explain it. Report the outcome as unavailable instead, which
    // polling retries.
    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, status: "running" });
    mocks.client.getRun.mockRejectedValue(new HermesError("not_found", "forgotten"));
    mocks.db.updateCareerOpsRunStatus.mockRejectedValue(new Error("database unavailable"));

    await expect(getCareerOpsRunStatus(SESSION_A, "run-1")).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("does not try to recover a gate for a run that is not waiting", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, status: "running" });
    mocks.client.getRun.mockResolvedValue({
      runId: "run_1",
      status: "running",
      output: "",
      error: null,
    });

    await getCareerOpsRunStatus(SESSION_A, "run-1");
    expect(mocks.db.recoverCareerOpsApprovalGate).not.toHaveBeenCalled();
  });

  it("reopens the gate when Hermes refused the decision outright", async () => {
    // A rate limit is a stated refusal: the decision provably did nothing, so
    // the gate is still open upstream. Leaving it locally claimed stranded the
    // run — the client offers a retry, the retry finds no open gate and drops
    // the prompt, and Hermes waits forever with nobody able to answer.
    const challenge = await challengeFor("run-1", ["once"]);
    mocks.client.resolveApproval.mockRejectedValue(new HermesError("rate_limited", "slow down"));

    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).rejects.toBeTruthy();
    expect(mocks.db.releaseCareerOpsApprovalGate).toHaveBeenCalled();

    // And the retry can actually be answered rather than conflicting.
    mocks.client.resolveApproval.mockResolvedValue(undefined);
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).resolves.toBeUndefined();
  });

  it("keeps the gate closed when the outcome is unknown", async () => {
    // A transport failure does not say whether Hermes applied the decision.
    // Reopening then would let a second decision reach a gate the first may
    // already have answered.
    const challenge = await challengeFor("run-1", ["once"]);
    mocks.client.resolveApproval.mockRejectedValue(new HermesError("timeout", "gone quiet"));

    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "once", challenge),
    ).rejects.toBeTruthy();
    expect(mocks.db.releaseCareerOpsApprovalGate).not.toHaveBeenCalled();
  });

  it("refuses a decision for a run that is not at a gate", async () => {
    // A stale or direct decision for a run that is merely executing answers
    // nothing. It used to be recorded and forwarded anyway, and since this run
    // holds a single approval audit slot, the `not_applied` that came back
    // overwrote the record of the decision the user actually made.
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "deny")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
    expect(mocks.db.recordCareerOpsApprovalDecision).not.toHaveBeenCalled();
  });

  it("refuses a decision for a run that has already finished", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue({ ...RUN, status: "completed" });
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "deny")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
    expect(mocks.db.recordCareerOpsApprovalDecision).not.toHaveBeenCalled();
  });

  it("rejects every operation when the integration is disabled", async () => {
    disable();
    await expect(stopCareerOpsRun(SESSION_A, "run-1")).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(listCareerOpsThreads(SESSION_A)).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("resolveCareerOpsThreadApplication", () => {
  it("resolves the linked opportunity through the agent-visible read", async () => {
    mocks.db.getApplication.mockResolvedValue({ id: "42", company: "Acme", role: "Engineer" });
    const resolved = await resolveCareerOpsThreadApplication(SESSION_A, {
      ...THREAD,
      applicationId: "42",
    });
    expect(mocks.db.getApplication).toHaveBeenCalledWith("42", "user-a", {
      demoVisibility: "exclude",
    });
    expect(resolved).toEqual({ id: "42", company: "Acme", role: "Engineer" });
  });

  it("returns null when the link is gone or no longer agent-visible", async () => {
    mocks.db.getApplication.mockResolvedValue(null);
    expect(
      await resolveCareerOpsThreadApplication(SESSION_A, { ...THREAD, applicationId: "42" }),
    ).toBeNull();
  });

  it("returns null for a global thread without reading applications", async () => {
    expect(await resolveCareerOpsThreadApplication(SESSION_A, THREAD)).toBeNull();
    expect(mocks.db.getApplication).not.toHaveBeenCalled();
  });

  it("refuses when the integration is disabled", async () => {
    disable();
    await expect(
      resolveCareerOpsThreadApplication(SESSION_A, { ...THREAD, applicationId: "42" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
