import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/20260810153500_add_demo_workspace/migration.sql", import.meta.url),
  "utf8",
);

describe("demo workspace migration", () => {
  it("keeps legacy event rows valid and enforces parent tenant/classification", () => {
    expect(migration).toContain('ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain('UNIQUE ("id", "userId", "isDemo")');
    expect(migration).toMatch(/FOREIGN KEY \("applicationId", "userId", "isDemo"\)[\s\S]*REFERENCES "Application"\("id", "userId", "isDemo"\)/);
  });

  it("enforces exact demo workspace equality for demo event children", () => {
    expect(migration).toContain('CREATE FUNCTION "check_application_event_demo_parent"()');
    expect(migration).toContain('parent."demoWorkspaceId" IS DISTINCT FROM NEW."demoWorkspaceId"');
    expect(migration).toContain('CREATE TRIGGER "ApplicationEvent_demo_parent_trigger"');
  });
});
