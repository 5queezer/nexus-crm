/** Client-side view of the Career Ops BFF. Mirrors lib/career-ops/serialize.ts. */

export type CareerOpsStatus = {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  capabilities: { stop: boolean; approvals: boolean; streaming: boolean };
  runTimeoutMs: number;
};

export type CareerOpsThread = {
  id: string;
  title: string;
  applicationId: string | null;
  /**
   * The conversation was created against an application that no longer exists.
   * A cleared link is not the same as never having had one, and only the server
   * can tell them apart: every run in such a conversation is refused.
   */
  scopeLost?: boolean;
  /** The browser's own key for the request that created this conversation. */
  clientRequestId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CareerOpsApplicationContext = {
  id: string;
  company: string;
  role: string;
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
  /**
   * Server-issued proof that this exact prompt was disclosed. Submitted back
   * with a granting decision; absent on a prompt recovered after a disconnect,
   * which is why such a prompt can only be denied.
   */
  challenge?: string;
  /** True when the action text did not fit the display bound. */
  truncated?: boolean;
  /**
   * True when the prompt carried no operation, summary or details at all — the
   * agent asked for authorization without saying what for. Denial-only, and
   * distinct from `truncated` (too much to show) and `detailsUnavailable` (the
   * payload was lost with the stream).
   */
  undisclosed?: boolean;
  /**
   * True when the run was rejoined after a disconnect: Hermes' run status
   * reports that a decision is pending but carries no operation payload, and
   * the event stream that had it is single-consumer and gone.
   */
  detailsUnavailable?: boolean;
};

/** Mirrors the closed event set emitted by /api/career-ops/runs/[id]/events. */
export type CareerOpsStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_started"; tool: string }
  | { type: "tool_completed"; tool: string; durationMs: number | null; failed: boolean }
  | {
      type: "approval_required";
      operation: string;
      summary: string;
      details: string;
      choices: string[];
      challenge?: string;
      truncated?: boolean;
      undisclosed?: boolean;
    }
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
    /**
     * Set by the approval route when the prompt this request answered is still
     * open. The code alone cannot say: `upstream_error` covers both a decision
     * that never took the gate and one the agent may already have applied.
     */
    readonly approvalStillOpen = false,
    /**
     * Set by the run-creation route when a run may be executing upstream
     * despite the failure. The code alone cannot say: a submission that timed
     * out after the agent accepted it looks exactly like one that never left.
     */
    readonly runMayHaveStarted = false,
  ) {
    super(code);
    this.name = "CareerOpsRequestError";
  }
}

export async function careerOpsJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "same-origin", ...init });
  if (!response.ok) {
    let code = "error_generic";
    let approvalStillOpen = false;
    let runMayHaveStarted = false;
    try {
      const body = (await response.json()) as {
        error?: string;
        approvalStillOpen?: boolean;
        runMayHaveStarted?: boolean;
      };
      if (typeof body.error === "string") code = body.error;
      approvalStillOpen = body.approvalStillOpen === true;
      runMayHaveStarted = body.runMayHaveStarted === true;
    } catch {
      // A non-JSON error body is still an error; the generic code stands.
    }
    throw new CareerOpsRequestError(response.status, code, approvalStillOpen, runMayHaveStarted);
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
