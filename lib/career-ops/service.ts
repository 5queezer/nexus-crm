import { getDb } from "@/lib/db";
import type { CareerOpsRunRecord, CareerOpsRunStatus, CareerOpsThreadRecord } from "@/lib/db/types";
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
  return reason.kind === "unauthorized" || reason.kind === "rate_limited";
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

function isStaleUnboundReservation(
  run: CareerOpsRunRecord,
  config: Extract<CareerOpsConfig, { enabled: true }>,
): boolean {
  if (run.hermesRunId !== "") return false;
  return Date.now() - run.createdAt.getTime() > unboundReservationTtlMs(config);
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
  const config = enabledConfig(session);
  const run = await getDb().getLatestCareerOpsRun(threadId, session.userId);
  if (!run || !ACTIVE_RUN_STATUSES.includes(run.status)) return null;
  // A reservation nothing can settle stops counting as active once it expires.
  if (isStaleUnboundReservation(run, config)) return null;
  return run;
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
    void client(config).deleteSession(hermesSessionId).catch(() => undefined);
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

const TERMINAL_RUN_STATUSES: readonly string[] = ["completed", "failed", "cancelled"];

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
    status: "queued",
  });
  if (claim.outcome === "existing") return claim.run;
  if (claim.outcome === "thread_gone") {
    throw new CareerOpsServiceError("not_found", "Not found");
  }
  if (claim.outcome === "active_run_exists") {
    // An expired unbound reservation must not wedge the conversation forever.
    // Settle it, then let the caller retry into the freed slot.
    const stale = await db.getLatestCareerOpsRun(threadId, session.userId);
    if (stale && isStaleUnboundReservation(stale, config)) {
      await db.updateCareerOpsRunStatus(stale.id, session.userId, "failed").catch(() => undefined);
    }
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

  let runId: string;
  try {
    ({ runId } = await client(config).createRun({
      input: message,
      sessionId: thread.hermesSessionId,
      instructions,
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
  if (isUnbound(run)) return;
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
export function careerOpsApprovalChallengeFor(
  session: CareerOpsSession,
  runId: string,
  event: { operation: string; summary: string; details: string; choices: CareerOpsApprovalChoice[] },
): string {
  const config = enabledConfig(session);
  return issueApprovalChallenge(config, {
    runId,
    userId: session.userId,
    actionHash: approvalActionHash(event),
    choices: event.choices,
  });
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
  let consumedChallengeId = "";
  if (choice !== "deny") {
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
    // Single use: the same disclosure cannot be replayed to re-authorize.
    if (run.approvalChallengeId && run.approvalChallengeId === verified.payload.jti) {
      throw new CareerOpsServiceError("conflict", "That decision was already recorded");
    }
    consumedChallengeId = verified.payload.jti;
  }

  try {
    await client(config).resolveApproval(run.hermesRunId, choice);
  } catch (reason) {
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
    );
  } catch {
    throw new CareerOpsServiceError(
      "upstream_error",
      "The decision was sent but could not be recorded",
    );
  }
}
