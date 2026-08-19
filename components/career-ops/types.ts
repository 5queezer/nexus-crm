/** Client-side view of the Career Ops BFF. Mirrors lib/career-ops/serialize.ts. */

export type CareerOpsStatus = {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  capabilities: { stop: boolean; approvals: boolean; streaming: boolean };
};

export type CareerOpsThread = {
  id: string;
  title: string;
  applicationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CareerOpsMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type ToolActivity = {
  tool: string;
  state: "running" | "done" | "failed";
};

export type ApprovalRequest = {
  operation: string;
  summary: string;
  details: string;
  choices: string[];
};

/** Mirrors the closed event set emitted by /api/career-ops/runs/[id]/events. */
export type CareerOpsStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_started"; tool: string }
  | { type: "tool_completed"; tool: string; durationMs: number | null; failed: boolean }
  | { type: "approval_required"; operation: string; summary: string; details: string; choices: string[] }
  | { type: "approval_resolved"; choice: string }
  | { type: "completed"; output: string }
  | { type: "failed"; message: string }
  | { type: "cancelled" }
  | { type: "status"; status: string }
  | { type: "error"; message: string };

export type RunPhase =
  | "idle"
  | "starting"
  | "streaming"
  | "waiting_approval"
  | "reconnecting"
  | "completed"
  | "failed"
  | "cancelled";

export class CareerOpsRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "CareerOpsRequestError";
  }
}

export async function careerOpsJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "same-origin", ...init });
  if (!response.ok) {
    let code = "error_generic";
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === "string") code = body.error;
    } catch {
      // A non-JSON error body is still an error; the generic code stands.
    }
    throw new CareerOpsRequestError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Bounded, unguessable client request id used to make run creation idempotent.
 * Matches the server pattern /^[A-Za-z0-9_-]{8,64}$/.
 */
export function newClientRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return random.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64).padEnd(8, "0");
}
