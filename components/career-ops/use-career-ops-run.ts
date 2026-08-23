"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CareerOpsRequestError,
  careerOpsJson,
  newClientRequestId,
  type ApprovalRequest,
  type CareerOpsStreamEvent,
  type RunPhase,
  type ToolActivity,
} from "./types";

type RunSnapshot = { status: string; output: string; error: string | null };

/** A delay that ends immediately when the caller is torn down. */
function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export type RunState = {
  phase: RunPhase;
  runId: string | null;
  answer: string;
  tools: ToolActivity[];
  approval: ApprovalRequest | null;
  errorCode: string | null;
};

const INITIAL: RunState = {
  phase: "idle",
  runId: null,
  answer: "",
  tools: [],
  approval: null,
  errorCode: null,
};

const TERMINAL_PHASES: RunPhase[] = ["completed", "failed", "cancelled"];

function parseFrames(buffer: string): { events: CareerOpsStreamEvent[]; rest: string } {
  const events: CareerOpsStreamEvent[] = [];
  let rest = buffer;
  let separator = rest.indexOf("\n\n");
  while (separator !== -1) {
    const frame = rest.slice(0, separator);
    rest = rest.slice(separator + 2);
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()) as CareerOpsStreamEvent);
      } catch {
        // A frame we cannot parse is dropped; the run continues.
      }
    }
    separator = rest.indexOf("\n\n");
  }
  return { events, rest };
}

/**
 * Drives one Career Ops turn.
 *
 * The Hermes run event stream is single-consumer upstream, so a dropped stream
 * cannot be resumed. When that happens the hook switches to `reconnecting` and
 * settles the run from its authenticated status endpoint instead of pretending
 * the connection is still live.
 */
const POLL_INTERVAL_MS = 1_500;
const FALLBACK_RUN_LIFETIME_MS = 10 * 60_000;

export function useCareerOpsRun(
  options: {
    onSettled?: (phase: RunPhase) => void;
    runTimeoutMs?: number;
    /**
     * Whether this Hermes build serves `GET /v1/runs/{id}/events`. Availability
     * does not require it — run status alone is enough to observe a run — so
     * when it is absent the drawer polls instead of opening a stream that is
     * certain to be refused. Undefined means the capability is not known yet
     * and the stream is attempted, which is also the pre-status default.
     */
    streaming?: boolean;
  } = {},
) {
  const [state, setState] = useState<RunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const onSettled = options.onSettled;
  // Recovery must outlast a legitimately long tool call. A fixed short budget
  // would report a still-running agent as failed and re-enable submission while
  // it kept working remotely, so the deadline follows the server's own limit.
  const runLifetimeMs = options.runTimeoutMs || FALLBACK_RUN_LIFETIME_MS;
  const streamingSupported = options.streaming !== false;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    startingRef.current = false;
    setState(INITIAL);
  }, []);

  const settle = useCallback(
    (phase: RunPhase, errorCode: string | null = null) => {
      setState((current) => ({ ...current, phase, errorCode, approval: null }));
      onSettled?.(phase);
    },
    [onSettled],
  );

  const applyEvent = useCallback((event: CareerOpsStreamEvent) => {
    setState((current) => {
      switch (event.type) {
        case "delta":
          return { ...current, phase: "streaming", answer: current.answer + event.text };
        case "tool_started":
          return {
            ...current,
            phase: "streaming",
            tools: [...current.tools, { tool: event.tool, state: "running" }],
          };
        case "tool_completed": {
          const tools = [...current.tools];
          const index = tools.findIndex(
            (item) => item.tool === event.tool && item.state === "running",
          );
          const next: ToolActivity = { tool: event.tool, state: event.failed ? "failed" : "done" };
          if (index === -1) tools.push(next);
          else tools[index] = next;
          return { ...current, tools };
        }
        case "approval_required":
          return {
            ...current,
            phase: "waiting_approval",
            approval: {
              operation: event.operation,
              summary: event.summary,
              details: event.details,
              choices: event.choices,
              challenge: event.challenge,
              truncated: event.truncated,
            },
          };
        case "approval_resolved":
          return { ...current, phase: "streaming", approval: null };
        case "completed":
          return {
            ...current,
            phase: "completed",
            approval: null,
            answer: event.output || current.answer,
          };
        case "failed":
          return { ...current, phase: "failed", approval: null, errorCode: "error_generic" };
        case "cancelled":
          return { ...current, phase: "cancelled", approval: null };
        case "error":
          // Dropping these left the drawer streaming forever while Hermes was
          // paused on an approval it could not present — `approval_unavailable`
          // arrives exactly when no prompt can be shown. Say so and move to
          // recovery; the caller settles from the status endpoint.
          return TERMINAL_PHASES.includes(current.phase)
            ? current
            : {
                ...current,
                phase: "reconnecting",
                approval: null,
                errorCode:
                  event.message === "approval_unavailable"
                    ? "error_approval_unavailable"
                    : "error_generic",
              };
        default:
          return current;
      }
    });
  }, []);

  /** Recover a run's outcome after the event stream ended without a terminal event. */
  const settleFromStatus = useCallback(
    async (runId: string, signal?: AbortSignal) => {
      setState((current) =>
        TERMINAL_PHASES.includes(current.phase) ? current : { ...current, phase: "reconnecting" },
      );
      const deadline = Date.now() + runLifetimeMs;
      while (Date.now() < deadline) {
        // Stop polling once the caller is gone. Without this a drawer that was
        // unmounted keeps polling for the whole run lifetime.
        if (signal?.aborted) return;
        let snapshot: RunSnapshot;
        try {
          snapshot = await careerOpsJson<RunSnapshot>(`/api/career-ops/runs/${runId}`, {
            // Abort the request itself, not merely the next loop iteration. A
            // stalled poll would otherwise outlive the drawer and the recovery
            // task that started it.
            signal,
          });
        } catch (reason) {
          // One failed poll says nothing about the run: it may still be
          // executing tools. Treating it as terminal would re-enable
          // submission and allow a concurrent run. Only a 404 is conclusive.
          if (reason instanceof CareerOpsRequestError && reason.status === 404) {
            settle("failed", "error_generic");
            return;
          }
          await sleepUnlessAborted(POLL_INTERVAL_MS, signal);
          continue;
        }
        if (snapshot.status === "completed") {
          setState((current) => ({
            ...current,
            phase: "completed",
            approval: null,
            answer: snapshot.output || current.answer,
          }));
          onSettled?.("completed");
          return;
        }
        if (snapshot.status === "failed") return settle("failed", "error_generic");
        if (snapshot.status === "cancelled") return settle("cancelled");
        if (snapshot.status === "waiting_for_approval") {
          // Run status carries no approval payload and the event stream is
          // gone, so the operation details cannot be recovered. Surface the
          // decision anyway — with the missing detail stated, not implied —
          // rather than polling a waiting run until it looks failed.
          setState((current) =>
            current.approval
              ? current
              : {
                  ...current,
                  phase: "waiting_approval",
                  approval: {
                    operation: "",
                    summary: "",
                    details: "",
                    // Only denial. The spec requires an approval prompt to
                    // show what is being approved; nothing here can, so
                    // offering "approve" would authorize an unknown
                    // privileged action.
                    choices: ["deny"],
                    detailsUnavailable: true,
                  },
                },
          );
        }
        await sleepUnlessAborted(POLL_INTERVAL_MS, signal);
      }
      // The deadline bounds how long *Nexus* watches, not how long Hermes may
      // execute. Declaring the run failed here removes Stop, invokes the
      // terminal cache handling and re-enables submission, while the agent may
      // still be working — and the next submission is then refused by the
      // one-active-run invariant. Stay uncertain instead, keeping Stop and
      // recovery available, and say why.
      setState((current) =>
        TERMINAL_PHASES.includes(current.phase)
          ? current
          : { ...current, phase: "reconnecting", errorCode: "error_status_unknown" },
      );
    },
    [onSettled, runLifetimeMs, settle],
  );

  const consume = useCallback(
    async (runId: string, signal: AbortSignal) => {
      // Polling-only deployment: no stream to consume, so do not open one. The
      // request would be refused upstream and the recovery below is where it
      // would land anyway -- this only skips a round trip that cannot succeed.
      if (!streamingSupported) {
        await settleFromStatus(runId, signal);
        return;
      }
      let response: Response;
      try {
        response = await fetch(`/api/career-ops/runs/${runId}/events`, {
          credentials: "same-origin",
          signal,
        });
      } catch {
        await settleFromStatus(runId, signal);
        return;
      }
      if (!response.ok || !response.body) {
        await settleFromStatus(runId, signal);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;
      // An `error` frame is this stream saying it will not deliver the outcome:
      // `approval_unavailable` means Hermes is blocked on a prompt the browser
      // never received, `stream_interrupted` that the terminal status did not
      // persist. Neither is answered by anything that could arrive later on the
      // same connection, so reading on only waits out the idle timeout while
      // the run sits unresolved. Leave, and settle from the ownership-checked
      // status endpoint — which is also the only place the denial-only prompt
      // that unblocks Hermes can come from.
      let interrupted = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseFrames(buffer);
          buffer = rest;
          for (const event of events) {
            applyEvent(event);
            if (event.type === "completed" || event.type === "failed" || event.type === "cancelled") {
              terminal = true;
            }
            if (event.type === "error") interrupted = true;
          }
          if (interrupted) break;
        }
      } catch {
        // Fall through to status recovery below.
      } finally {
        // Breaking out leaves the response body unconsumed, and an abandoned
        // reader holds the connection open. Cancelling after the stream already
        // ended is a no-op.
        await reader.cancel().catch(() => undefined);
      }

      if (terminal) {
        setState((current) => {
          if (TERMINAL_PHASES.includes(current.phase)) onSettled?.(current.phase);
          return current;
        });
        return;
      }
      if (signal.aborted) return;
      await settleFromStatus(runId, signal);
    },
    [applyEvent, onSettled, settleFromStatus, streamingSupported],
  );

  /**
   * Returns true only once Hermes has accepted the run, so the caller knows
   * whether the message it optimistically rendered actually went anywhere.
   */
  const start = useCallback(
    async (threadId: string, message: string, clientRequestId?: string): Promise<boolean> => {
      // A second submit while one is starting must never create a second run.
      if (startingRef.current) return false;
      startingRef.current = true;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...INITIAL, phase: "starting" });

      let runId: string;
      try {
        const created = await careerOpsJson<{ run: { id: string } }>(
          `/api/career-ops/threads/${threadId}/runs`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // The caller may supply the id so a retry after a lost response
            // reuses it — that is what makes the server's idempotent recovery
            // reachable instead of hitting an active-run conflict.
            body: JSON.stringify({ message, clientRequestId: clientRequestId ?? newClientRequestId() }),
          },
        );
        runId = created.run.id;
      } catch (reason) {
        startingRef.current = false;
        const code =
          reason instanceof CareerOpsRequestError ? reason.code : "error_generic";
        settle("failed", code);
        return false;
      }

      startingRef.current = false;
      setState((current) => ({ ...current, runId, phase: "streaming" }));
      await consume(runId, controller.signal);
      return true;
    },
    [consume, settle],
  );

  /**
   * Rejoin a run that was already in flight — after a reload, or after the user
   * navigated away and came back. The upstream event stream is single-consumer
   * and already gone, so recovery is status polling, not a re-subscribe.
   */
  const resume = useCallback(
    async (runId: string) => {
      abortRef.current?.abort();
      // Recovery polling is cancellable too, so leaving the page stops it.
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...INITIAL, runId, phase: "reconnecting" });
      await settleFromStatus(runId, controller.signal);
    },
    [settleFromStatus],
  );

  // Leaving the page must end the run's consumption. The Hermes event stream is
  // single-consumer, so a detached hook that keeps reading it holds the only
  // subscription: a drawer mounted later could then never see that run's
  // approval prompts, while the invisible instance consumed them.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const stop = useCallback(async () => {
    const runId = state.runId;
    if (!runId) return;
    try {
      await careerOpsJson(`/api/career-ops/runs/${runId}/stop`, { method: "POST" });
    } catch (reason) {
      // Only a run that has already finished may be ignored — the stream still
      // settles the UI for that one, and there is nothing left to stop.
      //
      // Every other failure has to surface. Swallowing a transport error, a
      // rate limit or an upstream 5xx leaves the drawer looking exactly as it
      // does on success, so the user walks away believing they stopped a
      // privileged agent that is in fact still running.
      if (reason instanceof CareerOpsRequestError && reason.status === 404) return;
      setState((current) => ({
        ...current,
        errorCode:
          reason instanceof CareerOpsRequestError ? reason.code : "error_stop_failed",
      }));
    }
  }, [state.runId]);

  const decideApproval = useCallback(
    async (choice: "once" | "deny") => {
      const runId = state.runId;
      if (!runId) return;
      const pending = state.approval;
      setState((current) => ({ ...current, approval: null, phase: "streaming" }));
      try {
        await careerOpsJson(`/api/career-ops/runs/${runId}/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The challenge is what makes an approval answer a specific prompt.
          body: JSON.stringify({ choice, challenge: pending?.challenge }),
        });
      } catch (reason) {
        const code = reason instanceof CareerOpsRequestError ? reason.code : "error_generic";
        // A decision that never reached Hermes leaves the run waiting. Dropping
        // the prompt would strand it with no way forward but a reload, so put
        // it back unless the run has since moved on.
        const stillPending = !(reason instanceof CareerOpsRequestError && reason.code === "conflict");
        setState((current) => ({
          ...current,
          errorCode: code,
          ...(stillPending && pending
            ? { approval: pending, phase: "waiting_approval" as const }
            : {}),
        }));
      }
    },
    [state.approval, state.runId],
  );

  return { state, start, resume, stop, decideApproval, reset };
}
