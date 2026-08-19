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
  createdAt: string;
  updatedAt: string;
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
