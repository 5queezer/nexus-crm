-- Safe creation defaults for new opportunities. Existing rows are unchanged.
ALTER TABLE "Application" ALTER COLUMN "status" SET DEFAULT 'inbound';

-- Structured opportunity metadata.
ALTER TABLE "Application"
  ADD COLUMN "canonicalJobUrl" TEXT,
  ADD COLUMN "workMode" TEXT,
  ADD COLUMN "eligibleCountries" JSONB,
  ADD COLUMN "primaryLocations" JSONB,
  ADD COLUMN "officeDaysMin" INTEGER,
  ADD COLUMN "travelPercent" INTEGER,
  ADD COLUMN "visaSponsorship" BOOLEAN,
  ADD COLUMN "rightToWorkRequired" BOOLEAN,
  ADD COLUMN "timezoneOverlap" TEXT,
  ADD COLUMN "salaryCurrency" TEXT,
  ADD COLUMN "salaryPeriod" TEXT,
  ADD COLUMN "salaryType" TEXT,
  ADD COLUMN "atsName" TEXT,
  ADD COLUMN "requisitionId" TEXT,
  ADD COLUMN "jobCapturedAt" TIMESTAMP(3),
  ADD COLUMN "jobVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "jobPostedAt" TIMESTAMP(3),
  ADD COLUMN "jobClosedAt" TIMESTAMP(3),
  ADD COLUMN "jobContentHash" TEXT,
  ADD COLUMN "jobLiveness" TEXT,
  ADD COLUMN "jobSummary" TEXT,
  ADD COLUMN "currentStage" TEXT;

CREATE UNIQUE INDEX "Application_userId_canonicalJobUrl_key" ON "Application"("userId", "canonicalJobUrl");
CREATE INDEX "Application_userId_followUpAt_idx" ON "Application"("userId", "followUpAt");
CREATE INDEX "Application_userId_status_idx" ON "Application"("userId", "status");

-- Immutable application submission snapshots.
CREATE TABLE "ApplicationSubmission" (
  "id" SERIAL NOT NULL,
  "userId" TEXT NOT NULL,
  "applicationId" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "applicationUrl" TEXT,
  "atsName" TEXT,
  "requisitionId" TEXT,
  "language" TEXT,
  "answers" JSONB NOT NULL,
  "candidateSalaryMin" INTEGER,
  "candidateSalaryMax" INTEGER,
  "candidateSalaryCurrency" TEXT,
  "candidateSalaryPeriod" TEXT,
  "candidateSalaryType" TEXT,
  "candidateSalaryFlexible" BOOLEAN NOT NULL DEFAULT false,
  "documentIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApplicationSubmission_userId_idempotencyKey_key" ON "ApplicationSubmission"("userId", "idempotencyKey");
CREATE INDEX "ApplicationSubmission_applicationId_submittedAt_idx" ON "ApplicationSubmission"("applicationId", "submittedAt");

-- Append-only lifecycle events.
CREATE TABLE "ApplicationEvent" (
  "id" SERIAL NOT NULL,
  "userId" TEXT NOT NULL,
  "applicationId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "source" TEXT,
  "actor" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApplicationEvent_userId_idempotencyKey_key" ON "ApplicationEvent"("userId", "idempotencyKey");
CREATE INDEX "ApplicationEvent_applicationId_occurredAt_idx" ON "ApplicationEvent"("applicationId", "occurredAt");
CREATE INDEX "ApplicationEvent_userId_type_idx" ON "ApplicationEvent"("userId", "type");

-- Document lifecycle metadata and exact submission linkage.
ALTER TABLE "Document"
  ADD COLUMN "documentType" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN "state" TEXT NOT NULL DEFAULT 'current',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "generatedAt" TIMESTAMP(3),
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "submissionId" INTEGER;

CREATE INDEX "Document_userId_documentType_state_idx" ON "Document"("userId", "documentType", "state");
CREATE INDEX "Document_submissionId_idx" ON "Document"("submissionId");

ALTER TABLE "ApplicationSubmission"
  ADD CONSTRAINT "ApplicationSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApplicationSubmission_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApplicationEvent"
  ADD CONSTRAINT "ApplicationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ApplicationSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
