-- CreateTable
CREATE TABLE "LlmCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "runId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "finishReason" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolInvocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "input" JSONB,
    "outputSummary" JSONB,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentToolInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "runId" TEXT,
    "toolInvocationId" TEXT,
    "kind" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expectedDiff" JSONB NOT NULL,
    "assumptions" JSONB,
    "baseVersion" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentVerificationResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "expected" JSONB NOT NULL,
    "actual" JSONB NOT NULL,
    "mismatches" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentVerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMcpConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "encryptedAuthorization" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMcpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCredential_userId_status_idx" ON "LlmCredential"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LlmCredential_userId_provider_key" ON "LlmCredential"("userId", "provider");

-- CreateIndex
CREATE INDEX "AgentThread_userId_updatedAt_idx" ON "AgentThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentMessage_userId_threadId_createdAt_idx" ON "AgentMessage"("userId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_runId_idx" ON "AgentMessage"("runId");

-- CreateIndex
CREATE INDEX "AgentRun_userId_threadId_startedAt_idx" ON "AgentRun"("userId", "threadId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_userId_status_idx" ON "AgentRun"("userId", "status");

-- CreateIndex
CREATE INDEX "AgentToolInvocation_userId_runId_createdAt_idx" ON "AgentToolInvocation"("userId", "runId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentToolInvocation_userId_status_idx" ON "AgentToolInvocation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ActionProposal_toolInvocationId_key" ON "ActionProposal"("toolInvocationId");

-- CreateIndex
CREATE INDEX "ActionProposal_userId_status_createdAt_idx" ON "ActionProposal"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ActionProposal_threadId_createdAt_idx" ON "ActionProposal"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionProposal_userId_idempotencyKey_key" ON "ActionProposal"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentVerificationResult_proposalId_key" ON "AgentVerificationResult"("proposalId");

-- CreateIndex
CREATE INDEX "AgentVerificationResult_userId_createdAt_idx" ON "AgentVerificationResult"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMcpConnection_userId_enabled_idx" ON "AgentMcpConnection"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMcpConnection_userId_name_key" ON "AgentMcpConnection"("userId", "name");

-- AddForeignKey
ALTER TABLE "LlmCredential" ADD CONSTRAINT "LlmCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolInvocation" ADD CONSTRAINT "AgentToolInvocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolInvocation" ADD CONSTRAINT "AgentToolInvocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProposal" ADD CONSTRAINT "ActionProposal_toolInvocationId_fkey" FOREIGN KEY ("toolInvocationId") REFERENCES "AgentToolInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVerificationResult" ADD CONSTRAINT "AgentVerificationResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVerificationResult" ADD CONSTRAINT "AgentVerificationResult_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ActionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMcpConnection" ADD CONSTRAINT "AgentMcpConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
