ALTER TABLE "Document"
  ADD COLUMN "demoProvenance" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DemoWorkspace" (
  "id" SERIAL NOT NULL,
  "userId" TEXT NOT NULL,
  "seedVersion" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'creating',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DemoWorkspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DemoWorkspace_userId_key" ON "DemoWorkspace"("userId");
CREATE UNIQUE INDEX "DemoWorkspace_id_userId_key" ON "DemoWorkspace"("id", "userId");
CREATE INDEX "DemoWorkspace_state_idx" ON "DemoWorkspace"("state");
ALTER TABLE "DemoWorkspace" ADD CONSTRAINT "DemoWorkspace_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Application"
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "demoWorkspaceId" INTEGER,
  ADD COLUMN "demoKey" TEXT;
ALTER TABLE "Application" ADD CONSTRAINT "Application_demoWorkspaceId_userId_fkey"
  FOREIGN KEY ("demoWorkspaceId", "userId") REFERENCES "DemoWorkspace"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_demo_markers_check" CHECK (
  ("isDemo" = false AND "demoWorkspaceId" IS NULL AND "demoKey" IS NULL) OR
  ("isDemo" = true AND "demoWorkspaceId" IS NOT NULL AND "demoKey" IS NOT NULL)
);
CREATE INDEX "Application_userId_isDemo_createdAt_idx" ON "Application"("userId", "isDemo", "createdAt");
CREATE UNIQUE INDEX "Application_demoWorkspaceId_demoKey_key" ON "Application"("demoWorkspaceId", "demoKey");
ALTER TABLE "Application" ADD CONSTRAINT "Application_id_userId_isDemo_key"
  UNIQUE ("id", "userId", "isDemo");

ALTER TABLE "ApplicationEvent"
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "demoWorkspaceId" INTEGER,
  ADD COLUMN "demoKey" TEXT;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_demoWorkspaceId_userId_fkey"
  FOREIGN KEY ("demoWorkspaceId", "userId") REFERENCES "DemoWorkspace"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" DROP CONSTRAINT "ApplicationEvent_applicationId_fkey";
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_userId_isDemo_fkey"
  FOREIGN KEY ("applicationId", "userId", "isDemo") REFERENCES "Application"("id", "userId", "isDemo") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_demo_markers_check" CHECK (
  ("isDemo" = false AND "demoWorkspaceId" IS NULL AND "demoKey" IS NULL) OR
  ("isDemo" = true AND "demoWorkspaceId" IS NOT NULL AND "demoKey" IS NOT NULL)
);
CREATE INDEX "ApplicationEvent_userId_isDemo_occurredAt_id_idx" ON "ApplicationEvent"("userId", "isDemo", "occurredAt", "id");
CREATE UNIQUE INDEX "ApplicationEvent_demoWorkspaceId_demoKey_key" ON "ApplicationEvent"("demoWorkspaceId", "demoKey");

CREATE FUNCTION "check_application_event_demo_parent"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent "Application"%ROWTYPE;
BEGIN
  IF NEW."isDemo" THEN
    SELECT * INTO parent
    FROM "Application"
    WHERE "id" = NEW."applicationId"
      AND "userId" = NEW."userId"
      AND "isDemo" = NEW."isDemo";
    IF NOT FOUND OR parent."demoWorkspaceId" IS DISTINCT FROM NEW."demoWorkspaceId" THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'ApplicationEvent_demo_parent_check',
        MESSAGE = 'demo event workspace must match its application parent';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ApplicationEvent_demo_parent_trigger"
BEFORE INSERT OR UPDATE OF "applicationId", "userId", "isDemo", "demoWorkspaceId"
ON "ApplicationEvent"
FOR EACH ROW EXECUTE FUNCTION "check_application_event_demo_parent"();
