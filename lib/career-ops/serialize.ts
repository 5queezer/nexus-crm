import type { CareerOpsRunRecord, CareerOpsThreadRecord } from "@/lib/db/types";

/**
 * Client-facing shapes.
 *
 * The Hermes session id deliberately never leaves the server: the browser
 * addresses conversations by their Nexus thread id, so a caller cannot present
 * an upstream identifier as authority.
 */

export type CareerOpsThreadView = {
  id: string;
  title: string;
  applicationId: string | null;
  /**
   * True when this conversation was created against an application that no
   * longer exists.
   *
   * Without it the browser reads a cleared link as "general conversation" and
   * presents a thread that refuses every run as the global one — including
   * selecting it as the default global thread. The server knows the difference;
   * the client cannot infer it.
   */
  scopeLost: boolean;
  /**
   * The browser's own key for the request that created this conversation.
   *
   * Echoed back so the browser can tell *its* creation from any other
   * conversation of the same scope: a creation whose response was lost is
   * recognised here by identity rather than by resemblance.
   */
  clientRequestId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * The linked opportunity, resolved live through the same agent-visible read the
 * run instructions use. Showing a stored label instead could name a record the
 * agent can no longer see, so a caller approving privileged work would be
 * verifying a target that is not the one in play.
 */
export type CareerOpsApplicationView = {
  id: string;
  company: string;
  role: string;
};

export type CareerOpsRunView = {
  id: string;
  threadId: string;
  status: string;
  clientRequestId: string;
  createdAt: string;
};

export function serializeThread(thread: CareerOpsThreadRecord): CareerOpsThreadView {
  return {
    id: thread.id,
    title: thread.title,
    applicationId: thread.applicationId,
    scopeLost: thread.applicationScoped && !thread.applicationId,
    clientRequestId: thread.clientRequestId,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

export function serializeRun(run: CareerOpsRunRecord): CareerOpsRunView {
  return {
    id: run.id,
    threadId: run.threadId,
    status: run.status,
    clientRequestId: run.clientRequestId,
    createdAt: run.createdAt.toISOString(),
  };
}
