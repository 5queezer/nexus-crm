-- A conversation created against an application must never become a global one.
--
-- The application link is SET NULL on delete, which erased the only evidence
-- the conversation had ever been scoped: the next run read no application id,
-- took the global instructions, and a conversation the user had confined to one
-- opportunity gained authority over the whole CRM. This marker outlives the
-- link, so a scoped conversation whose application is gone refuses to run.
ALTER TABLE "CareerOpsThread"
  ADD COLUMN "applicationScoped" BOOLEAN NOT NULL DEFAULT false;

-- Existing scoped conversations keep their scope.
UPDATE "CareerOpsThread" SET "applicationScoped" = true WHERE "applicationId" IS NOT NULL;
