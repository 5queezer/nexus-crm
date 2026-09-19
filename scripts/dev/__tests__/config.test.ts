import { chmod, mkdtemp, readFile, writeFile, stat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureLocalConfig, loadLocalConfig } from "../config";

const roots: string[] = [];
async function root() { const value = await mkdtemp(path.join(tmpdir(), "nexus-dev-config-")); roots.push(value); return value; }
afterEach(async () => { await Promise.all(roots.splice(0).map(value => rm(value, { recursive: true, force: true }))); });

describe("local setup configuration", () => {
  it("creates private credentials once and reuses them on subsequent setup", async () => {
    const directory = await root();
    const first = await ensureLocalConfig(directory, { LOCAL_DEV_PORT: "3017", LOCAL_DEV_DB_PORT: "55447" });
    const original = await readFile(path.join(directory, ".env.local"), "utf8");
    const second = await ensureLocalConfig(directory, {});
    expect(await readFile(path.join(directory, ".env.local"), "utf8")).toBe(original);
    expect(second.env.BETTER_AUTH_SECRET).toBe(first.env.BETTER_AUTH_SECRET);
    expect(first.env.BETTER_AUTH_SECRET!.length).toBeGreaterThanOrEqual(32);
    expect(first.env.LOCAL_DEV_ADMIN_PASSWORD).not.toBe(first.env.LOCAL_DEV_USER_PASSWORD);
    expect(first.port).toBe(3017);
    expect(first.env.DATABASE_URL).toContain("@127.0.0.1:55447/nexus_local_dev");
    expect((await stat(path.join(directory, ".env.local"))).mode & 0o777).toBe(0o600);
  });
  it("refuses an existing production configuration without altering it", async () => {
    const directory = await root();
    const existing = 'DATABASE_URL="postgresql://owner:secret@production.example/nexus"\n';
    await writeFile(path.join(directory, ".env.local"), existing);
    await expect(ensureLocalConfig(directory, {})).rejects.toThrow();
    expect(await readFile(path.join(directory, ".env.local"), "utf8")).toBe(existing);
  });
  it("rejects production or hosted shells before creating any file", async () => {
    const directory = await root();
    await expect(ensureLocalConfig(directory, { NODE_ENV: "production" })).rejects.toThrow();
    await expect(ensureLocalConfig(directory, { VERCEL: "1" })).rejects.toThrow();
    await expect(readFile(path.join(directory, ".env.local"))).rejects.toThrow();
  });
  it("does not let inherited production connection settings override local configuration", async () => {
    const directory = await root();
    await ensureLocalConfig(directory, {});
    await expect(loadLocalConfig(directory, { DATABASE_URL: "postgresql://owner:secret@remote.example/nexus" })).rejects.toThrow(/DATABASE_URL/);
  });
  it("fails rather than regenerating missing configuration during startup", async () => {
    await expect(loadLocalConfig(await root(), {})).rejects.toThrow(/dev:setup/);
  });
  it("rejects mismatched Compose and database passwords", async () => {
    const directory = await root();
    await ensureLocalConfig(directory, {});
    const file = path.join(directory, ".env.local");
    await writeFile(file, (await readFile(file, "utf8")).replace(/LOCAL_DEV_DB_PASSWORD=.*/, 'LOCAL_DEV_DB_PASSWORD="different-password"'));
    await expect(loadLocalConfig(directory, {})).rejects.toThrow(/database credentials/);
  });
  it("does not inherit app secrets or a remote Docker target from the calling shell", async () => {
    const directory = await root();
    await ensureLocalConfig(directory, {});
    const { env } = await loadLocalConfig(directory, { PATH: "/usr/bin", EMAIL_SCAN_SECRET: "production-secret", EMAIL_TOKEN_ENCRYPTION_KEY: "production-key", MCP_OAUTH_SECRET: "production-mcp", DOCKER_HOST: "ssh://production", NODE_OPTIONS: "--require=/outside.js" });
    expect(env.PATH).toBe("/usr/bin");
    for (const key of ["EMAIL_SCAN_SECRET", "EMAIL_TOKEN_ENCRYPTION_KEY", "MCP_OAUTH_SECRET"]) expect(env[key]).toBe("");
    for (const key of ["DOCKER_HOST", "NODE_OPTIONS"]) expect(env[key]).toBeUndefined();
  });
  it("refuses world-readable credential files and symlinks", async () => {
    const directory = await root();
    await ensureLocalConfig(directory, {});
    const file = path.join(directory, ".env.local");
    await chmod(file, 0o644);
    await expect(loadLocalConfig(directory, {})).rejects.toThrow(/chmod 600/);
    const other = await root();
    await symlink(file, path.join(other, ".env.local"));
    await expect(loadLocalConfig(other, {})).rejects.toThrow(/symlink/);
  });
  it("rejects seed identities that differ only by email case", async () => {
    const directory = await root();
    await ensureLocalConfig(directory, {});
    const file = path.join(directory, ".env.local");
    await writeFile(file, (await readFile(file, "utf8")).replace(/LOCAL_DEV_USER_EMAIL=.*/, 'LOCAL_DEV_USER_EMAIL="Dev-Admin@Nexus.Local"'));
    await expect(loadLocalConfig(directory, {})).rejects.toThrow(/different email/);
  });
});
