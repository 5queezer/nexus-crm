import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    listCareerOpsThreads: vi.fn(),
    getCareerOpsThread: vi.fn(),
    createCareerOpsThread: vi.fn(),
    renameCareerOpsThread: vi.fn(),
    deleteCareerOpsThread: vi.fn(),
    getCareerOpsRun: vi.fn(),
    createCareerOpsRun: vi.fn(),
    updateCareerOpsRunStatus: vi.fn(),
    getLatestCareerOpsRun: vi.fn(),
    recordCareerOpsApprovalDecision: vi.fn(),
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
  getCareerOpsStatus,
  listCareerOpsThreadMessages,
  listCareerOpsThreads,
  requireOwnedRun,
  requireOwnedThread,
  resetCareerOpsCapabilityCacheForTests,
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
  mocks.client.resolveApproval.mockResolvedValue(undefined);
  mocks.client.deleteSession.mockResolvedValue(undefined);
  mocks.db.deleteCareerOpsRun.mockResolvedValue(undefined);
  mocks.db.updateCareerOpsRunStatus.mockResolvedValue(undefined);
  mocks.db.getCareerOpsThread.mockResolvedValue(null);
  mocks.db.getCareerOpsRun.mockResolvedValue(null);
  mocks.db.getLatestCareerOpsRun.mockResolvedValue(null);
  mocks.db.recordCareerOpsApprovalDecision.mockResolvedValue(undefined);
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

    // Deleting a Hermes session does not stop its runs.
    expect(mocks.client.stopRun).toHaveBeenCalledWith("run_live");
    expect(mocks.db.deleteCareerOpsThread).toHaveBeenCalledWith("thread-1", "user-a");
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
    mocks.client.createRun.mockResolvedValue({ runId: "run_1" });
    mocks.db.createCareerOpsRun.mockResolvedValue({ created: true, run: { ...RESERVATION } });
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

  it("claims the client request id before starting anything upstream", async () => {
    const order: string[] = [];
    mocks.db.createCareerOpsRun.mockImplementation(async () => {
      order.push("reserve");
      return {
        created: true,
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
    mocks.db.createCareerOpsRun.mockResolvedValue({
      created: false,
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
    mocks.db.createCareerOpsRun.mockResolvedValue({
      created: true,
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
    // retry would keep returning the unbound reservation.
    expect(mocks.client.stopRun).toHaveBeenCalledWith("run_1");
    expect(mocks.db.deleteCareerOpsRun).toHaveBeenCalledWith("run-1", "user-a");
  });

  it("stops the upstream run when its reservation disappeared", async () => {
    mocks.db.createCareerOpsRun.mockResolvedValue({
      created: true,
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
    mocks.db.createCareerOpsRun.mockResolvedValue({
      created: true,
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
    mocks.db.createCareerOpsRun.mockResolvedValue({
      created: true,
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
    expect(mocks.db.createCareerOpsRun).not.toHaveBeenCalled();
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

  it("falls back to global instructions when the linked application is not agent-visible", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue({ ...THREAD, applicationId: "42" });
    mocks.db.getApplication.mockResolvedValue(null);

    await startCareerOpsRun(SESSION_A, "thread-1", {
      message: "hello",
      clientRequestId: "client-id-1",
    });

    const [args] = mocks.client.createRun.mock.calls[0];
    expect(args.instructions).not.toContain("application id 42");
  });

  it("refuses a second concurrent run on the same thread", async () => {
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
    expect(mocks.db.createCareerOpsRun).not.toHaveBeenCalled();
  });

  it("refuses to start a run on a foreign thread", async () => {
    mocks.db.getCareerOpsThread.mockResolvedValue(null);
    await expect(
      startCareerOpsRun(SESSION_A, "thread-9", { message: "hi", clientRequestId: "client-id-1" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.client.createRun).not.toHaveBeenCalled();
  });
});

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

  beforeEach(() => {
    mocks.db.getCareerOpsRun.mockResolvedValue(RUN);
    mocks.db.getCareerOpsThread.mockResolvedValue(THREAD);
  });

  it("stops an owned run", async () => {
    await expect(stopCareerOpsRun(SESSION_A, "run-1")).resolves.toBeUndefined();
    expect(mocks.client.stopRun).toHaveBeenCalledWith("run_1");
  });

  it("refuses to stop a foreign run", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue(null);
    await expect(stopCareerOpsRun(SESSION_A, "run-1")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(mocks.client.stopRun).not.toHaveBeenCalled();
  });

  it("forwards an approval decision for an owned run", async () => {
    await resolveCareerOpsApproval(SESSION_A, "run-1", "deny");
    expect(mocks.client.resolveApproval).toHaveBeenCalledWith("run_1", "deny");
  });

  it("records the decision for attribution after forwarding it", async () => {
    await resolveCareerOpsApproval(SESSION_A, "run-1", "deny");
    expect(mocks.db.recordCareerOpsApprovalDecision).toHaveBeenCalledWith(
      "run-1",
      "user-a",
      "deny",
    );
  });

  it("records nothing when the decision was not forwarded", async () => {
    mocks.client.resolveApproval.mockRejectedValue(new HermesError("conflict", "not pending"));
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "once")).rejects.toBeTruthy();
    expect(mocks.db.recordCareerOpsApprovalDecision).not.toHaveBeenCalled();
  });

  it("rejects an unsupported approval decision", async () => {
    await expect(
      resolveCareerOpsApproval(SESSION_A, "run-1", "maybe" as never),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("refuses an approval decision for a foreign run", async () => {
    mocks.db.getCareerOpsRun.mockResolvedValue(null);
    await expect(resolveCareerOpsApproval(SESSION_A, "run-1", "once")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(mocks.client.resolveApproval).not.toHaveBeenCalled();
  });

  it("surfaces an upstream conflict as a conflict, without upstream text", async () => {
    mocks.client.resolveApproval.mockRejectedValue(
      new HermesError("conflict", "no pending approval", `Bearer ${SECRET}`),
    );
    const error = await resolveCareerOpsApproval(SESSION_A, "run-1", "once").catch((r) => r);
    expect(error).toBeInstanceOf(CareerOpsServiceError);
    expect(error.code).toBe("conflict");
    expect(JSON.stringify({ message: error.message })).not.toContain(SECRET);
  });

  it("rejects every operation when the integration is disabled", async () => {
    disable();
    await expect(stopCareerOpsRun(SESSION_A, "run-1")).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(listCareerOpsThreads(SESSION_A)).rejects.toMatchObject({ code: "unavailable" });
  });
});
