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
};

const UNSUPPORTED_CAPABILITIES = { stop: false, approvals: false, streaming: false };
const APPROVAL_CHOICES: readonly CareerOpsApprovalChoice[] = ["once", "session", "always", "deny"];

function enabledConfig(): Extract<CareerOpsConfig, { enabled: true }> {
  const config = readCareerOpsConfig();
  if (!config.enabled) {
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

export async function getCareerOpsStatus(): Promise<CareerOpsStatus> {
  const config = readCareerOpsConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      available: false,
      reason: config.reason,
      capabilities: { ...UNSUPPORTED_CAPABILITIES },
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
      };
    }
    if (!capabilities.runs || !capabilities.sessions) {
      return {
        enabled: true,
        available: false,
        reason: "unsupported",
        capabilities: { ...UNSUPPORTED_CAPABILITIES },
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
    };
  } catch {
    // The upstream reason is deliberately not surfaced: it can carry
    // credentials or internal host detail.
    return {
      enabled: true,
      available: false,
      reason: "unreachable",
      capabilities: { ...UNSUPPORTED_CAPABILITIES },
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
  enabledConfig();
  const thread = await getDb().getCareerOpsThread(threadId, session.userId);
  if (!thread) throw new CareerOpsServiceError("not_found", "Not found");
  return thread;
}

export async function requireOwnedRun(
  session: CareerOpsSession,
  runId: string,
): Promise<{ run: CareerOpsRunRecord; thread: CareerOpsThreadRecord }> {
  enabledConfig();
  const run = await getDb().getCareerOpsRun(runId, session.userId);
  if (!run) throw new CareerOpsServiceError("not_found", "Not found");
  const thread = await getDb().getCareerOpsThread(run.threadId, session.userId);
  if (!thread) throw new CareerOpsServiceError("not_found", "Not found");
  return { run, thread };
}

export async function listCareerOpsThreads(
  session: CareerOpsSession,
): Promise<CareerOpsThreadRecord[]> {
  enabledConfig();
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
  const config = enabledConfig();
  const db = getDb();

  let applicationId: string | null = null;
  let title = (input.title ?? "").trim().slice(0, CAREER_OPS_MAX_TITLE_LENGTH);

  if (input.applicationId) {
    const owned = await db.verifyApplicationOwner(input.applicationId, session.userId);
    if (!owned) throw new CareerOpsServiceError("not_found", "Not found");
    applicationId = input.applicationId;
    if (!title) {
      const application = await db.getApplication(applicationId, session.userId);
      title = defaultTitle(
        typeof application?.company === "string" ? application.company : "",
        typeof application?.role === "string" ? application.role : "",
      );
    }
  }

  if (!title) title = "Career Ops";

  try {
    const session_ = await client(config).createSession({
      title: undefined,
      memoryScope: careerOpsMemoryScope(config, session.userId),
    });
    return await db.createCareerOpsThread(session.userId, {
      hermesSessionId: session_.id,
      title,
      applicationId,
    });
  } catch (reason) {
    throw toServiceError(reason);
  }
}

export async function deleteCareerOpsThread(
  session: CareerOpsSession,
  threadId: string,
): Promise<void> {
  const config = enabledConfig();
  const thread = await requireOwnedThread(session, threadId);

  // Remove the Nexus mapping first and unconditionally: leaving a mapping
  // behind because Hermes failed would keep a reachable pointer alive, which is
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
  const config = enabledConfig();
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
  const application = await getDb().getApplication(thread.applicationId, session.userId);
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
  const config = enabledConfig();

  const message = input.message.trim();
  if (!message || message.length > CAREER_OPS_MAX_MESSAGE_LENGTH) {
    throw new CareerOpsServiceError("invalid_request", "Invalid message");
  }
  if (!CAREER_OPS_CLIENT_REQUEST_ID_PATTERN.test(input.clientRequestId)) {
    throw new CareerOpsServiceError("invalid_request", "Invalid client request id");
  }

  const thread = await requireOwnedThread(session, threadId);
  const instructions = await threadInstructions(session, thread);
  const hermes = client(config);

  let runId: string;
  try {
    ({ runId } = await hermes.createRun({
      input: message,
      sessionId: thread.hermesSessionId,
      instructions,
      memoryScope: careerOpsMemoryScope(config, session.userId),
    }));
  } catch (reason) {
    throw toServiceError(reason);
  }

  const { run, created } = await getDb().createCareerOpsRun(session.userId, {
    threadId,
    hermesRunId: runId,
    clientRequestId: input.clientRequestId,
    status: "queued",
  });

  if (!created && run.hermesRunId !== runId) {
    // A concurrent duplicate won the uniqueness race. The run we just started
    // has no mapping, so nothing can ever address it — stop it best-effort so
    // it does not consume the upstream concurrency budget.
    void hermes.stopRun(runId).catch(() => undefined);
  }

  return run;
}

export async function getCareerOpsRunStatus(
  session: CareerOpsSession,
  runId: string,
): Promise<HermesRun> {
  const config = enabledConfig();
  const { run } = await requireOwnedRun(session, runId);
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
): Promise<{ upstream: ReadableStream<Uint8Array>; run: CareerOpsRunRecord }> {
  const config = enabledConfig();
  const { run } = await requireOwnedRun(session, runId);
  try {
    const upstream = await client(config).openRunEvents(run.hermesRunId, signal);
    return { upstream, run };
  } catch (reason) {
    throw toServiceError(reason);
  }
}

export async function stopCareerOpsRun(
  session: CareerOpsSession,
  runId: string,
): Promise<void> {
  const config = enabledConfig();
  const { run } = await requireOwnedRun(session, runId);
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
  const config = enabledConfig();
  if (!APPROVAL_CHOICES.includes(choice)) {
    throw new CareerOpsServiceError("invalid_request", "Invalid approval decision");
  }
  const { run } = await requireOwnedRun(session, runId);
  try {
    await client(config).resolveApproval(run.hermesRunId, choice);
  } catch (reason) {
    throw toServiceError(reason);
  }
}
