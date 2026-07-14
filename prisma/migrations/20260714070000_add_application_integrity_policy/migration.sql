-- Persist the normalized application-integrity attestation with each immutable submission.
ALTER TABLE "ApplicationSubmission"
  ADD COLUMN "policy" JSONB NOT NULL DEFAULT '{}'::jsonb;
