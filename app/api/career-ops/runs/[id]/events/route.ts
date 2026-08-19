import { openCareerOpsRunEvents, recordCareerOpsRunStatus } from "@/lib/career-ops/service";
import { SseFrameParser, normalizeHermesEvent, serializeCareerOpsEvent } from "@/lib/career-ops/sse";
import type { CareerOpsRunStatus } from "@/lib/db/types";
import {
  careerOpsErrorResponse,
  requireCareerOpsSession,
  unauthorized,
} from "@/lib/career-ops/http";

type Context = { params: Promise<{ id: string }> };

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
        emit(serializeCareerOpsEvent(event));
        const terminal = TERMINAL_STATUS[event.type];
        if (terminal) {
          await recordCareerOpsRunStatus(session, runId, terminal).catch(() => undefined);
        } else if (event.type === "approval_required") {
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
      } catch {
        emit(serializeCareerOpsEvent({ type: "error", message: "stream_interrupted" }));
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
