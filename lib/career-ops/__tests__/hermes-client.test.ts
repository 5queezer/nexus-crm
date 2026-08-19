import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCareerOpsConfig, type CareerOpsConfig } from "../config";
import { HermesError, createHermesClient } from "../hermes-client";

const SECRET = "hermes-secret-key-0123456789";

let originalFetch: typeof globalThis.fetch;

function enabledConfig(): Extract<CareerOpsConfig, { enabled: true }> {
  process.env.HERMES_CAREER_OPS_ENABLED = "true";
  process.env.HERMES_CAREER_OPS_BASE_URL = "http://127.0.0.1:8642/p/career-ops";
  process.env.HERMES_CAREER_OPS_API_KEY = SECRET;
  const config = readCareerOpsConfig();
  if (!config.enabled) throw new Error("expected enabled config");
  return config;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.HERMES_CAREER_OPS_ENABLED;
  delete process.env.HERMES_CAREER_OPS_BASE_URL;
  delete process.env.HERMES_CAREER_OPS_API_KEY;
  vi.restoreAllMocks();
});

describe("hermes client transport", () => {
  it("attaches the bearer token server-side and targets the configured profile path", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: "ok" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createHermesClient(enabledConfig()).health();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8642/p/career-ops/health");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("sends the memory scope header when provided", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ run_id: "run_1", status: "started" }, 202));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createHermesClient(enabledConfig()).createRun({
      input: "hello",
      sessionId: "sess-1",
      memoryScope: "agent:career-ops:nexus:dm:abc",
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("x-hermes-session-key")).toBe(
      "agent:career-ops:nexus:dm:abc",
    );
  });

  it("never includes the secret in a thrown upstream error", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(`denied for Bearer ${SECRET}`, { status: 500 }),
    ) as unknown as typeof fetch;

    const error = await createHermesClient(enabledConfig())
      .capabilities()
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(HermesError);
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(SECRET);
  });

  it("maps upstream status codes to typed errors", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [403, "unauthorized"],
      [404, "not_found"],
      [409, "conflict"],
      [429, "rate_limited"],
      [500, "upstream_error"],
      [503, "upstream_error"],
    ];
    for (const [status, kind] of cases) {
      globalThis.fetch = vi.fn(async () => jsonResponse({ error: { message: "no" } }, status)) as
        unknown as typeof fetch;
      const error = await createHermesClient(enabledConfig())
        .getRun("run_1")
        .catch((reason) => reason);
      expect(error, String(status)).toBeInstanceOf(HermesError);
      expect(error.kind, String(status)).toBe(kind);
    }
  });

  it("maps a network failure and an abort to typed errors", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const networkError = await createHermesClient(enabledConfig())
      .health()
      .catch((reason) => reason);
    expect(networkError.kind).toBe("unreachable");

    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    const abortError = await createHermesClient(enabledConfig())
      .health()
      .catch((reason) => reason);
    expect(abortError.kind).toBe("timeout");
  });

  it("rejects a non-JSON success body rather than guessing", async () => {
    globalThis.fetch = vi.fn(async () => new Response("<html>nope</html>", { status: 200 })) as
      unknown as typeof fetch;
    const error = await createHermesClient(enabledConfig())
      .capabilities()
      .catch((reason) => reason);
    expect(error.kind).toBe("upstream_error");
  });
});

describe("health and capability detection", () => {
  it("reports healthy for an ok status", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ status: "ok", version: "1.2.3" })) as
      unknown as typeof fetch;
    await expect(createHermesClient(enabledConfig()).health()).resolves.toEqual({
      healthy: true,
      version: "1.2.3",
    });
  });

  it("reports degraded for a non-ok status payload", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ status: "degraded" })) as
      unknown as typeof fetch;
    await expect(createHermesClient(enabledConfig()).health()).resolves.toEqual({
      healthy: false,
      version: null,
    });
  });

  it("derives capability flags from the advertised features", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        object: "hermes.api_server.capabilities",
        features: {
          run_submission: true,
          run_status: true,
          run_events_sse: true,
          run_stop: true,
          run_approval_response: false,
          session_resources: true,
        },
      }),
    ) as unknown as typeof fetch;

    await expect(createHermesClient(enabledConfig()).capabilities()).resolves.toEqual({
      runs: true,
      runStatus: true,
      runEvents: true,
      stop: true,
      approvals: false,
      sessions: true,
    });
  });

  it("treats missing feature flags as unsupported", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ object: "x" })) as unknown as typeof fetch;
    await expect(createHermesClient(enabledConfig()).capabilities()).resolves.toEqual({
      runs: false,
      runStatus: false,
      runEvents: false,
      stop: false,
      approvals: false,
      sessions: false,
    });
  });
});

describe("session operations", () => {
  it("creates a session and returns its identifier", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ object: "hermes.session", session: { id: "sess-9", title: "Career Ops" } }, 201),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      createHermesClient(enabledConfig()).createSession({ title: "Career Ops" }),
    ).resolves.toEqual({ id: "sess-9" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8642/p/career-ops/api/sessions");
    expect(init.method).toBe("POST");
  });

  it("rejects a session create response without an identifier", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ session: {} }, 201)) as
      unknown as typeof fetch;
    await expect(createHermesClient(enabledConfig()).createSession({})).rejects.toBeInstanceOf(
      HermesError,
    );
  });

  it("lists session messages and drops non-conversational roles", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        object: "list",
        data: [
          { id: 1, role: "user", content: "hi", timestamp: 1000 },
          { id: 2, role: "assistant", content: "hello", timestamp: 1001 },
          { id: 3, role: "tool", content: "{...}", timestamp: 1002 },
          { id: 4, role: "system", content: "prompt", timestamp: 1003 },
        ],
      }),
    ) as unknown as typeof fetch;

    await expect(
      createHermesClient(enabledConfig()).listSessionMessages("sess-9"),
    ).resolves.toEqual([
      { id: "1", role: "user", content: "hi", createdAt: 1000 },
      { id: "2", role: "assistant", content: "hello", createdAt: 1001 },
    ]);
  });

  it("percent-encodes the session identifier in the path", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ object: "list", data: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await createHermesClient(enabledConfig()).listSessionMessages("a b/c");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/api/sessions/a%20b%2Fc/messages");
  });

  it("treats a missing session as a successful delete", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: { message: "gone" } }, 404)) as
      unknown as typeof fetch;
    await expect(
      createHermesClient(enabledConfig()).deleteSession("sess-9"),
    ).resolves.toBeUndefined();
  });
});

describe("run operations", () => {
  it("creates a run and returns the run identifier", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ run_id: "run_7", status: "started" }, 202));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      createHermesClient(enabledConfig()).createRun({
        input: "hello",
        sessionId: "sess-9",
        instructions: "context",
      }),
    ).resolves.toEqual({ runId: "run_7" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8642/p/career-ops/v1/runs");
    expect(JSON.parse(String(init.body))).toEqual({
      input: "hello",
      session_id: "sess-9",
      instructions: "context",
    });
  });

  it("rejects a run create response without a run identifier", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ status: "started" }, 202)) as
      unknown as typeof fetch;
    await expect(
      createHermesClient(enabledConfig()).createRun({ input: "hi", sessionId: "s" }),
    ).rejects.toBeInstanceOf(HermesError);
  });

  it("normalizes run status", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        object: "hermes.run",
        run_id: "run_7",
        status: "waiting_for_approval",
        output: "partial",
      }),
    ) as unknown as typeof fetch;

    await expect(createHermesClient(enabledConfig()).getRun("run_7")).resolves.toEqual({
      runId: "run_7",
      status: "waiting_for_approval",
      output: "partial",
      error: null,
    });
  });

  it("maps an unrecognized upstream run status to failed", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ run_id: "run_7", status: "who_knows" }),
    ) as unknown as typeof fetch;
    const run = await createHermesClient(enabledConfig()).getRun("run_7");
    expect(run.status).toBe("failed");
  });

  it("redacts the upstream error text on a failed run", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ run_id: "run_7", status: "failed", error: `Bearer ${SECRET} rejected` }),
    ) as unknown as typeof fetch;
    const run = await createHermesClient(enabledConfig()).getRun("run_7");
    expect(run.error).not.toContain(SECRET);
  });

  it("stops a run", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ run_id: "run_7", status: "stopping" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(createHermesClient(enabledConfig()).stopRun("run_7")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8642/p/career-ops/v1/runs/run_7/stop");
    expect(init.method).toBe("POST");
  });

  it("treats stopping an already finished run as success", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: { message: "gone" } }, 404)) as
      unknown as typeof fetch;
    await expect(createHermesClient(enabledConfig()).stopRun("run_7")).resolves.toBeUndefined();
  });

  it("submits an approval decision using the upstream choice vocabulary", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ object: "hermes.run.approval_response", choice: "once", resolved: 1 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createHermesClient(enabledConfig()).resolveApproval("run_7", "deny");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8642/p/career-ops/v1/runs/run_7/approval");
    expect(JSON.parse(String(init.body))).toEqual({ choice: "deny" });
  });

  it("surfaces a not-pending approval as a conflict", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: { message: "no pending approval", code: "approval_not_pending" } }, 409),
    ) as unknown as typeof fetch;
    const error = await createHermesClient(enabledConfig())
      .resolveApproval("run_7", "once")
      .catch((reason) => reason);
    expect(error.kind).toBe("conflict");
  });

  it("opens the run event stream and yields the response body", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"event":"run.completed"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () =>
      new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stream = await createHermesClient(enabledConfig()).openRunEvents("run_7", new AbortController().signal);
    expect(stream).toBeInstanceOf(ReadableStream);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("http://127.0.0.1:8642/p/career-ops/v1/runs/run_7/events");
  });
});
