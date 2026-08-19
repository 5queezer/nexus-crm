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
let capabilityCache: { at: number; runStatus: boolean } | null = null;

export function resetCareerOpsCapabilityCacheForTests(): void {
  capabilityCache = null;
}

async function hasRunStatusSupport(
  config: Extract<CareerOpsConfig, { enabled: true }>,
): Promise<boolean> {
  if (capabilityCache && Date.now() - capabilityCache.at < CAPABILITY_CACHE_TTL_MS) {
    return capabilityCache.runStatus;
  }
  try {
    const capabilities = await client(config).capabilities();
    capabilityCache = { at: Date.now(), runStatus: capabilities.runStatus };
    return capabilities.runStatus;
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
    if (!capabilities.runs || !capabilities.sessions || !capabilities.runStatus) {
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
  return Math.max(60_000, config.connectTimeoutMs * 4);
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
  if (active && active.hermesRunId) {
    try {
      await client(config).stopRun(active.hermesRunId);
    } catch (reason) {
      // Deleting anyway would destroy the last handle on a still-executing
      // privileged run. Keep the mapping so the owner can retry.
      console.warn("career-ops: stop before delete failed", redactUpstreamError(reason));
      throw new CareerOpsServiceError(
        "conflict",
        "The active run could not be stopped; the conversation was not deleted",
      );
    }
  }

  // Then remove the Nexus mapping unconditionally: leaving a mapping behind
  // because Hermes failed would keep a reachable pointer alive, which is
  // strictly worse than an orphaned upstream session that nothing can address.
  await getDb().deleteCareerOpsThread(threadId, session.userId);
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
  if (!application) return buildGlobalInstructions();
  return buildApplicationContextInstructions({
    id: thread.applicationId,
    company: application.company,
    role: application.role,
  });
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
  if (!(await hasRunStatusSupport(config))) {
    throw new CareerOpsServiceError("unavailable", "Career Ops is not available");
  }

  const db = getDb();

  // One active run per thread. The unique key only covers
  // (threadId, clientRequestId), so two tabs with different ids would
  // otherwise both start runs against the same Hermes session, interleaving
  // conversation state and each executing tools or requesting approvals.
  // An idempotent retry must resolve to its own run, not be refused for being
  // concurrent with itself. This lookup has to precede the active-run guard:
  // the first attempt's reservation IS the active run the guard would reject,
  // and a client whose first response was lost would then see failure while the
  // agent kept executing.
  const already = await db.findCareerOpsRunByClientRequestId(
    threadId,
    session.userId,
    input.clientRequestId,
  );
  if (already) return already;

  const inFlight = await getActiveCareerOpsRun(session, threadId);
  if (inFlight) {
    throw new CareerOpsServiceError("conflict", "This conversation already has a run in progress");
  }

  // Claim (threadId, clientRequestId) BEFORE any upstream work. Starting the
  // Hermes run first and deduplicating afterwards would let a retry launch a
  // second privileged agent run that can execute tools and mutate CRM data in
  // the window before a best-effort stop lands — and that stop can fail.
  const { run: reservation, created } = await db.createCareerOpsRun(session.userId, {
    threadId,
    hermesRunId: "",
    clientRequestId: input.clientRequestId,
    status: "queued",
  });
  if (!created) return reservation;

  const instructions = await threadInstructions(session, thread);

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
    // The upstream run is live but Nexus could not record its id. Leaving the
    // reservation would strand it: a retry with the same client request id
    // returns the unbound row, so the run could never be observed, stopped or
    // approved. Kill the orphan and release the claim so the retry works.
    void client(config).stopRun(runId).catch(() => undefined);
    await db.deleteCareerOpsRun(reservation.id, session.userId).catch(() => undefined);
    throw toServiceError(reason);
  }
  if (!bound) {
    // The reservation vanished under us (concurrent thread delete). Same
    // reasoning: do not leave a live agent run nothing can address.
    void client(config).stopRun(runId).catch(() => undefined);
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

export async function resolveCareerOpsApproval(
  session: CareerOpsSession,
  runId: string,
  choice: CareerOpsApprovalChoice,
): Promise<void> {
  const config = enabledConfig(session);
  if (!APPROVAL_CHOICES.includes(choice)) {
    throw new CareerOpsServiceError("invalid_request", "Invalid approval decision");
  }
  const { run } = await requireOwnedRun(session, runId);
  if (isUnbound(run)) {
    throw new CareerOpsServiceError("conflict", "The run has not started yet");
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
    await getDb().recordCareerOpsApprovalDecision(run.id, session.userId, choice);
  } catch {
    throw new CareerOpsServiceError(
      "upstream_error",
      "The decision was sent but could not be recorded",
    );
  }
}
