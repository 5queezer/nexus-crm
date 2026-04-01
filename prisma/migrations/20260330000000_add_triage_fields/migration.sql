-- AlterTable
ALTER TABLE "Application" ADD COLUMN "companySize" TEXT;
ALTER TABLE "Application" ADD COLUMN "salaryBandMentioned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Application" ADD COLUMN "triageQuality" INTEGER;
ALTER TABLE "Application" ADD COLUMN "triageReason" TEXT;
ALTER TABLE "Application" ADD COLUMN "incomingSource" TEXT;
ALTER TABLE "Application" ADD COLUMN "autoRejected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Application" ADD COLUMN "autoRejectReason" TEXT;
