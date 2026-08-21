import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCareerOpsConfig, type CareerOpsConfig } from "../config";
import { HermesError, createHermesClient } from "../hermes-client";

const SECRET = "hermes-secret-key-0123456789";

let originalFetch: typeof globalThis.fetch;

function enabledConfig(): Extract<CareerOpsConfig, { enabled: true }> {
  process.env.HERMES_CAREER_OPS_ENABLED = "true";
  process.env.HERMES_CAREER_OPS_BASE_URL = "http://127.0.0.1:8642/p/career-ops";
  process.env.HERMES_CAREER_OPS_API_KEY = SECRET;
  process.env.HERMES_CAREER_OPS_OWNER_USER_ID = "user-a";
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
  delete process.env.HERMES_CAREER_OPS_OWNER_USER_ID;
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

  it("requests the newest page and presents it chronologically", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        object: "list",
        data: [
          { id: 9, role: "assistant", content: "newest", timestamp: 9000 },
          { id: 8, role: "user", content: "older", timestamp: 8000 },
        ],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const messages = await createHermesClient(enabledConfig()).listSessionMessages("sess-9");

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    // A long transcript must not show only its oldest page.
    expect(url).toContain("order=latest");
    expect(messages.map((message) => message.content)).toEqual(["older", "newest"]);
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

  it("refuses an unrecognized upstream run status instead of calling it failed", async () => {
    // Guessing `failed` would settle the run, free the conversation's single
    // active-run slot, and let a second privileged run start beside one that
    // may still be executing.
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ run_id: "run_7", status: "who_knows" }),
    ) as unknown as typeof fetch;
    await expect(createHermesClient(enabledConfig()).getRun("run_7")).rejects.toMatchObject({
      kind: "upstream_error",
    });
  });

  it("redacts the upstream error text on a failed run", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ run_id: "run_7", status: "failed", error: `Bearer ${SECRET} rejected` }),
    ) as unknown as typeof fetch;
    const run = await createHermesClient(enabledConfig()).getRun("run_7");
    expect(run.error).not.toContain(SECRET);
  });

  it("redacts a status field before bounding it, not after", async () => {
    // Slicing first severs a secret that begins near the bound, after which
    // exact matching no longer recognizes it and the surviving prefix is
    // emitted. Each field puts 20 characters of the key inside its limit.
    const surviving = SECRET.slice(0, 20);
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        run_id: "run_7",
        status: "failed",
        output: `${"o".repeat(200_000 - 20)}${SECRET}`,
        error: `${"e".repeat(300 - 20)}${SECRET}`,
      }),
    ) as unknown as typeof fetch;

    const run = await createHermesClient(enabledConfig()).getRun("run_7");
    expect(run.output).not.toContain(surviving);
    expect(run.error ?? "").not.toContain(surviving);
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

describe("upstream response size bounds", () => {
  /** A body that keeps producing chunks, the way a hostile upstream would. */
  function endlessResponse() {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (cancelled) return;
        controller.enqueue(new TextEncoder().encode("x".repeat(64 * 1024)));
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("refuses an unbounded success body instead of buffering it", async () => {
    const config = enabledConfig();
    globalThis.fetch = vi.fn(async () => endlessResponse()) as unknown as typeof fetch;

    await expect(createHermesClient(config).health()).rejects.toMatchObject({
      kind: "upstream_error",
    });
  });

  it("refuses an unbounded error body too", async () => {
    const config = enabledConfig();
    globalThis.fetch = vi.fn(async () => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (cancelled) return;
          controller.enqueue(new TextEncoder().encode("x".repeat(64 * 1024)));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 500 });
    }) as unknown as typeof fetch;

    // The failure path must still produce a controlled error rather than
    // reading forever to build a detail string.
    await expect(createHermesClient(config).health()).rejects.toBeInstanceOf(HermesError);
  });
});

describe("stopping a run", () => {
  it("does not report success when the stop endpoint itself is gone", async () => {
    // A 404 from /stop means either the run is gone or Hermes withdrew the
    // endpoint. If the run still exists it is the latter, and claiming the run
    // was stopped would hide a live privileged agent.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target.endsWith("/stop")) return new Response("not found", { status: 404 });
      return jsonResponse({ run_id: "run_7", status: "running" });
    }) as unknown as typeof fetch;

    await expect(createHermesClient(enabledConfig()).stopRun("run_7")).rejects.toMatchObject({
      kind: "upstream_error",
    });
  });

  it("treats a stop for a genuinely absent run as the desired end state", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(createHermesClient(enabledConfig()).stopRun("run_7")).resolves.toBeUndefined();
  });
});

describe("stored transcript redaction", () => {
  it("strips the key from messages replayed out of a session", async () => {
    // The transcript is re-served on every reload, so it needs the same
    // stripping as the live stream rather than less.
    const config = enabledConfig();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: "m1", role: "assistant", content: `here: ${SECRET}`, timestamp: 1 },
        ],
      }),
    ) as unknown as typeof fetch;

    const messages = await createHermesClient(config).listSessionMessages("sess-1");
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages)).not.toContain(SECRET);
  });

  it("redacts stored transcript content before bounding it", async () => {
    // The transcript is re-served on every reload, so a prefix left behind by
    // an early slice would persist in the conversation indefinitely.
    const config = enabledConfig();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: "m1",
            role: "assistant",
            content: `${"c".repeat(200_000 - 20)}${SECRET}`,
            timestamp: 1,
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const messages = await createHermesClient(config).listSessionMessages("sess-1");
    expect(messages[0]?.content).not.toContain(SECRET.slice(0, 20));
  });
});

describe("event stream connection bound", () => {
  it("does not abort a stream that outlives the connect timeout", async () => {
    // The connect bound must cover waiting for headers only. Leaving it
    // attached to the body kills every run longer than the timeout — which is
    // most of them — and the stream is single-consumer, so it cannot be
    // reopened.
    process.env.HERMES_CAREER_OPS_CONNECT_TIMEOUT_MS = "1000";
    const config = enabledConfig();

    let push!: (chunk: string) => void;
    // Model what fetch actually does: the signal it is given also governs the
    // response body, so an abort after headers destroys the stream.
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          push = (chunk) => {
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch {
              // already destroyed
            }
          };
          signal?.addEventListener("abort", () => {
            try {
              controller.error(new Error("aborted"));
            } catch {
              // already closed
            }
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const caller = new AbortController();
    const stream = await createHermesClient(config).openRunEvents("run_1", caller.signal);
    const reader = stream.getReader();

    // Well past the connect timeout, the stream must still deliver.
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    push('data: {"event":"message.delta","delta":"still here"}\n\n');
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain("still here");

    delete process.env.HERMES_CAREER_OPS_CONNECT_TIMEOUT_MS;
  });

  it("still gives up when headers never arrive", async () => {
    process.env.HERMES_CAREER_OPS_CONNECT_TIMEOUT_MS = "1000";
    const config = enabledConfig();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;

    const caller = new AbortController();
    await expect(
      createHermesClient(config).openRunEvents("run_1", caller.signal),
    ).rejects.toBeInstanceOf(HermesError);

    delete process.env.HERMES_CAREER_OPS_CONNECT_TIMEOUT_MS;
  });
});
