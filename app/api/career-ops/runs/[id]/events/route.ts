import {
  careerOpsApprovalChallengeFor,
  openCareerOpsRunEvents,
  recordCareerOpsRunStatus,
} from "@/lib/career-ops/service";
import {
  SecretBoundaryRedactor,
  SseFrameParser,
  SseStreamTooLargeError,
  normalizeHermesEvent,
  serializeCareerOpsEvent,
} from "@/lib/career-ops/sse";
import type { CareerOpsRunStatus } from "@/lib/db/types";
import {
  careerOpsErrorResponse,
  requireCareerOpsSession,
  unauthorized,
} from "@/lib/career-ops/http";

type Context = { params: Promise<{ id: string }> };

/**
 * Retry a short, idempotent persistence step a few times before giving up.
 * Used for status writes on the live event path, where the update has no later
 * chance to land until the user reopens the conversation.
 */
async function persistWithRetry(write: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await write();
      return;
    } catch (reason) {
      if (attempt === 2) {
        // Propagate, do not swallow. The caller emits the terminal event only
        // once this resolves: reporting success after every write failed would
        // re-enable the composer while the stored run is still active, so the
        // next submission is refused by the one-active-run invariant — and this
        // client never polls, because it already saw the run finish.
        console.warn("career-ops: run status could not be persisted");
        throw reason;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}

const TERMINAL_STATUS: Record<string, CareerOpsRunStatus> = {
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

/**
 * Re-emit the Hermes run stream as a normalized Nexus stream.
 *
 * Raw upstream frames never reach the browser: each one is parsed, mapped onto
 * the closed Nexus event set, and re-serialized. Unknown, noisy and malformed
 * frames are dropped rather than forwarded.
 *
 * Note that the upstream stream is single-consumer — Hermes discards a run's
 * event queue when a subscriber disconnects — so a client that loses this
 * stream must recover the outcome from `GET /api/career-ops/runs/{id}`.
 */
export async function GET(request: Request, context: Context) {
  const session = await requireCareerOpsSession();
  if (!session) return unauthorized();

  const abort = new AbortController();
  // A listener added after the event never fires, and the browser can have
  // disconnected while the session was being resolved. Without this check the
  // handler would open and drain Hermes' single-consumer stream for a client
  // that is already gone, so a drawer opened afterwards could never see that
  // run's output or its approval prompts.
  if (request.signal.aborted) abort.abort();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  let upstream: ReadableStream<Uint8Array>;
  let runId: string;
  let idleTimeoutMs: number;
  let totalTimeoutMs: number;
  try {
    const { id } = await context.params;
    const opened = await openCareerOpsRunEvents(session, id, abort.signal);
    upstream = opened.upstream;
    runId = opened.run.id;
    idleTimeoutMs = opened.idleTimeoutMs;
    totalTimeoutMs = opened.totalTimeoutMs;
  } catch (reason) {
    abort.abort();
    return careerOpsErrorResponse(reason);
  }

  // A Hermes that accepts the request and then goes quiet without closing would
  // otherwise hold this connection open indefinitely. Bounding both the idle
  // gap and the total run lets the client fall back to status recovery.
  const deadline = Date.now() + totalTimeoutMs;
  const readWithTimeout = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<ReadableStreamReadResult<Uint8Array> | "timeout"> => {
    const budget = Math.min(idleTimeoutMs, Math.max(0, deadline - Date.now()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), budget);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const parser = new SseFrameParser();
  const deltaRedactor = new SecretBoundaryRedactor();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      const emit = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      // Flush a comment immediately so proxies commit the response and the
      // client can distinguish "connected" from "still waiting".
      emit(": open\n\n");

      const handle = async (payload: string) => {
        const event = normalizeHermesEvent(payload);
        if (!event) return;
        // Mint the challenge here, where the sanitized prompt is actually
        // disclosed, and bind it to what this stream is about to show. The
        // approval endpoint accepts nothing else, so a decision cannot be
        // submitted for an action the browser never received.
        if (event.type === "delta") {
          // Hold back a short tail so a secret split across two deltas is still
          // caught; the remainder is flushed when the stream ends.
          const safe = deltaRedactor.push(event.text);
          if (safe) emit(serializeCareerOpsEvent({ type: "delta", text: safe }));
          return;
        }

        let outgoing = event;
        if (event.type === "approval_required") {
          // The gate must be recorded *before* its controls reach the browser.
          // Emitting first lets a decision arrive while no gate is open, where
          // it is refused as a conflict: the client drops the prompt and Hermes
          // stays blocked with nobody able to answer it.
          const challenge = await careerOpsApprovalChallengeFor(session, runId, event).catch(
            () => null,
          );
          if (!challenge) {
            // The gate could not be opened at all — not merely without proof of
            // disclosure. Actionable controls here would all fail, so show none
            // and say so; Stop remains the way out.
            emit(
              serializeCareerOpsEvent({ type: "error", message: "approval_unavailable" }),
            );
            return;
          }
          outgoing = { ...event, challenge };
        }
        const terminal = TERMINAL_STATUS[event.type];
        if (terminal) {
          // Flush any held-back text before the run is declared finished.
          const tail = deltaRedactor.flush();
          if (tail) emit(serializeCareerOpsEvent({ type: "delta", text: tail }));
          // Persist before emitting. The terminal event re-enables the composer
          // in the browser, so a next submission arriving before the row settles
          // would be refused by the one-active-run invariant. Retrying matters
          // for the same reason: this is the status's only chance to land while
          // the stream is open.
          try {
            await persistWithRetry(() => recordCareerOpsRunStatus(session, runId, terminal));
          } catch {
            // The run finished but Nexus could not record it. Saying so sends
            // the client to status recovery, which settles from the ownership-
            // checked status endpoint and can retry the write — far better than
            // an unrecoverable terminal event over a row that stays active.
            emit(serializeCareerOpsEvent({ type: "error", message: "stream_interrupted" }));
            return;
          }
          emit(serializeCareerOpsEvent(outgoing));
          return;
        }
        emit(serializeCareerOpsEvent(outgoing));
        // The run status is recorded for display only. The gate itself lives in
        // its own column, written by `careerOpsApprovalChallengeFor` above, so
        // a failure here cannot leave a prompt no decision can answer — nor can
        // a later status write reopen a gate a decision has already claimed.
        if (event.type === "approval_required") {
          await recordCareerOpsRunStatus(session, runId, "waiting_for_approval").catch(
            () => undefined,
          );
        }
      };

      try {
        for (;;) {
          const result = await readWithTimeout(reader);
          if (result === "timeout") {
            emit(serializeCareerOpsEvent({ type: "error", message: "stream_timeout" }));
            break;
          }
          const { done, value } = result;
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          // Forward upstream keepalives so intermediaries do not time the
          // connection out during a long tool call.
          if (text.includes(": keepalive")) emit(": keepalive\n\n");
          for (const payload of parser.push(text)) await handle(payload);
        }
        for (const payload of parser.flush()) await handle(payload);
      } catch (reason) {
        // A stream that blew the size bounds is a broken or hostile upstream,
        // not a transport hiccup; say so distinctly so the client settles from
        // run status rather than retrying into the same flood.
        emit(
          serializeCareerOpsEvent({
            type: "error",
            message:
              reason instanceof SseStreamTooLargeError ? "stream_too_large" : "stream_interrupted",
          }),
        );
      } finally {
        reader.cancel().catch(() => undefined);
        abort.abort();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
