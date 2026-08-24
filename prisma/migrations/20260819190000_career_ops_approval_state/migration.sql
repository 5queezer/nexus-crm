-- Lifecycle of the last approval decision, so a decision that reached Hermes is
-- never invisible to Nexus because a later write failed.
-- Additive and nullable: existing rows keep working unchanged.
ALTER TABLE "CareerOpsRun" ADD COLUMN "approvalState" TEXT;
