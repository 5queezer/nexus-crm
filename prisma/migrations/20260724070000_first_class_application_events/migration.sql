ALTER TABLE "ApplicationEvent"
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "contactId" TEXT,
  ADD COLUMN "outcome" TEXT;

UPDATE "ApplicationEvent"
SET "requestHash" = "metadata"->>'requestHash'
WHERE "requestHash" IS NULL
  AND "metadata" IS NOT NULL
  AND "metadata" ? 'requestHash';

DROP INDEX IF EXISTS "ApplicationEvent_applicationId_occurredAt_idx";
DROP INDEX IF EXISTS "ApplicationEvent_userId_type_idx";

CREATE INDEX "ApplicationEvent_applicationId_occurredAt_id_idx"
  ON "ApplicationEvent"("applicationId", "occurredAt", "id");
CREATE INDEX "ApplicationEvent_userId_occurredAt_id_idx"
  ON "ApplicationEvent"("userId", "occurredAt", "id");
CREATE INDEX "ApplicationEvent_userId_type_occurredAt_idx"
  ON "ApplicationEvent"("userId", "type", "occurredAt");
CREATE INDEX "ApplicationEvent_userId_contactId_occurredAt_idx"
  ON "ApplicationEvent"("userId", "contactId", "occurredAt");
CREATE INDEX "ApplicationEvent_userId_outcome_occurredAt_idx"
  ON "ApplicationEvent"("userId", "outcome", "occurredAt");
