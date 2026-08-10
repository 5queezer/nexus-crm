import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/recover-production-db.yml", import.meta.url),
  "utf8",
);

describe("production database recovery workflow", () => {
  it("quiesces the compose service before counting, backing up, or migrating", () => {
    const stop = workflow.indexOf('timeout 45 docker compose -f docker-compose.yaml stop --timeout 30 "${service}"');
    const count = workflow.indexOf('count_before="$(db_count)"');
    const backup = workflow.indexOf('compose_run_bounded "${transition_backup_container}"');
    const migrate = workflow.indexOf('compose_run_bounded "${transition_migration_container}"');

    expect(stop).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(stop);
    expect(backup).toBeGreaterThan(stop);
    expect(migrate).toBeGreaterThan(stop);
  });

  it("only restarts after verification, bounds activation, and otherwise remains fail-closed", () => {
    const verified = workflow.indexOf('echo "Applications after migration: ${count_after}"');
    const restart = workflow.indexOf('timeout 120 docker compose -f docker-compose.yaml up -d "${service}"');

    const cleanup = workflow.match(/cleanup_transition_on_exit\(\) \{([\s\S]*?)\n          \}/)?.[1] ?? "";
    expect(restart).toBeGreaterThan(verified);
    expect(workflow).toContain("Service remains stopped; recovery did not reach verified activation.");
    expect(cleanup).not.toContain(" up -d");
  });
});
