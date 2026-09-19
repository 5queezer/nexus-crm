import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { seedLocalData } from "../seed-data";

const env = {
  NODE_ENV: "development", LOCAL_DEV_AUTH: "1", DB_PROVIDER: "prisma",
  DATABASE_URL: "postgresql://local:local@127.0.0.1:55441/nexus_local_dev", BETTER_AUTH_URL: "http://localhost:3001",
  LOCAL_DEV_ADMIN_EMAIL: "admin@nexus.local", LOCAL_DEV_USER_EMAIL: "user@nexus.local",
  LOCAL_DEV_ADMIN_PASSWORD: "configured-admin-password", LOCAL_DEV_USER_PASSWORD: "configured-user-password",
} as NodeJS.ProcessEnv;

function database() {
  const calls = {
    user: { findUnique: vi.fn().mockImplementation(async ({ where }) => ({ id: where.email })), update: vi.fn().mockResolvedValue({}) },
    account: { findFirst: vi.fn().mockResolvedValue({ password: "stored-hash" }) },
    application: { upsert: vi.fn().mockResolvedValue({}) },
  };
  return { calls, db: calls as unknown as PrismaClient };
}

describe("local account and fixture seed", () => {
  it("checks saved passwords and preserves edits while seeding each account separately", async () => {
    const { db, calls } = database(); const signUp = vi.fn(); const verify = vi.fn().mockResolvedValue(true);
    const accounts = await seedLocalData(db, signUp, env, verify);
    expect(signUp).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledWith({ hash: "stored-hash", password: "configured-user-password" });
    expect(accounts.map(account => account.isAdmin)).toEqual([true, false]);
    expect(calls.application.upsert).toHaveBeenCalledTimes(6);
    for (const [input] of calls.application.upsert.mock.calls) expect(input.update).toEqual({});
    expect(calls.user.update.mock.calls[1][0]).toMatchObject({ where: { id: "user@nexus.local" }, data: { isAdmin: false } });
  });
  it("fails on credential divergence before changing roles or fixture data", async () => {
    const { db, calls } = database();
    await expect(seedLocalData(db, vi.fn(), env, async () => false)).rejects.toThrow(/password does not match/);
    expect(calls.user.update).not.toHaveBeenCalled();
    expect(calls.application.upsert).not.toHaveBeenCalled();
  });
  it("preflights the regular account before mutating an otherwise valid admin", async () => {
    const { db, calls } = database();
    const verify = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(seedLocalData(db, vi.fn(), env, verify)).rejects.toThrow(/user password does not match/);
    expect(calls.user.update).not.toHaveBeenCalled();
    expect(calls.application.upsert).not.toHaveBeenCalled();
  });
  it("refuses unsafe databases before reading or writing users", async () => {
    const { db, calls } = database();
    await expect(seedLocalData(db, vi.fn(), { ...env, DATABASE_URL: "postgresql://local:local@remote.example/nexus_local_dev" }, async () => true)).rejects.toThrow(/loopback/);
    expect(calls.user.findUnique).not.toHaveBeenCalled();
  });
});
