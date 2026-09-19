-- Email integration shipped in the Prisma schema without a corresponding
-- baseline migration. Keep this repair additive so installations where these
-- tables were created manually or through `prisma db push` remain valid.

CREATE TABLE IF NOT EXISTS "EmailIntegration" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "lastHistoryId" TEXT,
    "scanFrequency" INTEGER NOT NULL DEFAULT 15,
    "autoImport" TEXT NOT NULL DEFAULT 'review',
    "scanDaysBack" INTEGER NOT NULL DEFAULT 7,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScannedEmail" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "classification" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'low',
    "extractedData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "applicationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannedEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailIntegration_userId_key"
    ON "EmailIntegration"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "ScannedEmail_userId_messageId_key"
    ON "ScannedEmail"("userId", "messageId");
CREATE INDEX IF NOT EXISTS "ScannedEmail_userId_status_idx"
    ON "ScannedEmail"("userId", "status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'EmailIntegration_userId_fkey'
          AND conrelid = '"EmailIntegration"'::regclass
    ) THEN
        ALTER TABLE "EmailIntegration"
            ADD CONSTRAINT "EmailIntegration_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ScannedEmail_userId_fkey'
          AND conrelid = '"ScannedEmail"'::regclass
    ) THEN
        ALTER TABLE "ScannedEmail"
            ADD CONSTRAINT "ScannedEmail_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
