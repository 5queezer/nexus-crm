import { redactUpstreamError, type CareerOpsConfig } from "./config";
import type { CareerOpsApprovalChoice } from "./sse";

/**
 * Typed adapter over the Hermes API server.
 *
 * Every reachable upstream operation is declared here with a fixed method and
 * path template. Callers pass values, never paths, methods, or headers, so no
 * request originating in the browser can widen the upstream surface.
 */

export type HermesErrorKind =
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_error"
  | "unreachable"
  | "timeout";

export class HermesError extends Error {
  constructor(
    readonly kind: HermesErrorKind,
    message: string,
    /** Already redacted upstream text, safe to log. Never returned verbatim to a client. */
    readonly detail: string = "",
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "HermesError";
  }
}

export type HermesHealth = { healthy: boolean; version: string | null };

export type HermesCapabilities = {
  runs: boolean;
  runStatus: boolean;
  runEvents: boolean;
  stop: boolean;
  approvals: boolean;
  sessions: boolean;
};

export type HermesRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled";

export type HermesRun = {
  runId: string;
  status: HermesRunStatus;
  output: string;
  error: string | null;
};

export type HermesMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number | null;
};

/** Largest non-streaming response body accepted from Hermes. */
const MAX_RESPONSE_BODY_BYTES = 4 * 1024 * 1024;

/** Error bodies only ever feed a short redacted detail string. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * Read a response body up to a byte bound, then cancel.
 *
 * Buffering the whole body first (`response.json()` / `response.text()`) means
 * an upstream that returns an unbounded reply can exhaust this process before
 * any size check runs, so the bound has to be applied while reading.
 */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new HermesError("upstream_error", "Hermes returned an oversized response");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

const RUN_STATUSES: readonly HermesRunStatus[] = [
  "queued",
  "running",
  "waiting_for_approval",
  "stopping",
  "completed",
  "failed",
  "cancelled",
];

type EnabledConfig = Extract<CareerOpsConfig, { enabled: true }>;

function statusToKind(status: number): HermesErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "upstream_error";
}

function toHermesError(reason: unknown): HermesError {
  if (reason instanceof HermesError) return reason;
  const name = (reason as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") {
    return new HermesError("timeout", "Hermes request timed out");
  }
  return new HermesError("unreachable", "Hermes is unreachable", redactUpstreamError(reason));
}

export function createHermesClient(config: EnabledConfig) {
  function url(path: string): string {
    return `${config.baseUrl}${path}`;
  }

  function headers(extra?: Record<string, string>): Headers {
    const result = new Headers({
      Authorization: `Bearer ${config.secret}`,
      Accept: "application/json",
    });
    for (const [key, value] of Object.entries(extra ?? {})) result.set(key, value);
    return result;
  }

  async function failure(response: Response): Promise<HermesError> {
    let detail = "";
    try {
      // Read through the byte bound rather than buffering the whole body: an
      // error response is as attacker-controlled as a successful one.
      detail = redactUpstreamError((await readBounded(response, MAX_ERROR_BODY_BYTES)).slice(0, 1_000));
    } catch {
      detail = "";
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    return new HermesError(
      statusToKind(response.status),
      `Hermes responded ${response.status}`,
      detail,
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.trunc(retryAfter) : null,
    );
  }

  async function request(
    path: string,
    init: { method: "GET" | "POST" | "DELETE"; body?: unknown; memoryScope?: string },
    timeoutMs = config.connectTimeoutMs,
  ): Promise<Response> {
    const extra: Record<string, string> = {};
    if (init.body !== undefined) extra["Content-Type"] = "application/json";
    if (init.memoryScope) extra["X-Hermes-Session-Key"] = init.memoryScope;
    try {
      return await fetch(url(path), {
        method: init.method,
        headers: headers(extra),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
        redirect: "error",
      });
    } catch (reason) {
      throw toHermesError(reason);
    }
  }

  async function json(response: Response): Promise<Record<string, unknown>> {
    if (!response.ok) throw await failure(response);
    let parsed: unknown;
    try {
      // `response.json()` would pull an unbounded body into memory, so a broken
      // or compromised Hermes could exhaust the Nexus process with one reply.
      parsed = JSON.parse(await readBounded(response, MAX_RESPONSE_BODY_BYTES));
    } catch (reason) {
      if (reason instanceof HermesError) throw reason;
      throw new HermesError("upstream_error", "Hermes returned a malformed response");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HermesError("upstream_error", "Hermes returned a malformed response");
    }
    return parsed as Record<string, unknown>;
  }

  function text(value: unknown, maximum: number): string {
    return typeof value === "string" ? value.slice(0, maximum) : "";
  }

  async function fetchRun(runId: string): Promise<HermesRun> {
    const body = await json(
      await request(`/v1/runs/${encodeURIComponent(runId)}`, { method: "GET" }),
    );
    const raw = text(body.status, 64) as HermesRunStatus;
    if (!RUN_STATUSES.includes(raw)) {
      // Mapping an unrecognized status to `failed` would be a guess with
      // consequences: the caller persists it, which settles the run, frees
      // the conversation's single active-run slot, and lets a second
      // privileged run start while the first may still be executing. An
      // unknown status is an upstream problem, not a finished run.
      throw new HermesError("upstream_error", "Hermes reported an unrecognized run status");
    }
    return {
      runId: text(body.run_id, 256) || runId,
      status: raw,
      output: text(body.output, 200_000),
      error: body.error === undefined || body.error === null
        ? null
        : redactUpstreamError(text(body.error, 400)),
    };
  }

  return {
    async health(): Promise<HermesHealth> {
      const body = await json(await request("/health", { method: "GET" }));
      return {
        healthy: body.status === "ok",
        version: typeof body.version === "string" ? body.version : null,
      };
    },

    async capabilities(): Promise<HermesCapabilities> {
      const body = await json(await request("/v1/capabilities", { method: "GET" }));
      const features =
        body.features && typeof body.features === "object" && !Array.isArray(body.features)
          ? (body.features as Record<string, unknown>)
          : {};
      const supports = (name: string) => features[name] === true;
      return {
        runs: supports("run_submission"),
        runStatus: supports("run_status"),
        runEvents: supports("run_events_sse"),
        stop: supports("run_stop"),
        approvals: supports("run_approval_response"),
        sessions: supports("session_resources"),
      };
    },

    async createSession(input: { title?: string; memoryScope?: string }): Promise<{ id: string }> {
      const body = await json(
        await request("/api/sessions", {
          method: "POST",
          body: {
            source: "api_server",
            ...(input.title ? { title: input.title } : {}),
          },
          memoryScope: input.memoryScope,
        }),
      );
      const session = body.session;
      const id =
        session && typeof session === "object" && !Array.isArray(session)
          ? text((session as Record<string, unknown>).id, 256)
          : "";
      if (!id) throw new HermesError("upstream_error", "Hermes did not return a session id");
      return { id };
    },

    async deleteSession(sessionId: string): Promise<void> {
      const response = await request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      // An already-absent session is the outcome the caller wanted.
      if (response.status === 404) return;
      await json(response);
    },

    async listSessionMessages(sessionId: string): Promise<HermesMessage[]> {
      const body = await json(
        // Ask for the newest page: a session with more than one page of history
        // would otherwise show only its oldest turns and hide the entire recent
        // conversation. Re-sorted to chronological order below.
        await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages?order=latest&limit=200`, {
          method: "GET",
        }),
      );
      const data = Array.isArray(body.data) ? body.data : [];
      const messages: HermesMessage[] = [];
      for (const entry of data) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const record = entry as Record<string, unknown>;
        const role = record.role;
        if (role !== "user" && role !== "assistant") continue;
        const content = text(record.content, 200_000);
        if (!content) continue;
        messages.push({
          id: String(record.id ?? messages.length),
          role,
          content,
          createdAt: typeof record.timestamp === "number" ? record.timestamp : null,
        });
      }
      // `order=latest` may arrive newest-first; present them oldest-first.
      const timestamped = messages.filter((message) => message.createdAt !== null);
      if (
        timestamped.length > 1 &&
        timestamped[0].createdAt! > timestamped[timestamped.length - 1].createdAt!
      ) {
        messages.reverse();
      }
      return messages;
    },

    async createRun(input: {
      input: string;
      sessionId: string;
      instructions?: string;
      memoryScope?: string;
    }): Promise<{ runId: string }> {
      const body = await json(
        await request(
          "/v1/runs",
          {
            method: "POST",
            body: {
              input: input.input,
              session_id: input.sessionId,
              ...(input.instructions ? { instructions: input.instructions } : {}),
            },
            memoryScope: input.memoryScope,
          },
          config.connectTimeoutMs,
        ),
      );
      const runId = text(body.run_id, 256);
      if (!runId) throw new HermesError("upstream_error", "Hermes did not return a run id");
      return { runId };
    },

    getRun: fetchRun,


    async openRunEvents(runId: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
      let response: Response;
      // The route's idle and total timers only start once this resolves, so
      // without a bound here a Hermes that accepts the connection and never
      // sends response headers would hold the Nexus request open for as long
      // as the browser stayed connected.
      const connect = AbortSignal.timeout(config.connectTimeoutMs);
      const combined = AbortSignal.any([signal, connect]);
      try {
        response = await fetch(url(`/v1/runs/${encodeURIComponent(runId)}/events`), {
          method: "GET",
          headers: headers({ Accept: "text/event-stream" }),
          signal: combined,
          cache: "no-store",
          redirect: "error",
        });
      } catch (reason) {
        throw toHermesError(reason);
      }
      if (!response.ok) throw await failure(response);
      if (!response.body) {
        throw new HermesError("upstream_error", "Hermes returned an empty event stream");
      }
      return response.body;
    },

    async stopRun(runId: string): Promise<void> {
      const response = await request(`/v1/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
        body: {},
      });
      if (response.status === 404) {
        // A 404 has two meanings here: the run is gone, or Hermes no longer
        // serves the stop endpoint at all. Assuming the first would report a
        // still-executing privileged run as stopped, so ask whether the run
        // still exists before deciding.
        let stillExists = false;
        try {
          await fetchRun(runId);
          stillExists = true;
        } catch (reason) {
          if (!(reason instanceof HermesError) || reason.kind !== "not_found") {
            // Could not tell; do not claim the run was stopped.
            throw new HermesError("upstream_error", "Hermes did not accept the stop request");
          }
        }
        if (stillExists) {
          throw new HermesError(
            "upstream_error",
            "Hermes does not support stopping this run",
          );
        }
        // The run really is gone, which is the caller's desired end state.
        return;
      }
      await json(response);
    },

    async resolveApproval(runId: string, choice: CareerOpsApprovalChoice): Promise<void> {
      await json(
        await request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
          method: "POST",
          body: { choice },
        }),
      );
    },
  };
}

export type HermesClient = ReturnType<typeof createHermesClient>;
