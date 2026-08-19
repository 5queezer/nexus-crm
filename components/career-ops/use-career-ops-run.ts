"use client";

import { useCallback, useRef, useState } from "react";
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
export function useCareerOpsRun(options: { onSettled?: (phase: RunPhase) => void } = {}) {
  const [state, setState] = useState<RunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const startingRef = useRef(false);
  const onSettled = options.onSettled;

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
        default:
          return current;
      }
    });
  }, []);

  /** Recover a run's outcome after the event stream ended without a terminal event. */
  const settleFromStatus = useCallback(
    async (runId: string) => {
      setState((current) =>
        TERMINAL_PHASES.includes(current.phase) ? current : { ...current, phase: "reconnecting" },
      );
      for (let attempt = 0; attempt < 20; attempt += 1) {
        let snapshot: RunSnapshot;
        try {
          snapshot = await careerOpsJson<RunSnapshot>(`/api/career-ops/runs/${runId}`);
        } catch {
          settle("failed", "error_generic");
          return;
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
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      settle("failed", "error_generic");
    },
    [onSettled, settle],
  );

  const consume = useCallback(
    async (runId: string, signal: AbortSignal) => {
      let response: Response;
      try {
        response = await fetch(`/api/career-ops/runs/${runId}/events`, {
          credentials: "same-origin",
          signal,
        });
      } catch {
        await settleFromStatus(runId);
        return;
      }
      if (!response.ok || !response.body) {
        await settleFromStatus(runId);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;
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
          }
        }
      } catch {
        // Fall through to status recovery below.
      }

      if (terminal) {
        setState((current) => {
          if (TERMINAL_PHASES.includes(current.phase)) onSettled?.(current.phase);
          return current;
        });
        return;
      }
      if (signal.aborted) return;
      await settleFromStatus(runId);
    },
    [applyEvent, onSettled, settleFromStatus],
  );

  const start = useCallback(
    async (threadId: string, message: string) => {
      // A second submit while one is starting must never create a second run.
      if (startingRef.current) return;
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
            body: JSON.stringify({ message, clientRequestId: newClientRequestId() }),
          },
        );
        runId = created.run.id;
      } catch (reason) {
        startingRef.current = false;
        const code =
          reason instanceof CareerOpsRequestError ? reason.code : "error_generic";
        settle("failed", code);
        return;
      }

      startingRef.current = false;
      setState((current) => ({ ...current, runId, phase: "streaming" }));
      await consume(runId, controller.signal);
    },
    [consume, settle],
  );

  const stop = useCallback(async () => {
    const runId = state.runId;
    if (!runId) return;
    try {
      await careerOpsJson(`/api/career-ops/runs/${runId}/stop`, { method: "POST" });
    } catch {
      // The run may already have finished; the stream still settles the UI.
    }
  }, [state.runId]);

  const decideApproval = useCallback(
    async (choice: "once" | "deny") => {
      const runId = state.runId;
      if (!runId) return;
      setState((current) => ({ ...current, approval: null, phase: "streaming" }));
      try {
        await careerOpsJson(`/api/career-ops/runs/${runId}/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choice }),
        });
      } catch (reason) {
        const code = reason instanceof CareerOpsRequestError ? reason.code : "error_generic";
        setState((current) => ({ ...current, errorCode: code }));
      }
    },
    [state.runId],
  );

  return { state, start, stop, decideApproval, reset };
}
