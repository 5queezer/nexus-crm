ALTER TABLE "Application"
ADD COLUMN "nextAction" TEXT;

-- Backfill only explicit, persisted event evidence. Current status or stage
-- never imply a next action, so records without such evidence remain NULL.
UPDATE "Application" AS application
SET "nextAction" = (
  SELECT NULLIF(BTRIM(event."metadata"->>'nextAction'), '')
  FROM "ApplicationEvent" AS event
  WHERE event."applicationId" = application."id"
    AND event."userId" = application."userId"
    AND event."isDemo" = application."isDemo"
    AND jsonb_typeof(event."metadata"->'nextAction') = 'string'
    AND NULLIF(BTRIM(event."metadata"->>'nextAction'), '') IS NOT NULL
  ORDER BY event."occurredAt" DESC, event."id" DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "ApplicationEvent" AS event
  WHERE event."applicationId" = application."id"
    AND event."userId" = application."userId"
    AND event."isDemo" = application."isDemo"
    AND jsonb_typeof(event."metadata"->'nextAction') = 'string'
    AND NULLIF(BTRIM(event."metadata"->>'nextAction'), '') IS NOT NULL
);
