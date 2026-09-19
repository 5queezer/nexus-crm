CREATE TABLE "BulkCommand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "runId" TEXT,
    "actionType" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "reason" TEXT,
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "requestHash" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "approvedDigest" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pauseRequestedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "undoRequestedAt" TIMESTAMP(3),
    "workerToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BulkCommand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkCommandItem" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT,
    "evidence" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "appliedVersion" INTEGER,
    "appliedBefore" JSONB,
    "appliedAfter" JSONB,
    "appliedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "undoStatus" TEXT,
    "undoExpectedVersion" INTEGER,
    "undoAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BulkCommandItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BulkCommand_supersedesId_key" ON "BulkCommand"("supersedesId");
CREATE UNIQUE INDEX "BulkCommand_userId_idempotencyKey_key" ON "BulkCommand"("userId", "idempotencyKey");
CREATE INDEX "BulkCommand_userId_status_createdAt_idx" ON "BulkCommand"("userId", "status", "createdAt");
CREATE INDEX "BulkCommand_status_leaseExpiresAt_createdAt_idx" ON "BulkCommand"("status", "leaseExpiresAt", "createdAt");
CREATE INDEX "BulkCommand_threadId_createdAt_idx" ON "BulkCommand"("threadId", "createdAt");
CREATE INDEX "BulkCommand_runId_createdAt_idx" ON "BulkCommand"("runId", "createdAt");
CREATE UNIQUE INDEX "BulkCommandItem_commandId_applicationId_key" ON "BulkCommandItem"("commandId", "applicationId");
CREATE UNIQUE INDEX "BulkCommandItem_userId_idempotencyKey_key" ON "BulkCommandItem"("userId", "idempotencyKey");
CREATE INDEX "BulkCommandItem_commandId_status_ordinal_idx" ON "BulkCommandItem"("commandId", "status", "ordinal");
CREATE INDEX "BulkCommandItem_commandId_undoStatus_ordinal_idx" ON "BulkCommandItem"("commandId", "undoStatus", "ordinal");
CREATE INDEX "BulkCommandItem_applicationId_userId_idx" ON "BulkCommandItem"("applicationId", "userId");

ALTER TABLE "BulkCommand" ADD CONSTRAINT "BulkCommand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkCommand" ADD CONSTRAINT "BulkCommand_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BulkCommand" ADD CONSTRAINT "BulkCommand_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BulkCommand" ADD CONSTRAINT "BulkCommand_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "BulkCommand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BulkCommandItem" ADD CONSTRAINT "BulkCommandItem_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "BulkCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkCommandItem" ADD CONSTRAINT "BulkCommandItem_applicationId_userId_isDemo_fkey" FOREIGN KEY ("applicationId", "userId", "isDemo") REFERENCES "Application"("id", "userId", "isDemo") ON DELETE CASCADE ON UPDATE CASCADE;
