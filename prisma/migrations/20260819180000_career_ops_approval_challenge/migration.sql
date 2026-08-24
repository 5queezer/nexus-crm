-- Single-use marker for the approval challenge a decision consumed.
-- Additive and nullable: existing rows keep working unchanged.
ALTER TABLE "CareerOpsRun" ADD COLUMN "approvalChallengeId" TEXT;
