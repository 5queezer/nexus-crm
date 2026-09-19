import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { parseStructuredApplicationMetadata } from "../../../lib/applications/metadata";
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
    applicationEvent: { findUnique: vi.fn().mockResolvedValue(null) },
    application: { create: vi.fn().mockResolvedValue({}) },
  };
  return { calls, db: calls as unknown as PrismaClient };
}

function statefulDatabase() {
  type StoredApplication = Record<string, unknown> & { id: number; userId: string; canonicalJobUrl: string | null };
  type StoredEvent = Record<string, unknown> & { applicationId: number; userId: string; idempotencyKey: string };
  const applications: StoredApplication[] = [];
  const events: StoredEvent[] = [];
  let nextApplicationId = 1;

  const createApplication = (data: Record<string, unknown>) => {
    const nestedEvents = (data.events as { create: Record<string, unknown>[] }).create;
    const application = {
      ...data,
      id: nextApplicationId++,
      canonicalJobUrl: (data.canonicalJobUrl as string | undefined) ?? null,
    } as StoredApplication;
    delete application.events;
    for (const event of nestedEvents) {
      const idempotencyKey = event.idempotencyKey as string;
      if (events.some(existing => existing.userId === application.userId && existing.idempotencyKey === idempotencyKey)) {
        throw new Error("Unique constraint failed on ApplicationEvent.userId_idempotencyKey");
      }
    }
    applications.push(application);
    events.push(...nestedEvents.map(event => ({
      ...event,
      applicationId: application.id,
      userId: application.userId,
      idempotencyKey: event.idempotencyKey as string,
    })));
    return application;
  };

  const db = {
    user: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => ({ id: where.email })),
      update: vi.fn().mockResolvedValue({}),
    },
    account: { findFirst: vi.fn().mockResolvedValue({ password: "stored-hash" }) },
    applicationEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        const key = where.userId_idempotencyKey;
        return events.find(event => event.userId === key.userId && event.idempotencyKey === key.idempotencyKey) ?? null;
      }),
    },
    application: {
      create: vi.fn().mockImplementation(async ({ data }) => createApplication(data)),
    },
  };

  return {
    db: db as unknown as PrismaClient,
    applications,
    events,
    deleteApplication(id: number) {
      const applicationIndex = applications.findIndex(application => application.id === id);
      if (applicationIndex >= 0) applications.splice(applicationIndex, 1);
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].applicationId === id) events.splice(index, 1);
      }
    },
  };
}

describe("local account and fixture seed", () => {
  it("uses immutable seed events so form edits survive reseeding and deleted fixtures can be recreated", async () => {
    const store = statefulDatabase();
    const verify = vi.fn().mockResolvedValue(true);

    await seedLocalData(store.db, vi.fn(), env, verify);
    expect(store.applications).toHaveLength(6);
    expect(store.events).toHaveLength(12);
    expect(store.applications.every(application => application.canonicalJobUrl === null)).toBe(true);

    const edited = store.applications.find(application =>
      application.userId === "admin@nexus.local" && application.company === "Northstar Labs (Fictional Demo)",
    );
    expect(edited).toBeDefined();
    // Match a record created by the previous seed version, then saved through the ordinary edit form.
    edited!.canonicalJobUrl = "https://local-fixtures.invalid/northstar-product-engineer";
    Object.assign(edited!, {
      ...parseStructuredApplicationMetadata({ jobUrl: null }),
      company: "Northstar Labs — renamed locally",
      notes: "Keep these local notes after setup runs again.",
    });

    await seedLocalData(store.db, vi.fn(), env, verify);
    expect(store.applications).toHaveLength(6);
    expect(store.events).toHaveLength(12);
    expect(edited).toMatchObject({
      canonicalJobUrl: null,
      company: "Northstar Labs — renamed locally",
      notes: "Keep these local notes after setup runs again.",
    });
    expect(new Set(store.events.map(event => `${event.userId}:${event.idempotencyKey}`)).size).toBe(12);

    const deleted = store.applications.find(application =>
      application.userId === "user@nexus.local" && application.company === "Bluebird Systems (Fictional Demo)",
    );
    expect(deleted).toBeDefined();
    store.deleteApplication(deleted!.id);
    await seedLocalData(store.db, vi.fn(), env, verify);
    expect(store.applications).toHaveLength(6);
    expect(store.events).toHaveLength(12);
    expect(store.applications.find(application =>
      application.userId === "user@nexus.local" && application.company === "Bluebird Systems (Fictional Demo)",
    )).toMatchObject({ canonicalJobUrl: null });
  });

  it("checks saved passwords and preserves edits while seeding each account separately", async () => {
    const { db, calls } = database(); const signUp = vi.fn(); const verify = vi.fn().mockResolvedValue(true);
    const accounts = await seedLocalData(db, signUp, env, verify);
    expect(signUp).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledWith({ hash: "stored-hash", password: "configured-user-password" });
    expect(accounts.map(account => account.isAdmin)).toEqual([true, false]);
    expect(calls.application.create).toHaveBeenCalledTimes(6);
    for (const [input] of calls.application.create.mock.calls) expect(input.data.canonicalJobUrl).toBeUndefined();
    expect(calls.user.update.mock.calls[1][0]).toMatchObject({ where: { id: "user@nexus.local" }, data: { isAdmin: false } });
  });
  it("fails on credential divergence before changing roles or fixture data", async () => {
    const { db, calls } = database();
    await expect(seedLocalData(db, vi.fn(), env, async () => false)).rejects.toThrow(/password does not match/);
    expect(calls.user.update).not.toHaveBeenCalled();
    expect(calls.application.create).not.toHaveBeenCalled();
  });
  it("preflights the regular account before mutating an otherwise valid admin", async () => {
    const { db, calls } = database();
    const verify = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(seedLocalData(db, vi.fn(), env, verify)).rejects.toThrow(/user password does not match/);
    expect(calls.user.update).not.toHaveBeenCalled();
    expect(calls.application.create).not.toHaveBeenCalled();
  });
  it("refuses unsafe databases before reading or writing users", async () => {
    const { db, calls } = database();
    await expect(seedLocalData(db, vi.fn(), { ...env, DATABASE_URL: "postgresql://local:local@remote.example/nexus_local_dev" }, async () => true)).rejects.toThrow(/loopback/);
    expect(calls.user.findUnique).not.toHaveBeenCalled();
  });
});
