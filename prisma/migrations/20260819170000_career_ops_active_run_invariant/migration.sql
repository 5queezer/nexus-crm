-- At most one non-terminal run per Career Ops conversation.
--
-- The service used to enforce this by reading the latest run and then creating
-- a reservation, which two concurrent submissions could both pass. Only the
-- database can decide that race, so the invariant lives here as a partial
-- unique index. Terminal runs are excluded, so a conversation keeps its full
-- history while never holding two live agent runs against one Hermes session.
CREATE UNIQUE INDEX "CareerOpsRun_threadId_active_key"
  ON "CareerOpsRun" ("threadId")
  WHERE "status" IN ('queued', 'running', 'waiting_for_approval', 'stopping');
