-- Nexus-owned mapping between an authenticated user and a Hermes Career Ops
-- session. Additive only: no existing table or column is modified.

CREATE TABLE "CareerOpsThread" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "hermesSessionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "applicationId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareerOpsThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CareerOpsThread_userId_hermesSessionId_key"
  ON "CareerOpsThread"("userId", "hermesSessionId");
CREATE INDEX "CareerOpsThread_userId_updatedAt_idx"
  ON "CareerOpsThread"("userId", "updatedAt");
CREATE INDEX "CareerOpsThread_applicationId_idx"
  ON "CareerOpsThread"("applicationId");

ALTER TABLE "CareerOpsThread" ADD CONSTRAINT "CareerOpsThread_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The application link is advisory context, not ownership: deleting an
-- application must leave the conversation intact as a global thread.
ALTER TABLE "CareerOpsThread" ADD CONSTRAINT "CareerOpsThread_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CareerOpsRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "hermesRunId" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareerOpsRun_pkey" PRIMARY KEY ("id")
);

-- Makes run creation idempotent: the Hermes runs API has no request-level
-- idempotency, so a retried submission must collide here instead.
CREATE UNIQUE INDEX "CareerOpsRun_threadId_clientRequestId_key"
  ON "CareerOpsRun"("threadId", "clientRequestId");
CREATE INDEX "CareerOpsRun_userId_createdAt_idx"
  ON "CareerOpsRun"("userId", "createdAt");
CREATE INDEX "CareerOpsRun_threadId_createdAt_idx"
  ON "CareerOpsRun"("threadId", "createdAt");

ALTER TABLE "CareerOpsRun" ADD CONSTRAINT "CareerOpsRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareerOpsRun" ADD CONSTRAINT "CareerOpsRun_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "CareerOpsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
