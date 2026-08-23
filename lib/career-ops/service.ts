import { createHash } from "crypto";
import { getDb } from "@/lib/db";
import {
  CAREER_OPS_TERMINAL_RUN_STATUSES,
  type CareerOpsRunRecord,
  type CareerOpsRunStatus,
  type CareerOpsThreadRecord,
} from "@/lib/db/types";
import {
  CAREER_OPS_CLIENT_REQUEST_ID_PATTERN,
  CAREER_OPS_MAX_MESSAGE_LENGTH,
  CAREER_OPS_MAX_TITLE_LENGTH,
  careerOpsMemoryScope,
  readCareerOpsConfig,
  redactUpstreamError,
  type CareerOpsConfig,
} from "./config";
import {
  HermesError,
  createHermesClient,
  type HermesClient,
  type HermesMessage,
  type HermesRun,
} from "./hermes-client";
import {
  buildApplicationContextInstructions,
  buildGlobalInstructions,
} from "./instructions";
import type { CareerOpsApprovalChoice } from "./sse";
import type { CareerOpsApplicationView } from "./serialize";
import {
  approvalActionHash,
  approvalChallengeId,
  issueApprovalChallenge,
  verifyApprovalChallenge,
} from "./approval-challenge";

/**
 * The single choke point between the browser-facing routes and Hermes.
 *
 * Every exported function starts from the authenticated Nexus session and
 * resolves a Nexus-owned mapping before it can name a Hermes session or run.
 * No route constructs an upstream identifier from request input.
 */

export type CareerOpsSession = {
  userId: string;
  user: { isAdmin: boolean };
};

export type CareerOpsErrorCode =
  | "unavailable"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "upstream_error";

export class CareerOpsServiceError extends Error {
  constructor(
    readonly code: CareerOpsErrorCode,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "CareerOpsServiceError";
  }
}

export type CareerOpsStatus = {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  capabilities: { stop: boolean; approvals: boolean; streaming: boolean };
  /** Operator-configured upper bound on a run, so the client can size its status polling. */
  runTimeoutMs: number;
};

const UNSUPPORTED_CAPABILITIES = { stop: false, approvals: false, streaming: false };

/**
 * Career Ops resolves applications exactly the way the Nexus MCP server does.
 *
 * MCP reads exclude demo records, so an application it cannot see must not
 * become a conversation's context: the thread would look correctly scoped while
 * every tool call for that id came back not-found.
 */
const AGENT_VISIBLE_READ = { demoVisibility: "exclude" } as const;
const APPROVAL_CHOICES: readonly CareerOpsApprovalChoice[] = ["once", "session", "always", "deny"];

function enabledConfig(session?: CareerOpsSession): Extract<CareerOpsConfig, { enabled: true }> {
  const config = readCareerOpsConfig();
  if (!config.enabled) {
    throw new CareerOpsServiceError("unavailable", "Career Ops is not available");
  }
  // The agent's Nexus MCP token belongs to one user and every tool call acts as
  // that user. Serving anyone else would hand them the owner's CRM data.
  if (session && session.userId !== config.ownerUserId) {
    throw new CareerOpsServiceError("unavailable", "Career Ops is not available");
  }
  return config;
}

function client(config: Extract<CareerOpsConfig, { enabled: true }>): HermesClient {
  return createHermesClient(config);
}

/**
 * Translate an upstream failure into a Nexus-authored error.
 *
 * An upstream 401/403 means *Nexus'* credential was rejected, which is an
 * operator problem, not the end user's — surfacing it as an auth error would
 * mislead the user into re-authenticating.
 */
function toServiceError(reason: unknown): CareerOpsServiceError {
  if (reason instanceof CareerOpsServiceError) return reason;
  if (reason instanceof HermesError) {
    switch (reason.kind) {
      case "unauthorized":
        return new CareerOpsServiceError("unavailable", "Career Ops is not available");
      case "not_found":
        return new CareerOpsServiceError("not_found", "Not found");
      case "conflict":
        return new CareerOpsServiceError("conflict", "The agent is not waiting for this action");
      case "rate_limited":
        return new CareerOpsServiceError(
          "rate_limited",
          "Career Ops is busy",
          reason.retryAfterSeconds,
        );
      case "timeout":
      case "unreachable":
      case "upstream_error":
      default:
        return new CareerOpsServiceError("upstream_error", "Career Ops could not be reached");
    }
  }
  return new CareerOpsServiceError("upstream_error", "Career Ops could not be reached");
}

/**
 * True only when the upstream rejected or never received the request, so no run
 * can be executing. Anything ambiguous returns false and the claim is kept.
 */
function definitivelyNotSubmitted(reason: unknown): boolean {
  if (!(reason instanceof HermesError)) return false;
  // Each of these is a refusal Hermes stated, so no run was accepted: the claim
  // must be released or the conversation stays blocked for the whole run
  // lifetime over a request that provably did nothing. A timeout or transport
  // error is different — there the run may be executing.
  return (
    reason.kind === "unauthorized" ||
    reason.kind === "rate_limited" ||
    reason.kind === "conflict" ||
    reason.kind === "not_found"
  );
}

/**
 * Capability probe for the mutation path, cached briefly so starting a run does
 * not add an upstream round-trip per message while still noticing a redeploy.
 */
const CAPABILITY_CACHE_TTL_MS = 60_000;
let capabilityCache: { at: number; supported: boolean } | null = null;

export function resetCareerOpsCapabilityCacheForTests(): void {
  capabilityCache = null;
}

/**
 * Whether Hermes still advertises everything a run needs.
 *
 * Deliberately the same set the availability check uses. Gating submission on a
 * narrower set let a partial downgrade through: with run status still
 * advertised but run submission withdrawn, a stale tab or a direct request
 * would submit to an endpoint that no longer exists and leave the conversation
 * holding an ambiguous reservation for the whole run lifetime.
 */
function supportsCareerOpsRuns(capabilities: {
  runs: boolean;
  sessions: boolean;
  runStatus: boolean;
}): boolean {
  return capabilities.runs && capabilities.sessions && capabilities.runStatus;
}

async function hasRunSupport(
  config: Extract<CareerOpsConfig, { enabled: true }>,
): Promise<boolean> {
  if (capabilityCache && Date.now() - capabilityCache.at < CAPABILITY_CACHE_TTL_MS) {
    return capabilityCache.supported;
  }
  try {
    const capabilities = await client(config).capabilities();
    const supported = supportsCareerOpsRuns(capabilities);
    capabilityCache = { at: Date.now(), supported };
    return supported;
  } catch {
    // An unreachable Hermes fails the run anyway; do not cache that verdict.
    return false;
  }
}

export async function getCareerOpsStatus(
  session?: CareerOpsSession,
): Promise<CareerOpsStatus> {
  const config = readCareerOpsConfig();
  // A non-owner gets the same answer every other operation would give, and
  // never causes a probe against the operator's Hermes instance.
  if (config.enabled && session && session.userId !== config.ownerUserId) {
    return {
      enabled: false,
      available: false,
      reason: "not_owner",
      capabilities: { ...UNSUPPORTED_CAPABILITIES },
      runTimeoutMs: 0,
    };
  }
  if (!config.enabled) {
    return {
      enabled: false,
      available: false,
      reason: config.reason,
      capabilities: { ...UNSUPPORTED_CAPABILITIES },
      runTimeoutMs: 0,
    };
  }

  try {
    const hermes = client(config);
    const [health, capabilities] = await Promise.all([hermes.health(), hermes.capabilities()]);
    if (!health.healthy) {
      return {
        enabled: true,
        available: false,
        reason: "degraded",
        capabilities: { ...UNSUPPORTED_CAPABILITIES },
        runTimeoutMs: config.runTimeoutMs,
      };
    }
    // Run status is not optional: it is the only recovery path once the
    // single-consumer event stream disconnects. Without it a started run is
    // unobservable, so the honest answer is unavailable, not degraded.
    if (!supportsCareerOpsRuns(capabilities)) {
      return {
        enabled: true,
        available: false,
        reason: "unsupported",
        capabilities: { ...UNSUPPORTED_CAPABILITIES },
        runTimeoutMs: config.runTimeoutMs,
      };
    }
    return {
      enabled: true,
      available: true,
      reason: null,
      capabilities: {
        stop: capabilities.stop,
        approvals: capabilities.approvals,
        streaming: capabilities.runEvents,
      },
      runTimeoutMs: config.runTimeoutMs,
    };
  } catch {
    // The upstream reason is deliberately not surfaced: it can carry
    // credentials or internal host detail.
    return {
      enabled: true,
      available: false,
      reason: "unreachable",
      capabilities: { ...UNSUPPORTED_CAPABILITIES },
      runTimeoutMs: config.runTimeoutMs,
    };
  }
}

/**
 * Resolve a thread the caller owns.
 *
 * `session.readScopeUserId` is intentionally never consulted: administrators
 * hold cross-tenant read authority over CRM data, and that must not extend to
 * another person's Career Ops conversation.
 */
export async function requireOwnedThread(
  session: CareerOpsSession,
  threadId: string,
): Promise<CareerOpsThreadRecord> {
  enabledConfig(session);
  const thread = await getDb().getCareerOpsThread(threadId, session.userId);
  if (!thread) throw new CareerOpsServiceError("not_found", "Not found");
  return thread;
}

export async function requireOwnedRun(
  session: CareerOpsSession,
  runId: string,
): Promise<{ run: CareerOpsRunRecord; thread: CareerOpsThreadRecord }> {
  enabledConfig(session);
  const run = await getDb().getCareerOpsRun(runId, session.userId);
  if (!run) throw new CareerOpsServiceError("not_found", "Not found");
  const thread = await getDb().getCareerOpsThread(run.threadId, session.userId);
  if (!thread) throw new CareerOpsServiceError("not_found", "Not found");
  return { run, thread };
}

const ACTIVE_RUN_STATUSES: readonly CareerOpsRunStatus[] = [
  "queued",
  "running",
  "waiting_for_approval",
  "stopping",
];

/**
 * How long an unbound reservation may hold a conversation.
 *
 * A reservation kept after an ambiguous submission has no upstream id, so
 * nothing can ever settle it. Without an expiry it would count as an active run
 * forever and every later message would be refused — one network timeout would
 * brick the conversation permanently. The window is generous enough that a real
 * in-flight submission is never mistaken for a stale one.
 */
/**
 * Digest of the message a client request id is claimed for.
 *
 * A digest, not the text: Nexus already declines to duplicate the conversation
 * into its own store, and this exists only to tell a genuine retry from a
 * reused key. Normalized so that trimming or line-ending differences between a
 * submission and its retry do not read as a different question.
 */
export function careerOpsRequestHash(message: string): string {
  return createHash("sha256")
    .update(message.replace(/\r\n/g, "\n").trim())
    .digest("base64url")
    .slice(0, 32);
}

/**
 * How much prior conversation is replayed to Hermes on each turn.
 *
 * Bounded twice — by turns and by characters — because this text is
 * attacker-influenced (it is assistant output) and goes into a request body
 * that must stay within the same limits as everything else on this path. The
 * most recent turns are kept: those are the ones a follow-up refers to.
 */
const HISTORY_MAX_MESSAGES = 20;
const HISTORY_MAX_CHARS = 24_000;

/**
 * The prior turns of a conversation, oldest first and bounded.
 *
 * Necessary because the Runs API builds model history from explicit request
 * fields and does not hydrate stored messages from `session_id`. Passing the
 * session id alone produced a drawer that showed a continuous conversation
 * while every turn started from nothing.
 */
function boundedHistory(
  messages: readonly { role: "user" | "assistant"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const kept: { role: "user" | "assistant"; content: string }[] = [];
  let budget = HISTORY_MAX_CHARS;
  // Walk backwards: a follow-up refers to the newest turns, so those are the
  // ones worth spending the budget on.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (kept.length >= HISTORY_MAX_MESSAGES || budget <= 0) break;
    const message = messages[i];
    if (!message.content) continue;
    if (message.content.length > budget) {
      // Keep a bounded portion rather than dropping everything. One oversized
      // message — content is accepted up to 200 000 characters — used to end
      // the walk on its first iteration and return no history at all, so the
      // next turn lost even the question it was answering while the drawer
      // still showed a continuous conversation.
      //
      // Safe to slice: this text was redacted whole when the transcript was
      // read, so cutting it here cannot sever a credential.
      kept.push({ role: message.role, content: `${message.content.slice(0, budget)}…` });
      break;
    }
    budget -= message.content.length;
    kept.push({ role: message.role, content: message.content });
  }
  return kept.reverse();
}

/**
 * Grace beyond the run lifetime before a reservation is given up on.
 *
 * The lifetime is what Nexus watches for; Hermes may still be finishing when it
 * elapses. The margin keeps the ordinary case — a slow but live run — from
 * having its slot taken.
 */
const RESERVATION_EXPIRY_MARGIN_MS = 5 * 60_000;

function unboundReservationTtlMs(config: Extract<CareerOpsConfig, { enabled: true }>): number {
  // The full run lifetime, not a short grace period. If Hermes accepted the
  // submission and only the response was lost, a legitimate run can still be
  // executing for as long as any run may run — and Nexus holds no id for it, so
  // it cannot check. Expiring sooner would let a fresh request id start a
  // SECOND privileged agent against the same session.
  //
  // The cost is that a submission which genuinely failed blocks the
  // conversation for that long. That is the safer side of the trade: a stalled
  // conversation is recoverable, two concurrent agents mutating the same CRM
  // data are not. A real fix needs Hermes to support looking a run up by client
  // key, which it does not — see design.md D10.
  return Math.max(60_000, config.runTimeoutMs);
}

/**
 * The instant before which an unbound reservation may be given up on.
 *
 * Deliberately past the full run lifetime plus a margin. `runTimeoutMs` bounds
 * how long Nexus watches a run, not how long Hermes may execute one, so a
 * shorter cutoff would free the conversation's active slot while the upstream
 * run could still be working — and admit a second privileged run beside it.
 */
function reservationCutoff(config: Extract<CareerOpsConfig, { enabled: true }>): Date {
  return new Date(Date.now() - unboundReservationTtlMs(config) - RESERVATION_EXPIRY_MARGIN_MS);
}

/**
 * Give up on a reservation nothing can settle, if it is genuinely past its
 * cutoff — decided by the database, in one conditional transition, so it cannot
 * race the binding of an upstream id that arrived late.
 *
 * The status written is `abandoned`, never `failed`: Nexus holds no upstream id
 * for this run, so it never observed an outcome and must not assert one.
 *
 * Residual, and stated plainly because it cannot be closed from this side: this
 * frees the active slot on a *local* deadline. Only an execution deadline that
 * Hermes itself enforces would prove the upstream run has stopped, and the Runs
 * API exposes no such field, just as it exposes no lookup by client key. See
 * design.md.
 */
async function expireUnboundReservation(
  run: CareerOpsRunRecord,
  session: CareerOpsSession,
  config: Extract<CareerOpsConfig, { enabled: true }>,
): Promise<boolean> {
  if (run.hermesRunId !== "") return false;
  return getDb()
    .expireCareerOpsRunReservation(run.id, session.userId, reservationCutoff(config))
    .catch(() => false);
}

/**
 * The thread's latest run when it has not reached a terminal state, so a client
 * that reloaded mid-run can rejoin it instead of showing an idle composer and
 * letting a second concurrent run start on the same session.
 */
export async function getActiveCareerOpsRun(
  session: CareerOpsSession,
  threadId: string,
): Promise<CareerOpsRunRecord | null> {
  return (await getCareerOpsThreadRunState(session, threadId)).activeRun;
}

/**
 * The conversation's run state in one read: the live run if there is one, and
 * otherwise when its most recent run settled.
 *
 * `settledAt` exists because the drawer learns the transcript and the run state
 * from two separate requests, and no ordering of two reads makes them one
 * snapshot. A run that finishes between them is invisible to both: the
 * transcript was taken before the reply existed, and the run state taken after
 * reports nothing in flight. The conversation then shows a question with no
 * answer until something else reloads it. Handing the client the settle time
 * lets it notice that its transcript is the older of the two and re-read.
 */
export async function getCareerOpsThreadRunState(
  session: CareerOpsSession,
  threadId: string,
): Promise<{ activeRun: CareerOpsRunRecord | null; settledAt: Date | null }> {
  const config = enabledConfig(session);
  const run = await getDb().getLatestCareerOpsRun(threadId, session.userId);
  if (!run) return { activeRun: null, settledAt: null };
  if (!ACTIVE_RUN_STATUSES.includes(run.status)) {
    return { activeRun: null, settledAt: run.updatedAt };
  }
  // A reservation nothing can settle stops counting as active once it expires.
  // Settle it here rather than merely ignoring it: the adapters enforce the
  // active-run invariant on the stored status, so a row this function treats as
  // inactive while the database still counts it as active leaves the
  // conversation impossible to delete — and impossible to escape without
  // submitting again to trigger the cleanup elsewhere.
  //
  // An expiry is a settle like any other, and the client must re-read for the
  // same reason: the run may have produced output Nexus never saw.
  if (await expireUnboundReservation(run, session, config)) {
    return { activeRun: null, settledAt: new Date() };
  }
  return { activeRun: run, settledAt: null };
}

export async function listCareerOpsThreads(
  session: CareerOpsSession,
): Promise<CareerOpsThreadRecord[]> {
  enabledConfig(session);
  return getDb().listCareerOpsThreads(session.userId);
}

function defaultTitle(company: string, role: string): string {
  const label = [company, role].filter(Boolean).join(" — ");
  return (label || "Career Ops").slice(0, CAREER_OPS_MAX_TITLE_LENGTH);
}

export async function createCareerOpsThread(
  session: CareerOpsSession,
  input: { title?: string; applicationId?: string | null },
): Promise<CareerOpsThreadRecord> {
  const config = enabledConfig(session);
  const db = getDb();

  let applicationId: string | null = null;
  let title = (input.title ?? "").trim().slice(0, CAREER_OPS_MAX_TITLE_LENGTH);

  if (input.applicationId) {
    // One read both proves ownership and enforces agent visibility.
    const application = await db.getApplication(
      input.applicationId,
      session.userId,
      AGENT_VISIBLE_READ,
    );
    if (!application) throw new CareerOpsServiceError("not_found", "Not found");
    applicationId = input.applicationId;
    if (!title) {
      title = defaultTitle(
        typeof application.company === "string" ? application.company : "",
        typeof application.role === "string" ? application.role : "",
      );
    }
  }

  if (!title) title = "Career Ops";

  let hermesSessionId: string;
  try {
    const created = await client(config).createSession({
      title: undefined,
      memoryScope: careerOpsMemoryScope(config, session.userId),
    });
    hermesSessionId = created.id;
  } catch (reason) {
    throw toServiceError(reason);
  }

  try {
    return await db.createCareerOpsThread(session.userId, {
      hermesSessionId,
      title,
      applicationId,
    });
  } catch (reason) {
    // The upstream session exists but nothing in Nexus points at it. Without
    // this cleanup every retry would strand another unaddressable session.
    // Awaited, not fire-and-forget: the response can end this process before an
    // unawaited request is sent, which is exactly the case that leaks. A
    // failure here is logged rather than hidden, because the session then
    // outlives Nexus' knowledge of it and only an operator can reconcile it.
    await client(config)
      .deleteSession(hermesSessionId)
      .catch((cleanupFailure) => {
        console.warn(
          "career-ops: orphaned upstream session, manual cleanup required",
          redactUpstreamError(cleanupFailure),
        );
      });
    throw toServiceError(reason);
  }
}

export async function deleteCareerOpsThread(
  session: CareerOpsSession,
  threadId: string,
): Promise<void> {
  const config = enabledConfig(session);
  const thread = await requireOwnedThread(session, threadId);

  // Deleting a Hermes session does not stop its runs — the upstream handler
  // only drops the session row. Removing the mappings first would leave a
  // privileged run executing with nothing left to observe or stop it, so stop
  // it while it is still addressable.
  const active = await getActiveCareerOpsRun(session, threadId);
  if (active && !active.hermesRunId) {
    // An ambiguous submission: a privileged run may be executing and Nexus has
    // no id to stop it with. Deleting would drop the only mapping and leave it
    // running unreachable — deleting the Hermes session does not stop its runs.
    throw new CareerOpsServiceError(
      "conflict",
      "A run may still be starting; the conversation was not deleted",
    );
  }
  if (active && active.hermesRunId) {
    // A stop is only an acknowledgement — Hermes reports `stopping` and settles
    // later. Deleting on the acknowledgement would discard the last handle on a
    // run whose tool call has not yet honoured cancellation, so wait for an
    // observed terminal state and keep the mapping if it never arrives.
    const confirmed = await stopAndConfirmTerminal(config, active.hermesRunId);
    if (!confirmed) {
      throw new CareerOpsServiceError(
        "conflict",
        "The active run could not be confirmed stopped; the conversation was not deleted",
      );
    }
    await getDb()
      .updateCareerOpsRunStatus(active.id, session.userId, "cancelled")
      .catch(() => undefined);
  }

  // The delete itself is the authority on whether the conversation is free.
  // The check above stops a run that was already there, but a submission can
  // claim and bind one in the window between that check and this call — so the
  // adapter decides and acts in one transaction and refuses if it lost the
  // race. The owner retries; nothing is left stranded.
  const deletion = await getDb().deleteCareerOpsThread(threadId, session.userId);
  if (deletion.outcome === "active_run") {
    throw new CareerOpsServiceError(
      "conflict",
      "A run started while the conversation was being deleted; it was not deleted",
    );
  }
  if (deletion.outcome === "not_found") {
    throw new CareerOpsServiceError("not_found", "Not found");
  }

  // Only once the mapping is gone: an orphaned upstream session that nothing
  // can address is strictly better than a reachable pointer to a live one.
  try {
    await client(config).deleteSession(thread.hermesSessionId);
  } catch (reason) {
    console.warn("career-ops: upstream session delete failed", redactUpstreamError(reason));
  }
}

export async function listCareerOpsThreadMessages(
  session: CareerOpsSession,
  threadId: string,
): Promise<HermesMessage[]> {
  const config = enabledConfig(session);
  const thread = await requireOwnedThread(session, threadId);
  try {
    return await client(config).listSessionMessages(thread.hermesSessionId);
  } catch (reason) {
    throw toServiceError(reason);
  }
}

/**
 * The opportunity a thread is scoped to, as the agent can currently see it, or
 * null when the link is gone or no longer agent-visible. Resolved per active
 * thread rather than for every row in the list: the badge describes the
 * conversation in front of the user, and a read per listed thread would be an
 * unbounded fan-out.
 */
export async function resolveCareerOpsThreadApplication(
  session: CareerOpsSession,
  thread: CareerOpsThreadRecord,
): Promise<CareerOpsApplicationView | null> {
  enabledConfig(session);
  if (!thread.applicationId) return null;
  const application = await getDb().getApplication(
    thread.applicationId,
    session.userId,
    AGENT_VISIBLE_READ,
  );
  if (!application) return null;
  return {
    id: thread.applicationId,
    company: application.company,
    role: application.role,
  };
}

async function threadInstructions(
  session: CareerOpsSession,
  thread: CareerOpsThreadRecord,
): Promise<string> {
  if (!thread.applicationId) return buildGlobalInstructions();
  // The link can outlive the agent's ability to read it (deleted, or turned
  // into demo data), so re-check visibility on every run rather than trusting
  // the stored id.
  const application = await getDb().getApplication(
    thread.applicationId,
    session.userId,
    AGENT_VISIBLE_READ,
  );
  if (!application) {
    // Falling back to global instructions here would silently widen the run's
    // scope: the conversation still carries an application id and the surface
    // still presents it as application context, so the user would believe the
    // agent is confined to one opportunity while it could act across the whole
    // CRM. Fail closed and require an explicit move to a global conversation.
    throw new CareerOpsServiceError(
      "conflict",
      "This conversation's opportunity is no longer available; start a general conversation instead",
    );
  }
  return buildApplicationContextInstructions({
    id: thread.applicationId,
    company: application.company,
    role: application.role,
  });
}

// Kept in step with CAREER_OPS_TERMINAL_RUN_STATUSES: a status missing here is
// one this service would keep polling for after it can no longer change.
const TERMINAL_RUN_STATUSES: readonly string[] = [...CAREER_OPS_TERMINAL_RUN_STATUSES];

/**
 * Upstream failures that leave it unknown whether the request took effect. A
 * refusal Hermes stated (`conflict`, `not_found`) is decided; a transport
 * failure is not.
 */
const AMBIGUOUS_UPSTREAM_KINDS: readonly string[] = ["timeout", "unreachable", "upstream_error"];

/** How long to wait for a stopped run to actually settle. */
function stopConfirmationWindowMs(config: Extract<CareerOpsConfig, { enabled: true }>): number {
  return Math.min(Math.max(config.connectTimeoutMs * 3, 3_000), 15_000);
}

/**
 * Stop an upstream run and confirm it actually reached a terminal state.
 *
 * `POST /v1/runs/{id}/stop` only acknowledges the request — Hermes reports
 * `stopping` and settles later — so treating the acknowledgement as the end of
 * the run lets a tool that has not yet honoured cancellation keep mutating CRM
 * data while Nexus throws away the only handle to it. Callers that are about to
 * discard a mapping must know whether the run is really finished.
 *
 * Returns true only on observed terminal state. A stop that fails, a status
 * that never settles, and a deadline overrun all return false: unknown is not
 * stopped.
 */
async function stopAndConfirmTerminal(
  config: Extract<CareerOpsConfig, { enabled: true }>,
  hermesRunId: string,
): Promise<boolean> {
  const api = client(config);
  try {
    await api.stopRun(hermesRunId);
  } catch (reason) {
    // A run Hermes has already forgotten cannot still be executing; anything
    // else leaves the outcome unknown.
    if (reason instanceof HermesError && reason.kind === "not_found") return true;
    return false;
  }

  // Bounded by a short window, not the run lifetime: this runs inside a request
  // the user is waiting on, and "not settled yet" is a safe answer — the caller
  // keeps the mapping and the owner can retry. Blocking for the full run
  // timeout would hang a delete for minutes to reach the same conclusion.
  const deadline = Date.now() + stopConfirmationWindowMs(config);
  let delayMs = 200;
  while (Date.now() < deadline) {
    try {
      const status = await api.getRun(hermesRunId);
      if (TERMINAL_RUN_STATUSES.includes(status.status)) return true;
    } catch (reason) {
      if (reason instanceof HermesError && reason.kind === "not_found") return true;
      return false;
    }
    await sleep(Math.min(delayMs, Math.max(0, deadline - Date.now())));
    delayMs = Math.min(delayMs * 2, 2_000);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startCareerOpsRun(
  session: CareerOpsSession,
  threadId: string,
  input: { message: string; clientRequestId: string },
): Promise<CareerOpsRunRecord> {
  const config = enabledConfig(session);

  const message = input.message.trim();
  if (!message || message.length > CAREER_OPS_MAX_MESSAGE_LENGTH) {
    throw new CareerOpsServiceError("invalid_request", "Invalid message");
  }
  if (!CAREER_OPS_CLIENT_REQUEST_ID_PATTERN.test(input.clientRequestId)) {
    throw new CareerOpsServiceError("invalid_request", "Invalid client request id");
  }

  const thread = await requireOwnedThread(session, threadId);

  // The status endpoint gates the UI, but a stale tab or a direct authenticated
  // request must not be able to start a run whose only recovery path is absent.
  if (!(await hasRunSupport(config))) {
    throw new CareerOpsServiceError("unavailable", "Career Ops is not available");
  }

  const db = getDb();

  // One atomic claim decides all three questions: is this an idempotent retry,
  // does the conversation already hold a live run, and does the conversation
  // still exist. A read-then-write sequence cannot decide any of them — two
  // submissions both pass it and both start a privileged agent run against the
  // same Hermes session — so the invariant lives in the database.
  const claim = await db.claimCareerOpsRun(session.userId, {
    threadId,
    hermesRunId: "",
    clientRequestId: input.clientRequestId,
    // Bind the key to what it is being claimed for. Without this the same id
    // sent with edited text resolves to the earlier run, and the user is shown
    // an answer to a question they no longer asked.
    requestHash: careerOpsRequestHash(message),
    status: "queued",
  });
  if (claim.outcome === "existing") {
    // An unbound reservation is an ambiguous earlier submission: Hermes may be
    // executing it, and Nexus has no id to observe or stop it with. Returning
    // it as an accepted run would have the client subscribe to events that 409
    // and poll a status that stays `queued` for the whole run lifetime. Say it
    // is uncertain instead.
    if (isUnbound(claim.run)) {
      throw new CareerOpsServiceError(
        "conflict",
        "An earlier attempt may still be starting; wait before retrying",
      );
    }
    return claim.run;
  }
  if (claim.outcome === "request_mismatch") {
    throw new CareerOpsServiceError(
      "conflict",
      "That request id was already used for a different message",
    );
  }
  if (claim.outcome === "thread_gone") {
    throw new CareerOpsServiceError("not_found", "Not found");
  }
  if (claim.outcome === "active_run_exists") {
    // An expired unbound reservation must not wedge the conversation forever.
    // Settle it, then let the caller retry into the freed slot.
    const stale = await db.getLatestCareerOpsRun(threadId, session.userId);
    if (stale) await expireUnboundReservation(stale, session, config);
    throw new CareerOpsServiceError("conflict", "This conversation already has a run in progress");
  }
  const reservation = claim.run;

  let instructions: string;
  try {
    instructions = await threadInstructions(session, thread);
  } catch (reason) {
    // Still provably before submission: nothing has been sent to Hermes, so the
    // claim must be released. Holding it would strand the conversation for the
    // whole reservation lifetime over a transient read failure — retries with
    // the same request id would return the unbound row and fresh ids would
    // conflict with it.
    await db.deleteCareerOpsRun(reservation.id, session.userId).catch(() => undefined);
    throw toServiceError(reason);
  }

  // Read the prior turns before submitting. Fails closed: a conversation that
  // silently forgets what was said is the defect being fixed here, so a
  // transcript this call cannot read is reported rather than papered over with
  // a run that starts from nothing.
  let history: { role: "user" | "assistant"; content: string }[];
  try {
    history = boundedHistory(await client(config).listSessionMessages(thread.hermesSessionId));
  } catch (reason) {
    // Provably before submission, so the claim must be released — the same
    // reasoning as the instructions read above.
    await db.deleteCareerOpsRun(reservation.id, session.userId).catch(() => undefined);
    throw toServiceError(reason);
  }

  let runId: string;
  try {
    ({ runId } = await client(config).createRun({
      input: message,
      sessionId: thread.hermesSessionId,
      instructions,
      history,
      memoryScope: careerOpsMemoryScope(config, session.userId),
    }));
  } catch (reason) {
    // Releasing the claim is only safe when the request provably never reached
    // Hermes. A timeout or a mid-flight transport error is ambiguous: the run
    // may already be executing, and releasing would let a retry with the same
    // client request id start a second privileged run. The retained reservation
    // has no upstream id, so nothing can settle it — it expires instead (see
    // unboundReservationTtlMs) rather than blocking the conversation forever.
    if (definitivelyNotSubmitted(reason)) {
      await db.deleteCareerOpsRun(reservation.id, session.userId).catch(() => undefined);
    }
    throw toServiceError(reason);
  }

  let bound: CareerOpsRunRecord | null;
  try {
    bound = await db.bindCareerOpsRunHermesId(reservation.id, session.userId, runId);
  } catch (reason) {
    // The upstream run is live but Nexus could not record its id. Releasing the
    // claim is only safe once that run is provably finished — an unawaited stop
    // can be cut short by the process ending, and Hermes can reject it, either
    // of which would let a retry start a second privileged run alongside the
    // first. Confirm termination before freeing the slot; if it cannot be
    // confirmed, keep the reservation so the conversation stays blocked rather
    // than running two agents against one session.
    const confirmed = await stopAndConfirmTerminal(config, runId).catch(() => false);
    if (confirmed) {
      await db.deleteCareerOpsRun(reservation.id, session.userId).catch(() => undefined);
    } else {
      await db
        .updateCareerOpsRunStatus(reservation.id, session.userId, "stopping")
        .catch(() => undefined);
    }
    throw toServiceError(reason);
  }
  if (!bound) {
    // The reservation vanished under us (concurrent thread delete). Same
    // reasoning: do not leave a live agent run nothing can address — and await
    // the stop, because the response may end this process.
    await stopAndConfirmTerminal(config, runId).catch(() => false);
    throw new CareerOpsServiceError("conflict", "The conversation is no longer available");
  }
  return bound;
}

/**
 * A reservation exists but its upstream run has not been created yet, so there
 * is nothing addressable upstream. Callers report it as still queued rather
 * than sending an empty id to Hermes.
 */
function isUnbound(run: CareerOpsRunRecord): boolean {
  return run.hermesRunId === "";
}

export async function getCareerOpsRunStatus(
  session: CareerOpsSession,
  runId: string,
): Promise<HermesRun> {
  const config = enabledConfig(session);
  const { run } = await requireOwnedRun(session, runId);
  if (isUnbound(run)) return { runId: run.id, status: "queued", output: "", error: null };
  try {
    const upstream = await client(config).getRun(run.hermesRunId);
    await getDb().updateCareerOpsRunStatus(run.id, session.userId, upstream.status);
    // Polling may be the first thing to see a gate: the event stream is
    // single-consumer and Hermes need not support it at all. Recovery has no
    // prompt to disclose and so no challenge, but the owner must still be able
    // to refuse — otherwise the browser shows the recovered denial-only prompt
    // while every decision is refused for having no gate, and Hermes waits
    // forever. The adapter declines while a decision is unresolved, so this can
    // never reopen a gate another decision already took.
    if (upstream.status === "waiting_for_approval") {
      await getDb()
        .recoverCareerOpsApprovalGate(run.id, session.userId)
        .catch(() => false);
    }
    return upstream;
  } catch (reason) {
    // Hermes retains run status for a bounded window. Once it has forgotten a
    // bound run, no upstream run exists any more — but the local row would stay
    // active forever and, with one active run per conversation, wedge it. A
    // definitive 404 is therefore reconciled into a terminal local state.
    if (reason instanceof HermesError && reason.kind === "not_found") {
      await getDb()
        .updateCareerOpsRunStatus(run.id, session.userId, "failed")
        .catch(() => undefined);
    }
    throw toServiceError(reason);
  }
}

export async function recordCareerOpsRunStatus(
  session: CareerOpsSession,
  runId: string,
  status: CareerOpsRunStatus,
): Promise<void> {
  await getDb().updateCareerOpsRunStatus(runId, session.userId, status);
}

export async function openCareerOpsRunEvents(
  session: CareerOpsSession,
  runId: string,
  signal: AbortSignal,
): Promise<{
  upstream: ReadableStream<Uint8Array>;
  run: CareerOpsRunRecord;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
}> {
  const config = enabledConfig(session);
  const { run } = await requireOwnedRun(session, runId);
  if (isUnbound(run)) {
    throw new CareerOpsServiceError("conflict", "The run has not started yet");
  }
  try {
    const upstream = await client(config).openRunEvents(run.hermesRunId, signal);
    return {
      upstream,
      run,
      idleTimeoutMs: config.streamIdleTimeoutMs,
      totalTimeoutMs: config.runTimeoutMs,
    };
  } catch (reason) {
    throw toServiceError(reason);
  }
}

export async function stopCareerOpsRun(
  session: CareerOpsSession,
  runId: string,
): Promise<void> {
  const config = enabledConfig(session);
  const { run } = await requireOwnedRun(session, runId);
  // Already finished as far as Nexus knows: the caller's desired end state is
  // reached, and asking Hermes again invites a rejection for a run that no
  // longer exists, turning a satisfied request into an error.
  if (TERMINAL_RUN_STATUSES.includes(run.status)) return;
  if (isUnbound(run)) {
    // An ambiguous submission: Hermes may have accepted the run and only the
    // response was lost, so a privileged run can be executing with no id to
    // address it. Returning quietly would let the route answer `stopping:
    // true` and tell the user the agent is being stopped when nothing was
    // sent anywhere.
    throw new CareerOpsServiceError(
      "conflict",
      "This run cannot be stopped yet; it may still be starting",
    );
  }
  try {
    await client(config).stopRun(run.hermesRunId);
  } catch (reason) {
    throw toServiceError(reason);
  }
}

/**
 * Mint the proof that a specific approval prompt was disclosed to this owner.
 * Called only from the event route, at the moment the sanitized prompt is put
 * on the wire, so the token describes exactly what the human will see.
 */
export async function careerOpsApprovalChallengeFor(
  session: CareerOpsSession,
  runId: string,
  event: { operation: string; summary: string; details: string; choices: CareerOpsApprovalChoice[] },
): Promise<string | null> {
  const config = enabledConfig(session);
  const token = issueApprovalChallenge(config, {
    runId,
    userId: session.userId,
    actionHash: approvalActionHash(event),
    choices: event.choices,
  });
  // Open the gate and record this challenge as the one outstanding for it. Only
  // this challenge may be answered, which is what stops a token minted for an
  // earlier gate on the same run from authorizing a later, different action.
  //
  // This write is what makes the prompt answerable at all — a decision arriving
  // against a run with no open gate is refused. So the caller must not disclose
  // controls until it succeeds: the single-consumer stream cannot reissue the
  // prompt, and the user would be left with buttons that can never work while
  // Hermes stays blocked waiting for one of them.
  const jti = approvalChallengeId(token);
  if (!jti) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await getDb().openCareerOpsApprovalGate(runId, session.userId, jti);
      return token;
    } catch {
      if (attempt === 2) return null;
      await sleep(100 * 2 ** attempt);
    }
  }
  return null;
}

export async function resolveCareerOpsApproval(
  session: CareerOpsSession,
  runId: string,
  choice: CareerOpsApprovalChoice,
  challenge?: unknown,
): Promise<void> {
  const config = enabledConfig(session);
  if (!APPROVAL_CHOICES.includes(choice)) {
    throw new CareerOpsServiceError("invalid_request", "Invalid approval decision");
  }
  const { run } = await requireOwnedRun(session, runId);
  if (isUnbound(run)) {
    throw new CareerOpsServiceError("conflict", "The run has not started yet");
  }

  // Ownership of the run is not consent to a specific action. The challenge is
  // what ties this decision to the prompt Nexus actually disclosed, and to the
  // choices that prompt offered — without it an authenticated request could
  // approve an action the browser never showed, or grant `session`/`always`
  // breadth the gate never advertised.
  //
  // The requirement is deliberately asymmetric. Only a decision that *grants*
  // needs proof of disclosure; `deny` grants nothing, and requiring a challenge
  // for it would strip the owner of the safe option in exactly the case where
  // the prompt could not be recovered — after the single-consumer event stream
  // dropped. Denial stays available to the owner unconditionally.
  //
  // Both paths end in the *same* conditional claim. Two partial claims — one
  // consuming the challenge for grants, one checking the status for denials —
  // is what let a grant and a denial both reach Hermes: the denial read a
  // `waiting_for_approval` status the grant's claim had already invalidated,
  // and whichever arrived second could answer a later gate.
  let consumedChallengeId = "";
  if (choice === "deny") {
    // Denial carries no challenge, by design, but still has to win the gate.
    // A null claim means no gate is open here: the run is merely executing, has
    // finished, or a grant just took it. Stop remains available, and is the
    // stronger action in that situation anyway.
    const claim = await getDb()
      .claimCareerOpsApprovalGate(run.id, session.userId, null)
      .catch(() => null);
    if (!claim) {
      throw new CareerOpsServiceError("conflict", "No approval is awaiting a decision");
    }
    consumedChallengeId = claim.challengeId;
  } else {
    const verified = verifyApprovalChallenge(config, challenge, {
      runId: run.id,
      userId: session.userId,
      choice,
    });
    if (!verified.ok) {
      throw new CareerOpsServiceError(
        "invalid_request",
        verified.reason === "expired"
          ? "That approval prompt has expired; reload the conversation"
          : "That decision does not match the approval that was shown",
      );
    }
    // Single use, and only for the gate currently awaiting a decision. A run
    // can reach several gates inside one challenge lifetime, so "not the one
    // already consumed" is not enough: an earlier gate's token would still
    // verify against run, owner and choice, and could authorize whatever action
    // is pending now. The claim is what rules that out.
    const claim = await getDb().claimCareerOpsApprovalGate(
      run.id,
      session.userId,
      verified.payload.jti,
    );
    if (!claim) {
      throw new CareerOpsServiceError(
        "conflict",
        "That decision does not answer the approval currently awaiting you",
      );
    }
    consumedChallengeId = verified.payload.jti;
  }

  // Commit the intent before the upstream call. Recording only afterwards
  // meant a decision that Hermes accepted could leave no local trace at all if
  // the write then failed — the privileged effect had happened and Nexus could
  // not say who caused it.
  //
  // This write is required, not best-effort: swallowing it and forwarding
  // anyway would authorize a privileged action with no attribution, which is
  // the very thing recording-first exists to prevent.
  try {
    await getDb().recordCareerOpsApprovalDecision(
      run.id,
      session.userId,
      choice,
      consumedChallengeId,
      "pending",
    );
  } catch {
    // Nothing was sent upstream, so putting the gate back is not a replay risk
    // — and without it the prompt came from a single-consumer stream that
    // cannot reissue it, leaving the user with no way to answer at all.
    await getDb()
      .releaseCareerOpsApprovalGate(run.id, session.userId, consumedChallengeId)
      .catch(() => undefined);
    throw new CareerOpsServiceError(
      "upstream_error",
      "The decision could not be recorded, so it was not sent",
    );
  }

  try {
    await client(config).resolveApproval(run.hermesRunId, choice);
  } catch (reason) {
    // A refusal Hermes stated is a known non-effect; a transport failure is not.
    const undecided =
      !(reason instanceof HermesError) || AMBIGUOUS_UPSTREAM_KINDS.includes(reason.kind);
    await getDb()
      .recordCareerOpsApprovalDecision(
        run.id,
        session.userId,
        choice,
        consumedChallengeId,
        undecided ? "outcome_unknown" : "not_applied",
      )
      .catch(() => undefined);
    if (!undecided) {
      // Hermes stated the refusal, so the decision provably did nothing and the
      // gate is still open upstream — a rate limit is the ordinary case. Leaving
      // it locally claimed strands the run: the client offers a retry, the retry
      // finds no open gate and drops the prompt, and Hermes waits forever with
      // nobody able to answer. Reopening is safe precisely because nothing was
      // applied.
      await getDb()
        .releaseCareerOpsApprovalGate(run.id, session.userId, consumedChallengeId)
        .catch(() => undefined);
    }
    throw toServiceError(reason);
  }
  // Attribution only: which owner decided what, and when. The command and its
  // arguments are never written to Nexus. The spec requires this record, so a
  // failure is reported rather than swallowed — the decision did reach Hermes,
  // which the controlled error says explicitly.
  try {
    await getDb().recordCareerOpsApprovalDecision(
      run.id,
      session.userId,
      choice,
      consumedChallengeId,
      "effect_completed",
    );
  } catch {
    throw new CareerOpsServiceError(
      "upstream_error",
      "The decision was sent but could not be recorded",
    );
  }
}
