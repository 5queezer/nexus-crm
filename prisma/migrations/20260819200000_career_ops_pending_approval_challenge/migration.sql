-- The approval challenge currently outstanding for a run.
-- Only the outstanding challenge may be answered, so a token minted for an
-- earlier gate on the same run cannot authorize a later one.
-- Additive and nullable: existing rows keep working unchanged.
ALTER TABLE "CareerOpsRun" ADD COLUMN "pendingApprovalChallengeId" TEXT;
