import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

describe("demo workspace persistence schema", () => {
  it("defines tenant-safe workspaces and composite demo relations", () => {
    expect(schema).toContain("model DemoWorkspace");
    expect(schema).toMatch(/userId\s+String\s+@unique/);
    expect(schema).toMatch(/isDemo\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/demoWorkspaceId\s+Int\?/);
    expect(schema).toMatch(/demoKey\s+String\?/);
    expect(schema.match(/isDemo\s+Boolean\s+@default\(false\)/g)).toHaveLength(2);
    expect(schema).toMatch(/@@unique\(\[id, userId\]\)/);
    expect(schema.match(/fields: \[demoWorkspaceId, userId\], references: \[id, userId\]/g)).toHaveLength(2);
  });

  it("composite-constrains every event to its parent tenant and demo classification", () => {
    expect(schema).toMatch(/application\s+Application\s+@relation\(fields: \[applicationId, userId, isDemo\], references: \[id, userId, isDemo\]/);
    expect(schema).toMatch(/@@unique\(\[id, userId, isDemo\]\)/);
  });
});
