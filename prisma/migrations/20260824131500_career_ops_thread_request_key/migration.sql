-- Make conversation creation idempotent across a lost response.
--
-- The existing uniqueness key is (userId, hermesSessionId), and a retry mints a
-- fresh Hermes session before it reaches the database — so the key could never
-- catch it, and the user got a second upstream session and a duplicate
-- conversation. The browser's own request key is stable across that retry.
--
-- Nullable, and NULLs are distinct in a Postgres unique index, so rows created
-- before this column keep coexisting.
ALTER TABLE "CareerOpsThread" ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "CareerOpsThread_userId_clientRequestId_key"
  ON "CareerOpsThread"("userId", "clientRequestId");
