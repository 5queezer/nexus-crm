-- Add admin flag used by the current Prisma schema and Better Auth flow.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false;
