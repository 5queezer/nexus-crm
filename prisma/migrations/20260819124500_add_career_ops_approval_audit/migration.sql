-- Minimal attribution for a human approval decision: the owning user and run
-- are already columns on this table, so only the decision and its timestamp are
-- added. The approval command payload and arguments are never stored.

ALTER TABLE "CareerOpsRun"
  ADD COLUMN "approvalChoice" TEXT,
  ADD COLUMN "approvalAt" TIMESTAMP(3);
