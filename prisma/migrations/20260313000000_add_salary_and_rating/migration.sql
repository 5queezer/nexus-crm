-- AlterTable: add salaryMin, salaryMax, rating to Application
ALTER TABLE "Application" ADD COLUMN "salaryMin" INTEGER;
ALTER TABLE "Application" ADD COLUMN "salaryMax" INTEGER;
ALTER TABLE "Application" ADD COLUMN "rating" INTEGER;
