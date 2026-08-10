import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (available inside vi.mock factories) ──────────────────────

const { mockGetAll, stores, mockTimestamp, batchState, queryStats, applyUpdate } = vi.hoisted(() => {
  const stores = {
    applications: new Map<string, Record<string, unknown>>(),
    documents: new Map<string, Record<string, unknown>>(),
    contacts: new Map<string, Record<string, unknown>>(),
    applicationSubmissions: new Map<string, Record<string, unknown>>(),
    applicationEvents: new Map<string, Record<string, unknown>>(),
    applicationCanonicalUrls: new Map<string, Record<string, unknown>>(),
    demoWorkspaces: new Map<string, Record<string, unknown>>(),
    ownerApplicationLifecycles: new Map<string, Record<string, unknown>>(),
    cvPatches: new Map<string, Record<string, unknown>>(),
  };

  const mockGetAll = vi.fn();
  const mockTimestamp = { toDate: () => new Date("2025-01-01") };
  const batchState = {
    commitCount: 0,
    failOnCommit: null as number | null,
    beforeCommit: null as (() => void) | null,
  };
  const queryStats = {
    eventLimits: [] as number[],
    eventReadSizes: [] as number[],
  };
  const applyUpdate = (
    current: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Record<string, unknown> => {
    const next = { ...current };
    for (const [key, value] of Object.entries(update)) {
      if (value && typeof value === "object" && "__arrayRemove" in value) {
        const removed = (value as { __arrayRemove: unknown[] }).__arrayRemove;
        const existing = Array.isArray(next[key]) ? next[key] : [];
        next[key] = existing.filter((item) => !removed.includes(item));
      } else {
        next[key] = value;
      }
    }
    return next;
  };

  return { mockGetAll, stores, mockTimestamp, batchState, queryStats, applyUpdate };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface MockSnap {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
  ref: MockDocRef;
}

interface MockDocRef {
  id: string;
  __store: Map<string, Record<string, unknown>>;
  get: () => Promise<MockSnap>;
  update: (data: Record<string, unknown>) => Promise<void>;
  delete: () => Promise<void>;
}

function makeDocRef(store: Map<string, Record<string, unknown>>, id: string): MockDocRef {
  const ref: MockDocRef = {
    id,
    __store: store,
    async get(): Promise<MockSnap> {
      const data = store.get(id);
      return { id, exists: !!data, data: () => data, ref };
    },
    async update(d: Record<string, unknown>) {
      const existing = store.get(id);
      if (existing) store.set(id, applyUpdate(existing, d));
    },
    async delete() { store.delete(id); },
  };
  return ref;
}

function makeQuery(
  store: Map<string, Record<string, unknown>>,
  filters: Array<{ field: string; operator: string; value: unknown }> = [],
  sorts: Array<{ field: string; direction: "asc" | "desc" }> = [],
  max?: number,
  after?: unknown[],
) {
  const normalize = (item: unknown) => {
    if (item && typeof item === "object" && "toDate" in item) {
      return (item as { toDate: () => Date }).toDate().getTime();
    }
    if (item instanceof Date) return item.getTime();
    return item ?? "";
  };
  const fieldValue = (id: string, data: Record<string, unknown>, field: string) =>
    field === "__name__" ? id : data[field];
  const compareValues = (left: unknown, right: unknown) => {
    const a = normalize(left);
    const b = normalize(right);
    return a < b ? -1 : a > b ? 1 : 0;
  };
  return {
    where(field: string, operator: string, value: unknown) {
      if (!["==", "array-contains", "in", ">=", "<="].includes(operator)) {
        throw new Error(`Unsupported mock operator: ${operator}`);
      }
      return makeQuery(store, [...filters, { field, operator, value }], sorts, max, after);
    },
    orderBy(field: string, direction: "asc" | "desc" = "asc") {
      return makeQuery(store, filters, [...sorts, { field, direction }], max, after);
    },
    limit(value: number) {
      if (store === stores.applicationEvents) queryStats.eventLimits.push(value);
      return makeQuery(store, filters, sorts, value, after);
    },
    startAfter(...values: unknown[]) {
      return makeQuery(store, filters, sorts, max, values);
    },
    async get() {
      let entries = Array.from(store.entries()).filter(([id, data]) =>
        filters.every(({ field, operator, value }) => {
          const actual = fieldValue(id, data, field);
          if (operator === "==") return actual === value;
          if (operator === "array-contains") return Array.isArray(actual) && actual.includes(value);
          if (operator === "in") return Array.isArray(value) && value.includes(actual);
          const comparison = compareValues(actual, value);
          return operator === ">=" ? comparison >= 0 : comparison <= 0;
        }),
      );
      if (sorts.length) {
        entries.sort(([leftId, left], [rightId, right]) => {
          for (const sort of sorts) {
            const result = compareValues(
              fieldValue(leftId, left, sort.field),
              fieldValue(rightId, right, sort.field),
            );
            if (result) return sort.direction === "desc" ? -result : result;
          }
          return 0;
        });
      }
      if (after?.length) {
        entries = entries.filter(([id, data]) => {
          for (let index = 0; index < sorts.length; index += 1) {
            const sort = sorts[index];
            const result = compareValues(fieldValue(id, data, sort.field), after[index]);
            if (!result) continue;
            return sort.direction === "desc" ? result < 0 : result > 0;
          }
          return false;
        });
      }
      if (max !== undefined) entries = entries.slice(0, max);
      if (store === stores.applicationEvents) queryStats.eventReadSizes.push(entries.length);
      return {
        empty: entries.length === 0,
        docs: entries.map(([id, data]) => ({
          id,
          exists: true,
          data: () => data,
          ref: makeDocRef(store, id),
        })),
      };
    },
  };
}

function makeCollection(store: Map<string, Record<string, unknown>>) {
  return {
    ...makeQuery(store),
    doc: (id?: string) => makeDocRef(store, id ?? `auto-${store.size + 1}`),
    async add(data: Record<string, unknown>) {
      const id = `generated-${store.size + 1}`;
      store.set(id, data);
      return makeDocRef(store, id);
    },
  };
}

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{ name: "mock" }],
  initializeApp: vi.fn(),
  applicationDefault: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => {
      const s = stores[name as keyof typeof stores];
      return s ? makeCollection(s) : makeCollection(new Map());
    },
    getAll: mockGetAll,
    async runTransaction<T>(callback: (transaction: {
      get: (reference: { get: () => Promise<unknown> }) => Promise<unknown>;
      create: (ref: MockDocRef, data: Record<string, unknown>) => void;
      set: (ref: MockDocRef, data: Record<string, unknown>) => void;
      update: (ref: MockDocRef, data: Record<string, unknown>) => void;
      delete: (ref: MockDocRef) => void;
    }) => Promise<T>): Promise<T> {
      const writes: Array<() => void> = [];
      const result = await callback({
        get: (ref) => ref.get(),
        create: (ref, data) => {
          if (ref.__store.has(ref.id)) throw new Error("already_exists");
          writes.push(() => ref.__store.set(ref.id, data));
        },
        set: (ref, data) => {
          writes.push(() => ref.__store.set(ref.id, data));
        },
        update: (ref, data) => {
          if (!ref.__store.has(ref.id)) throw new Error("not_found");
          writes.push(() => ref.__store.set(ref.id, applyUpdate(ref.__store.get(ref.id)!, data)));
        },
        delete: (ref) => {
          writes.push(() => ref.__store.delete(ref.id));
        },
      });
      writes.forEach((write) => write());
      return result;
    },
    batch: () => {
      const writes: Array<() => void> = [];
      return {
        delete: (ref: MockDocRef) => writes.push(() => ref.__store.delete(ref.id)),
        update: (ref: MockDocRef, data: Record<string, unknown>) => writes.push(() => {
          const current = ref.__store.get(ref.id);
          if (!current) throw new Error("not_found");
          ref.__store.set(ref.id, applyUpdate(current, data));
        }),
        commit: async () => {
          batchState.commitCount += 1;
          if (batchState.failOnCommit === batchState.commitCount) throw new Error("injected_batch_failure");
          const beforeCommit = batchState.beforeCommit;
          batchState.beforeCommit = null;
          beforeCommit?.();
          writes.forEach((write) => write());
        },
      };
    },
  }),
  Timestamp: {
    now: () => mockTimestamp,
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
  FieldPath: {
    documentId: () => "__name__",
  },
  FieldValue: {
    serverTimestamp: () => mockTimestamp,
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { shareLink: { deleteMany: vi.fn() } },
}));

vi.mock("@/types", () => ({
  normalizeStatus: (s: string) => s,
  COMPANY_SIZE_OPTIONS: [
    { value: "micro", label: "< 50" },
    { value: "small", label: "50–500" },
    { value: "mid", label: "500–5k" },
    { value: "large", label: "5k+" },
    { value: "enterprise", label: "Enterprise" },
  ],
  INCOMING_SOURCE_OPTIONS: ["linkedin", "email", "referral", "outbound"],
}));

// ── Import adapter after mocks ──────────────────────────────────────────────

import { FirestoreAdapter } from "../firestore-adapter";
import type { RecordSubmissionInput } from "../types";
import {
  submissionInputRequestHash,
  submissionRequestHash,
} from "../../applications/submission";
import { createDemoFixtures } from "../../demo-workspace/fixtures";

// ── Test seed helpers ───────────────────────────────────────────────────────

function seedApps(apps: Array<{ id: string; userId: string; company: string; role: string }>) {
  stores.applications.clear();
  for (const app of apps) {
    stores.applications.set(app.id, { userId: app.userId, company: app.company, role: app.role });
  }
  // Wire getAll to resolve from the store
  mockGetAll.mockImplementation(async (...refs: Array<{ id: string }>) =>
    refs.map((r) => {
      const data = stores.applications.get(r.id);
      return {
        id: r.id,
        exists: !!data,
        data: () => data,
        ref: makeDocRef(stores.applications, r.id),
      };
    }),
  );
}

function seedDocs(docs: Array<{ id: string; userId: string; filename: string; originalName: string; size: number; mimeType: string; applicationIds: string[]; submissionId?: string | null }>) {
  stores.documents.clear();
  for (const d of docs) {
    stores.documents.set(d.id, {
      userId: d.userId,
      filename: d.filename,
      originalName: d.originalName,
      size: d.size,
      mimeType: d.mimeType,
      applicationIds: d.applicationIds,
      submissionId: d.submissionId ?? null,
      uploadedAt: mockTimestamp,
    });
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  batchState.commitCount = 0;
  batchState.failOnCommit = null;
  batchState.beforeCommit = null;
  queryStats.eventLimits = [];
  queryStats.eventReadSizes = [];
});

describe("FirestoreAdapter — demo workspace lifecycle", () => {
  beforeEach(() => {
    stores.applications.clear();
    stores.applicationEvents.clear();
    stores.demoWorkspaces.clear();
    stores.contacts.clear();
    stores.documents.clear();
    stores.applicationSubmissions.clear();
    stores.applicationCanonicalUrls.clear();
    stores.cvPatches.clear();
    stores.ownerApplicationLifecycles.clear();
  });

  it("creates deterministic owner-scoped demos, replays, filters, and deletes safely", async () => {
    const adapter = new FirestoreAdapter();
    const fixtures = createDemoFixtures(new Date("2026-08-10T12:00:00.000Z"));

    const created = await adapter.ensureDemoWorkspace("owner-1", fixtures);
    expect(created.replayed).toBe(false);
    expect(created.applications).toHaveLength(fixtures.applications.length);
    expect(await adapter.listApplications("owner-1", { demoVisibility: "exclude" })).toEqual([]);
    expect(await adapter.listApplications("owner-1", { demoVisibility: "only" })).toHaveLength(fixtures.applications.length);

    const replay = await adapter.ensureDemoWorkspace("owner-1", fixtures);
    expect(replay.replayed).toBe(true);
    expect(stores.applications.size).toBe(fixtures.applications.length);

    const demoApplication = replay.applications[0];
    const canonicalJobUrl = "https://demo.invalid/job/1";
    stores.applications.get(demoApplication.id)!.canonicalJobUrl = canonicalJobUrl;
    stores.contacts.set("demo-contact", { userId: "owner-1", applicationId: demoApplication.id });
    stores.applicationSubmissions.set("demo-submission", { userId: "owner-1", applicationId: demoApplication.id });
    stores.documents.set("demo-document", {
      userId: "owner-1", applicationIds: [demoApplication.id], submissionId: "demo-submission",
      state: "submitted", filename: "demo.pdf", originalName: "demo.pdf", size: 1, mimeType: "application/pdf",
    });
    stores.cvPatches.set(demoApplication.id, { userId: "owner-1", applicationId: demoApplication.id });
    stores.applicationCanonicalUrls.set(submissionRequestHash({ userId: "owner-1", canonicalJobUrl }), {
      userId: "owner-1", canonicalJobUrl, applicationId: demoApplication.id,
    });
    await adapter.createApplicationEvent(demoApplication.id, "owner-1", {
      type: "note_added", idempotencyKey: "delete-me", occurredAt: fixtures.createdAt, metadata: { note: "demo" },
    });

    stores.applications.set("foreign-real", { userId: "owner-2", company: "Real", role: "Role", isDemo: false, createdAt: mockTimestamp });
    const removed = await adapter.deleteDemoWorkspace("owner-1");
    expect(removed).toEqual({ deletedApplications: fixtures.applications.length, deletedEvents: fixtures.events.length + 1 });
    expect(stores.contacts.has("demo-contact")).toBe(false);
    expect(stores.applicationSubmissions.has("demo-submission")).toBe(false);
    expect(stores.cvPatches.has(demoApplication.id)).toBe(false);
    expect(stores.applicationCanonicalUrls.size).toBe(0);
    expect(stores.documents.get("demo-document")).toMatchObject({ applicationIds: [], submissionId: null, state: "historical" });
    expect(stores.applications.has("foreign-real")).toBe(true);
    await expect(adapter.deleteDemoWorkspace("owner-1")).resolves.toEqual({ deletedApplications: 0, deletedEvents: 0 });
  });

  it("rejects first creation when legacy real applications exist", async () => {
    const adapter = new FirestoreAdapter();
    stores.applications.set("legacy-real", { userId: "owner-1", company: "Legacy", role: "Real", createdAt: mockTimestamp });
    await expect(adapter.ensureDemoWorkspace("owner-1", createDemoFixtures())).rejects.toThrow("real_applications_exist");
    expect(stores.demoWorkspaces.size).toBe(0);
  });

  it("reconciles a stale real lifecycle sentinel after the last real application is gone", async () => {
    const adapter = new FirestoreAdapter();
    const lifecycleId = submissionRequestHash({ kind: "application-owner", userId: "owner-1" });
    stores.ownerApplicationLifecycles.set(lifecycleId, {
      userId: "owner-1",
      mode: "real",
      updatedAt: mockTimestamp,
    });
    expect(stores.applications.size).toBe(0);

    await expect(adapter.ensureDemoWorkspace("owner-1", createDemoFixtures()))
      .resolves.toMatchObject({ replayed: false });
    expect(stores.ownerApplicationLifecycles.get(lifecycleId)).toMatchObject({
      userId: "owner-1",
      mode: "demo",
    });
  });

  it("propagates demo markers to ordinary events without breaking fixture replay", async () => {
    const adapter = new FirestoreAdapter();
    const fixtures = createDemoFixtures(new Date("2026-08-10T12:00:00.000Z"));
    const created = await adapter.ensureDemoWorkspace("owner-1", fixtures);
    const application = created.applications[0];
    const eventInput = {
      type: "note_added" as const,
      idempotencyKey: "demo-note-1",
      occurredAt: new Date("2026-08-10T12:01:00.000Z"),
      metadata: { note: "Demo interaction" },
    };
    const event = await adapter.createApplicationEvent(application.id, "owner-1", eventInput);
    expect(event).toMatchObject({
      isDemo: true,
      demoWorkspaceId: created.workspace.id,
      demoKey: expect.stringContaining(`${application.demoKey}:event:`),
    });
    await expect(adapter.createApplicationEvent(application.id, "owner-1", eventInput))
      .resolves.toEqual(event);
    expect(Array.from(stores.applicationEvents.values()).map((row) => row.demoKey))
      .toEqual(expect.arrayContaining(fixtures.events.map((fixture) => fixture.demoKey)));
    await expect(adapter.ensureDemoWorkspace("owner-1", fixtures)).resolves.toMatchObject({ replayed: true });
  });

  it("requires ready exact owned fixture markers on replay", async () => {
    const adapter = new FirestoreAdapter();
    const fixtures = createDemoFixtures();
    await adapter.ensureDemoWorkspace("owner-1", fixtures);
    const workspace = Array.from(stores.demoWorkspaces.values())[0];
    workspace.state = "deleting";
    await expect(adapter.ensureDemoWorkspace("owner-1", fixtures)).rejects.toThrow("demo_workspace_unavailable");
    workspace.state = "ready";
    stores.applications.delete(Array.from(stores.applications.keys())[0]);
    await expect(adapter.ensureDemoWorkspace("owner-1", fixtures)).rejects.toThrow("demo_workspace_incomplete");
  });

  it("serializes normal creation against an existing demo lifecycle", async () => {
    const adapter = new FirestoreAdapter();
    await adapter.ensureDemoWorkspace("owner-1", createDemoFixtures());
    await expect(adapter.createApplication("owner-1", {
      company: "Real", role: "Engineer", status: "inbound", appliedAt: null,
      lastContact: null, followUpAt: null, notes: null, jobDescription: null,
      source: null, remote: false, salaryMin: null, salaryMax: null, rating: null, jobUrl: null,
    })).rejects.toThrow("demo_workspace_exists");
  });

  it("aborts deletion on inconsistent workspace markers", async () => {
    const adapter = new FirestoreAdapter();
    await adapter.ensureDemoWorkspace("owner-1", createDemoFixtures());
    const app = Array.from(stores.applications.values())[0];
    app.isDemo = false;
    await expect(adapter.deleteDemoWorkspace("owner-1")).rejects.toThrow("demo_marker_conflict");
    expect(stores.demoWorkspaces.size).toBe(1);
  });

  it("deletes events added after preparation while returning the stable preparation count", async () => {
    const adapter = new FirestoreAdapter();
    const fixtures = createDemoFixtures(new Date("2026-08-10T12:00:00.000Z"));
    const created = await adapter.ensureDemoWorkspace("owner-1", fixtures);
    const application = created.applications[0];

    batchState.beforeCommit = () => {
      stores.applicationEvents.set("concurrent-demo-event", {
        userId: "owner-1",
        applicationId: application.id,
        type: "note_added",
        occurredAt: mockTimestamp,
        isDemo: true,
        demoWorkspaceId: created.workspace.id,
        demoKey: `${application.demoKey}:event:concurrent`,
        createdAt: mockTimestamp,
      });
    };

    await expect(adapter.deleteDemoWorkspace("owner-1")).resolves.toEqual({
      deletedApplications: fixtures.applications.length,
      deletedEvents: fixtures.events.length,
    });
    expect(stores.applicationEvents.has("concurrent-demo-event")).toBe(false);
  });

  it("keeps deletion metadata fail-closed across a middle-cascade failure and fully retries", async () => {
    const adapter = new FirestoreAdapter();
    const fixtures = createDemoFixtures(new Date("2026-08-10T12:00:00.000Z"));
    await adapter.ensureDemoWorkspace("owner-1", fixtures);
    const applicationIds = [...stores.applications.keys()];
    const workspaceId = [...stores.demoWorkspaces.keys()][0];
    const lifecycleId = [...stores.ownerApplicationLifecycles.keys()][0];
    batchState.failOnCommit = 2;

    await expect(adapter.deleteDemoWorkspace("owner-1"))
      .rejects.toThrow("injected_batch_failure");

    expect(stores.demoWorkspaces.get(workspaceId)).toMatchObject({
      state: "deleting",
      deletionApplicationIds: applicationIds,
      deletionApplicationCount: fixtures.applications.length,
      deletionEventCount: fixtures.events.length,
    });
    expect(stores.ownerApplicationLifecycles.get(lifecycleId)).toMatchObject({
      mode: "deleting",
      workspaceId,
    });
    expect(stores.applications.size).toBeGreaterThan(0);
    expect(stores.applications.size).toBeLessThan(fixtures.applications.length);

    batchState.failOnCommit = null;
    await expect(adapter.deleteDemoWorkspace("owner-1")).resolves.toEqual({
      deletedApplications: fixtures.applications.length,
      deletedEvents: fixtures.events.length,
    });

    expect(stores.demoWorkspaces.size).toBe(0);
    expect(stores.ownerApplicationLifecycles.size).toBe(0);
    expect(stores.applications.size).toBe(0);
    expect(stores.applicationEvents.size).toBe(0);
    expect(stores.contacts.size).toBe(0);
    expect(stores.applicationSubmissions.size).toBe(0);
    expect(stores.applicationCanonicalUrls.size).toBe(0);
    expect(stores.cvPatches.size).toBe(0);
    expect(Array.from(stores.documents.values()).every((document) =>
      !applicationIds.some((id) => (document.applicationIds as string[] | undefined)?.includes(id))
    )).toBe(true);
  });
});

describe("FirestoreAdapter — application metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.applications.clear();
    stores.documents.clear();
    stores.contacts.clear();
    stores.applicationCanonicalUrls.clear();
  });

  it("persists structured opportunity metadata and keeps inbound unapplied", async () => {
    const adapter = new FirestoreAdapter();
    const result = await adapter.createApplication("user-1", {
      company: "Acme",
      role: "Senior Platform Engineer",
      status: "inbound",
      appliedAt: null,
      lastContact: null,
      followUpAt: null,
      notes: null,
      jobDescription: "Build a platform",
      source: "company-site",
      remote: true,
      salaryMin: 80_000,
      salaryMax: 100_000,
      rating: 5,
      jobUrl: "https://example.com/jobs/1",
      resumeId: null,
      canonicalJobUrl: "https://example.com/jobs/1",
      workMode: "remote",
      eligibleCountries: ["ES", "AT"],
      primaryLocations: ["Europe"],
      salaryCurrency: "EUR",
      salaryPeriod: "year",
      salaryType: "base",
      atsName: "greenhouse",
      requisitionId: "REQ-1",
      jobLiveness: "live",
    });

    expect(result.status).toBe("inbound");
    expect(result.appliedAt).toBeNull();
    expect(result.eligibleCountries).toEqual(["ES", "AT"]);
    expect(result.salaryCurrency).toBe("EUR");
    expect(result.requisitionId).toBe("REQ-1");
  });

  it("persists explicit real markers for direct and delegated batch creates", async () => {
    const adapter = new FirestoreAdapter();
    const input = {
      company: "Acme",
      role: "Engineer",
      status: "inbound" as const,
      appliedAt: null,
      lastContact: null,
      followUpAt: null,
      notes: null,
      jobDescription: null,
      source: null,
      remote: false,
      salaryMin: null,
      salaryMax: null,
      rating: null,
      jobUrl: null,
    };

    const direct = await adapter.createApplication("user-1", input);
    const batch = await adapter.batchUpsertApplications("user-1", [{
      company: "Beta",
      role: "Platform Engineer",
    }]);

    expect(stores.applications.get(direct.id)).toMatchObject({
      isDemo: false,
      demoWorkspaceId: null,
      demoKey: null,
    });
    expect(stores.applications.get(batch.results[0].id)).toMatchObject({
      isDemo: false,
      demoWorkspaceId: null,
      demoKey: null,
    });
  });

  it("atomically rejects duplicate canonical job URLs", async () => {
    const adapter = new FirestoreAdapter();
    const input = {
      company: "Acme",
      role: "Platform Engineer",
      status: "inbound" as const,
      appliedAt: null,
      lastContact: null,
      followUpAt: null,
      notes: null,
      jobDescription: null,
      source: "company-site",
      remote: true,
      salaryMin: null,
      salaryMax: null,
      rating: null,
      jobUrl: "https://example.com/jobs/1",
      resumeId: null,
      canonicalJobUrl: "https://example.com/jobs/1",
    };

    await adapter.createApplication("user-1", input);
    await expect(adapter.createApplication("user-1", input)).rejects.toThrow("canonical_job_url_conflict");
    expect(stores.applications.size).toBe(1);
    expect(stores.applicationCanonicalUrls.size).toBe(1);
  });
  it("routes batch creates through canonical URL uniqueness", async () => {
    const adapter = new FirestoreAdapter();
    const item = {
      company: "Acme",
      role: "Platform Engineer",
      status: "inbound" as const,
      canonicalJobUrl: "https://example.com/jobs/1",
    };

    const result = await adapter.batchUpsertApplications("user-1", [item, item]);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(stores.applications.size).toBe(1);
    expect(stores.applicationCanonicalUrls.size).toBe(1);
  });

  it("routes batch updates through deletion and canonical-index guards", async () => {
    const adapter = new FirestoreAdapter();
    const application = await adapter.createApplication("user-1", {
      company: "Acme",
      role: "Platform Engineer",
      status: "inbound",
      appliedAt: null,
      lastContact: null,
      followUpAt: null,
      notes: null,
      jobDescription: null,
      source: null,
      remote: true,
      salaryMin: null,
      salaryMax: null,
      rating: null,
      jobUrl: "https://example.com/jobs/1",
      resumeId: null,
      canonicalJobUrl: "https://example.com/jobs/1",
    });
    stores.applications.get(application.id)!.deletionState = "in_progress";

    const result = await adapter.batchUpsertApplications("user-1", [{
      id: application.id,
      canonicalJobUrl: "https://example.com/jobs/2",
    }]);
    expect(result.failed).toBe(1);
    expect(stores.applicationCanonicalUrls.size).toBe(1);
    expect(Array.from(stores.applicationCanonicalUrls.values())[0].canonicalJobUrl)
      .toBe("https://example.com/jobs/1");
  });

  it("rejects lifecycle fields in batch updates", async () => {
    const adapter = new FirestoreAdapter();
    const result = await adapter.batchUpsertApplications("user-1", [{
      id: "app-1",
      status: "interview",
    }]);

    expect(result).toMatchObject({
      succeeded: 0,
      failed: 1,
      results: [{ error: "lifecycle_event_required" }],
    });
  });
});

describe("FirestoreAdapter — retryable application deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(stores).forEach((store) => store.clear());
  });

  it("marks durable demo provenance while detaching a demo application without overwriting a concurrent document mutation", async () => {
    const adapter = new FirestoreAdapter();
    stores.applications.set("app-1", {
      userId: "user-1", company: "Acme", role: "Engineer", canonicalJobUrl: null, isDemo: true,
    });
    stores.documents.set("doc-1", {
      userId: "user-1",
      filename: "doc.pdf",
      originalName: "doc.pdf",
      size: 1,
      mimeType: "application/pdf",
      applicationIds: ["app-1", "app-2"],
      submissionId: null,
      state: "current",
      uploadedAt: mockTimestamp,
    });
    batchState.beforeCommit = () => {
      stores.documents.set("doc-1", {
        ...stores.documents.get("doc-1")!,
        applicationIds: ["app-1", "app-2", "app-3"],
        state: "superseded",
      });
    };

    await adapter.deleteApplication("app-1", "user-1");

    expect(stores.documents.get("doc-1")).toMatchObject({
      applicationIds: ["app-2", "app-3"],
      submissionId: null,
      state: "superseded",
      demoProvenance: true,
    });
  });

  it("preserves all submitted documents before deleting submissions and recovers after a later batch fails", async () => {
    const adapter = new FirestoreAdapter();
    stores.applications.set("app-1", {
      userId: "user-1", company: "Acme", role: "Engineer", canonicalJobUrl: null,
    });
    stores.applicationSubmissions.set("submission-1", {
      userId: "user-1", applicationId: "app-1",
    });
    for (let index = 0; index < 451; index += 1) {
      stores.documents.set(`doc-${index}`, {
        userId: "user-1",
        filename: `doc-${index}.pdf`,
        originalName: `doc-${index}.pdf`,
        size: 1,
        mimeType: "application/pdf",
        applicationIds: ["app-1"],
        submissionId: "submission-1",
        state: "submitted",
        uploadedAt: mockTimestamp,
      });
    }
    batchState.failOnCommit = 2;

    await expect(adapter.deleteApplication("app-1", "user-1"))
      .rejects.toThrow("injected_batch_failure");
    expect(stores.applicationSubmissions.has("submission-1")).toBe(true);
    expect(stores.documents.get("doc-0")).toMatchObject({
      applicationIds: [], submissionId: null, state: "historical",
    });
    expect(stores.documents.get("doc-450")).toMatchObject({
      applicationIds: ["app-1"], submissionId: "submission-1", state: "submitted",
    });

    batchState.failOnCommit = null;
    await adapter.deleteApplication("app-1", "user-1");

    expect(stores.applications.has("app-1")).toBe(false);
    expect(stores.applicationSubmissions.has("submission-1")).toBe(false);
    expect(Array.from(stores.documents.values()).every((document) =>
      Array.isArray(document.applicationIds)
      && document.applicationIds.length === 0
      && document.submissionId === null
      && document.state === "historical"
    )).toBe(true);
  });
});

describe("FirestoreAdapter — submission transaction", () => {
  const userId = "user-1";
  const submittedAt = new Date("2026-07-13T07:13:17Z");

  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(stores).forEach((store) => store.clear());
    mockGetAll.mockImplementation(async (...refs: MockDocRef[]) =>
      Promise.all(refs.map((ref) => ref.get())),
    );
    stores.applications.set("app-1", {
      userId,
      company: "Pleo",
      role: "Senior GenAI Platform Engineer",
      status: "inbound",
      appliedAt: null,
      notes: null,
      updatedAt: mockTimestamp,
      createdAt: mockTimestamp,
    });
    stores.documents.set("doc-1", {
      userId,
      filename: "cv.pdf",
      originalName: "cv.pdf",
      size: 100,
      mimeType: "application/pdf",
      documentType: "resume",
      state: "current",
      version: 1,
      applicationIds: ["app-1"],
      submissionId: null,
      uploadedAt: mockTimestamp,
    });
  });

  function input(answer = "Exact submitted answer"): RecordSubmissionInput {
    return {
      applicationId: "app-1",
      idempotencyKey: "pleo-submit-2026-07-13",
      submittedAt,
      followUpAt: new Date("2026-07-17T07:00:00Z"),
      answers: [{ question: "Why Pleo?", answer }],
      policy: {
        humanReviewed: true,
        identityConsistent: true,
        factsVerified: true,
        profileConsistencyStatus: "verified" as const,
      },
      candidateSalaryMin: 75_000,
      candidateSalaryMax: 75_000,
      candidateSalaryCurrency: "EUR",
      candidateSalaryPeriod: "year",
      candidateSalaryType: "base",
      candidateSalaryFlexible: true,
      documentIds: ["doc-1"],
      source: "test",
      actor: "user@example.com",
    };
  }

  function legacyInput(answer = "Exact submitted answer"): RecordSubmissionInput {
    const legacy: RecordSubmissionInput = { ...input(answer) };
    delete legacy.policy;
    return legacy;
  }

  function hashInput(value: RecordSubmissionInput) {
    return submissionInputRequestHash(value as unknown as Record<string, unknown>);
  }

  function seedLegacySubmission(value = legacyInput()) {
    const id = submissionRequestHash({ userId, key: value.idempotencyKey }).slice(0, 40);
    stores.applicationSubmissions.set(id, {
      userId,
      applicationId: value.applicationId,
      idempotencyKey: value.idempotencyKey,
      requestHash: (() => {
        const legacyHashInput = { ...value };
        delete legacyHashInput.policy;
        return hashInput(legacyHashInput);
      })(),
      submittedAt: { toDate: () => value.submittedAt },
      answers: value.answers,
      documentIds: value.documentIds,
      createdAt: mockTimestamp,
    });
    stores.documents.get("doc-1")!.state = "submitted";
    stores.documents.get("doc-1")!.submissionId = id;
    stores.documents.get("doc-1")!.submittedAt = { toDate: () => value.submittedAt };
    stores.applications.get("app-1")!.status = "applied";
    stores.applications.get("app-1")!.appliedAt = { toDate: () => value.submittedAt };
  }

  it("atomically records, verifies, and idempotently replays a package", async () => {
    const adapter = new FirestoreAdapter();
    const created = await adapter.recordApplicationSubmission(userId, input());

    expect(created.replayed).toBe(false);
    expect(created.verified).toBe(true);
    expect(created.application.status).toBe("applied");
    expect(created.submission.answers).toEqual([{ question: "Why Pleo?", answer: "Exact submitted answer" }]);
    expect(created.submission.policy).toMatchObject({
      humanReviewed: true,
      identityConsistent: true,
      factsVerified: true,
      profileConsistencyStatus: "verified",
      confirmedNoAnswers: false,
    });
    expect(created.documents[0].state).toBe("submitted");
    expect(stores.applicationSubmissions.size).toBe(1);
    expect(stores.applicationEvents.size).toBe(1);

    const replay = await adapter.recordApplicationSubmission(userId, input());
    expect(replay.replayed).toBe(true);
    expect(stores.applicationSubmissions.size).toBe(1);
    expect(stores.applicationEvents.size).toBe(1);
  });

  it("preserves existing ATS and requisition metadata when submission input omits them", async () => {
    stores.applications.get("app-1")!.atsName = "Greenhouse";
    stores.applications.get("app-1")!.requisitionId = "REQ-42";
    const adapter = new FirestoreAdapter();

    const created = await adapter.recordApplicationSubmission(userId, input());

    expect(created.submission.atsName).toBe("Greenhouse");
    expect(created.submission.requisitionId).toBe("REQ-42");
    expect(created.application.atsName).toBe("Greenhouse");
    expect(created.application.requisitionId).toBe("REQ-42");
  });

  it.each([undefined, null])(
    "replays a legacy package with policy %s without requiring a new attestation",
    async (policy) => {
      const stored = legacyInput();
      seedLegacySubmission(stored);
      const retry = { ...stored, policy };
      const adapter = new FirestoreAdapter();

      const replay = await adapter.recordApplicationSubmission(userId, retry);

      expect(replay.replayed).toBe(true);
      expect(stores.applicationSubmissions.size).toBe(1);
    },
  );

  it("replays legacy REST packages before rejecting their formerly truncated document shape", async () => {
    const rawDocumentIds = Array.from({ length: 21 }, () => "doc-1");
    const raw = { ...legacyInput(), source: "rest", documentIds: rawDocumentIds };
    const previouslyNormalized = {
      ...raw,
      atsName: null,
      requisitionId: null,
      documentIds: rawDocumentIds.slice(0, 20),
    };
    seedLegacySubmission(previouslyNormalized);
    const adapter = new FirestoreAdapter();

    const replay = await adapter.recordApplicationSubmission(userId, raw);

    expect(replay.replayed).toBe(true);
    expect(stores.applicationSubmissions.size).toBe(1);
  });

  it("returns idempotency_conflict before policy errors for a changed legacy retry", async () => {
    seedLegacySubmission();
    const adapter = new FirestoreAdapter();

    await expect(adapter.recordApplicationSubmission(userId, legacyInput("Changed")))
      .rejects.toThrow("idempotency_conflict");
  });

  it("blocks a new-key repeat submission without an audited reason", async () => {
    const adapter = new FirestoreAdapter();
    await adapter.recordApplicationSubmission(userId, input());

    await expect(adapter.recordApplicationSubmission(userId, {
      ...input(),
      idempotencyKey: "pleo-submit-repeat-2026-07-13",
      documentIds: ["doc-1"],
    })).rejects.toThrow("application_already_submitted");
    expect(stores.applicationSubmissions.size).toBe(1);
  });

  it("blocks an active same-company process in dry-run without writes", async () => {
    stores.applications.set("app-2", {
      userId,
      company: "  PLEO ",
      role: "Staff Engineer",
      status: "interview",
      appliedAt: mockTimestamp,
      updatedAt: mockTimestamp,
      createdAt: mockTimestamp,
    });
    const adapter = new FirestoreAdapter();

    await expect(adapter.recordApplicationSubmission(userId, { ...input(), dryRun: true }))
      .rejects.toThrow("same_company_active_application");
    expect(stores.applicationSubmissions.size).toBe(0);
    expect(stores.applicationEvents.size).toBe(0);
    expect(stores.documents.get("doc-1")!.state).toBe("current");
  });

  it("allows and persists a reasoned same-company override", async () => {
    stores.applications.set("app-2", {
      userId,
      company: "Pleo",
      role: "Staff Engineer",
      status: "applied",
      appliedAt: mockTimestamp,
      updatedAt: mockTimestamp,
      createdAt: mockTimestamp,
    });
    const adapter = new FirestoreAdapter();
    const created = await adapter.recordApplicationSubmission(userId, {
      ...input(),
      policy: { ...input().policy, sameCompanyOverrideReason: "Recruiter redirected me" },
    });

    expect(created.submission.policy.sameCompanyOverrideReason).toBe("Recruiter redirected me");
    expect(created.event?.metadata).toMatchObject({
      policy: { sameCompanyOverrideReason: "Recruiter redirected me" },
    });
  });

  it("blocks a duplicate requisition on another same-company record", async () => {
    stores.applications.set("app-2", {
      userId,
      company: "Pleo",
      role: "Other title",
      status: "rejected",
      requisitionId: "REQ-42",
      atsName: "Greenhouse",
      updatedAt: mockTimestamp,
      createdAt: mockTimestamp,
    });
    const adapter = new FirestoreAdapter();

    await expect(adapter.recordApplicationSubmission(userId, {
      ...input(),
      requisitionId: " req-42 ",
      atsName: "greenhouse",
    })).rejects.toThrow("duplicate_requisition");
    expect(stores.applicationSubmissions.size).toBe(0);
  });

  it("rejects reuse of a historical submission artifact without partial writes", async () => {
    const adapter = new FirestoreAdapter();
    stores.documents.get("doc-1")!.state = "historical";

    await expect(adapter.recordApplicationSubmission(userId, input()))
      .rejects.toThrow("document_already_submitted");
    expect(stores.applicationSubmissions.size).toBe(0);
    expect(stores.applicationEvents.size).toBe(0);
    expect(stores.documents.get("doc-1")).toMatchObject({ state: "historical", submissionId: null });
  });

  it("rejects the same idempotency key with a different payload", async () => {
    const adapter = new FirestoreAdapter();
    await adapter.recordApplicationSubmission(userId, input());

    await expect(
      adapter.recordApplicationSubmission(userId, input("Changed answer")),
    ).rejects.toThrow("idempotency_conflict");
  });

  it("validates dry-run without mutating application, document, or package stores", async () => {
    const adapter = new FirestoreAdapter();
    const result = await adapter.recordApplicationSubmission(userId, { ...input(), dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(stores.applications.get("app-1")!.status).toBe("inbound");
    expect(stores.documents.get("doc-1")!.state).toBe("current");
    expect(stores.applicationSubmissions.size).toBe(0);
    expect(stores.applicationEvents.size).toBe(0);
  });

  it("rejects cross-user submission attempts without partial writes", async () => {
    const adapter = new FirestoreAdapter();
    await expect(
      adapter.recordApplicationSubmission("other-user", input()),
    ).rejects.toThrow("not_found");
    expect(stores.applicationSubmissions.size).toBe(0);
    expect(stores.applicationEvents.size).toBe(0);
  });

  it("rejects writes while application deletion is in progress", async () => {
    const adapter = new FirestoreAdapter();
    stores.applications.get("app-1")!.deletionState = "in_progress";

    await expect(adapter.recordApplicationSubmission(userId, input())).rejects.toThrow("application_deleting");
    expect(stores.applicationSubmissions.size).toBe(0);
    expect(stores.applicationEvents.size).toBe(0);
  });

  it("rolls back the entire package when a referenced document is invalid", async () => {
    const adapter = new FirestoreAdapter();
    await expect(
      adapter.recordApplicationSubmission(userId, {
        ...input(),
        documentIds: ["doc-1", "missing-doc"],
      }),
    ).rejects.toThrow("invalid_documents");
    expect(stores.applications.get("app-1")!.status).toBe("inbound");
    expect(stores.documents.get("doc-1")!.state).toBe("current");
    expect(stores.applicationSubmissions.size).toBe(0);
    expect(stores.applicationEvents.size).toBe(0);
  });

  it("rejects stale optimistic-concurrency timestamps without writes", async () => {
    const adapter = new FirestoreAdapter();
    await expect(
      adapter.recordApplicationSubmission(userId, {
        ...input(),
        expectedUpdatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toThrow("conflict");
    expect(stores.applications.get("app-1")!.status).toBe("inbound");
    expect(stores.applicationSubmissions.size).toBe(0);
  });
});

describe("FirestoreAdapter — document operations", () => {
  let adapter: FirestoreAdapter;
  const userId = "user-1";

  beforeEach(() => {
    vi.clearAllMocks();
    stores.applications.clear();
    stores.documents.clear();
    stores.contacts.clear();
    adapter = new FirestoreAdapter();
  });

  it("excludes submitted and historical artifacts for base MCP scope", async () => {
    seedDocs([
      { id: "current", userId, filename: "a.pdf", originalName: "a.pdf", size: 1, mimeType: "application/pdf", applicationIds: [] },
      { id: "submitted", userId, filename: "b.pdf", originalName: "b.pdf", size: 1, mimeType: "application/pdf", applicationIds: [], submissionId: "submission-1" },
      { id: "historical", userId, filename: "c.pdf", originalName: "c.pdf", size: 1, mimeType: "application/pdf", applicationIds: [] },
    ]);
    stores.documents.get("current")!.state = "current";
    stores.documents.get("submitted")!.state = "submitted";
    stores.documents.get("historical")!.state = "historical";

    const documents = await adapter.listDocumentsFiltered(userId, { excludeSubmissionArtifacts: true });
    expect(documents.map((document) => document.id)).toEqual(["current"]);
  });

  describe("createDocument", () => {
    it("verifies linked applications transactionally", async () => {
      seedApps([
        { id: "app-1", userId, company: "Acme", role: "Dev" },
        { id: "app-2", userId, company: "Globex", role: "SRE" },
      ]);

      const result = await adapter.createDocument(userId, {
        filename: "resume.pdf",
        originalName: "resume.pdf",
        size: 1024,
        mimeType: "application/pdf",
        applicationIds: ["app-1", "app-2"],
      });

      expect(mockGetAll).not.toHaveBeenCalled();
      expect(result.applications).toHaveLength(2);
      expect(result.applications![0].company).toBe("Acme");
      expect(result.applications![1].company).toBe("Globex");
    });

    it("rejects apps not owned by the user without creating a document", async () => {
      seedApps([
        { id: "app-1", userId, company: "Acme", role: "Dev" },
        { id: "app-2", userId: "other-user", company: "Evil Corp", role: "Spy" },
      ]);

      await expect(adapter.createDocument(userId, {
        filename: "doc.pdf",
        originalName: "doc.pdf",
        size: 512,
        mimeType: "application/pdf",
        applicationIds: ["app-1", "app-2"],
      })).rejects.toThrow("invalid_applications");
      expect(stores.documents.size).toBe(0);
    });

    it("rejects links to applications being deleted", async () => {
      seedApps([{ id: "app-1", userId, company: "Acme", role: "Dev" }]);
      stores.applications.get("app-1")!.deletionState = "in_progress";

      await expect(adapter.createDocument(userId, {
        filename: "doc.pdf",
        originalName: "doc.pdf",
        size: 512,
        mimeType: "application/pdf",
        applicationIds: ["app-1"],
      })).rejects.toThrow("invalid_applications");
      expect(stores.documents.size).toBe(0);
    });

    it("rejects demo parents inside the creation transaction when guarded", async () => {
      seedApps([{ id: "demo-app", userId, company: "Demo", role: "Explorer" }]);
      stores.applications.get("demo-app")!.isDemo = true;

      await expect(adapter.createDocument(userId, {
        filename: "doc.pdf",
        originalName: "doc.pdf",
        size: 512,
        mimeType: "application/pdf",
        applicationIds: ["demo-app"],
      }, { requireNonDemoProvenance: true })).rejects.toThrow("invalid_applications");
      expect(stores.documents.size).toBe(0);
    });

    it("persists demo provenance when an interactive upload links a demo parent", async () => {
      seedApps([{ id: "demo-app", userId, company: "Demo", role: "Explorer" }]);
      stores.applications.get("demo-app")!.isDemo = true;

      const result = await adapter.createDocument(userId, {
        filename: "doc.pdf", originalName: "doc.pdf", size: 512,
        mimeType: "application/pdf", applicationIds: ["demo-app"],
      });

      expect(result.demoProvenance).toBe(true);
      expect(stores.documents.get(result.id)!.demoProvenance).toBe(true);
    });

    it("handles empty applicationIds without calling getAll", async () => {
      const result = await adapter.createDocument(userId, {
        filename: "empty.pdf",
        originalName: "empty.pdf",
        size: 256,
        mimeType: "application/pdf",
        applicationIds: [],
      });

      expect(mockGetAll).not.toHaveBeenCalled();
      expect(result.applications).toHaveLength(0);
    });

    it("rejects non-existent app IDs without creating a document", async () => {
      seedApps([
        { id: "app-1", userId, company: "Acme", role: "Dev" },
      ]);

      await expect(adapter.createDocument(userId, {
        filename: "test.pdf",
        originalName: "test.pdf",
        size: 100,
        mimeType: "application/pdf",
        applicationIds: ["app-1", "app-nonexistent"],
      })).rejects.toThrow("invalid_applications");
      expect(stores.documents.size).toBe(0);
    });
  });

  describe("updateDocumentLinks", () => {
    it("verifies ownership and uses batch getAll", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
      }]);
      seedApps([
        { id: "app-1", userId, company: "Acme", role: "Dev" },
        { id: "app-3", userId, company: "Initech", role: "PM" },
      ]);

      const result = await adapter.updateDocumentLinks("doc-1", userId, ["app-1", "app-3"]);

      expect(mockGetAll).toHaveBeenCalledTimes(1);
      expect(result.applications).toHaveLength(2);
    });

    it("keeps demo provenance sticky after relinking to a real parent", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
      }]);
      seedApps([
        { id: "demo-app", userId, company: "Demo", role: "Explorer" },
        { id: "real-app", userId, company: "Real", role: "Engineer" },
      ]);
      stores.applications.get("demo-app")!.isDemo = true;

      await adapter.updateDocumentLinks("doc-1", userId, ["demo-app"]);
      expect(stores.documents.get("doc-1")!.demoProvenance).toBe(true);
      await adapter.updateDocumentLinks("doc-1", userId, ["real-app"]);
      await expect(adapter.updateDocumentLinks("doc-1", userId, ["real-app"], { requireNonDemoProvenance: true }))
        .resolves.toMatchObject({ demoProvenance: true });
      await expect(adapter.updateDocumentMetadata("doc-1", userId, { version: 2 }, { requireNonDemoProvenance: true }))
        .resolves.toMatchObject({ version: 2, demoProvenance: true });
    });

    it("rejects if document not owned by user", async () => {
      seedDocs([{
        id: "doc-1", userId: "other-user", filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
      }]);

      await expect(
        adapter.updateDocumentLinks("doc-1", userId, ["app-1"]),
      ).rejects.toThrow("not_found");
    });

    it("rejects relinking an exact submitted document version", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: ["app-1"],
        submissionId: "submission-1",
      }]);

      await expect(
        adapter.updateDocumentLinks("doc-1", userId, []),
      ).rejects.toThrow("submitted_document_immutable");
    });
  });

  describe("guarded document mutation provenance", () => {
    const guard = { requireNonDemoProvenance: true } as const;

    function seedDemoOnlyDocument() {
      seedApps([{ id: "demo-app", userId, company: "Demo", role: "Explorer" }]);
      stores.applications.get("demo-app")!.isDemo = true;
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: ["demo-app"],
      }]);
    }

    it("rejects metadata, relink, and delete atomically for a demo-only document", async () => {
      seedDemoOnlyDocument();

      await expect(adapter.updateDocumentMetadata("doc-1", userId, { version: 2 }, guard))
        .rejects.toThrow("not_found");
      await expect(adapter.updateDocumentLinks("doc-1", userId, [], guard))
        .rejects.toThrow("not_found");
      await expect(adapter.deleteDocument("doc-1", userId, guard))
        .rejects.toThrow("not_found");

      expect(stores.documents.get("doc-1")!.version).not.toBe(2);
      expect(stores.documents.get("doc-1")!.applicationIds).toEqual(["demo-app"]);
      expect(stores.documents.has("doc-1")).toBe(true);
    });

    it("rejects guarded mutations for detached sticky demo provenance", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
      }]);
      stores.documents.get("doc-1")!.demoProvenance = true;

      await expect(adapter.updateDocumentMetadata("doc-1", userId, { version: 2 }, guard))
        .rejects.toThrow("not_found");
      await expect(adapter.updateDocumentLinks("doc-1", userId, [], guard))
        .rejects.toThrow("not_found");
      await expect(adapter.deleteDocument("doc-1", userId, guard))
        .rejects.toThrow("not_found");

      expect(stores.documents.get("doc-1")!).toMatchObject({ demoProvenance: true });
      expect(stores.documents.get("doc-1")!.version).toBeUndefined();
    });

    it("rejects guarded replacement links to demo applications", async () => {
      seedApps([
        { id: "real-app", userId, company: "Real", role: "Engineer" },
        { id: "demo-app", userId, company: "Demo", role: "Explorer" },
      ]);
      stores.applications.get("demo-app")!.isDemo = true;
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: ["real-app"],
      }]);

      await expect(adapter.updateDocumentLinks("doc-1", userId, ["demo-app"], guard))
        .rejects.toThrow("invalid_applications");
      expect(stores.documents.get("doc-1")!.applicationIds).toEqual(["real-app"]);
    });

    it("allows guarded mutation for unlinked and legacy-real documents", async () => {
      seedDocs([{
        id: "unlinked", userId, filename: "u.pdf", originalName: "u.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
      }]);
      await expect(adapter.updateDocumentMetadata("unlinked", userId, { version: 2 }, guard))
        .resolves.toMatchObject({ version: 2 });

      seedApps([{ id: "legacy-real", userId, company: "Real", role: "Engineer" }]);
      seedDocs([{
        id: "linked", userId, filename: "l.pdf", originalName: "l.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: ["legacy-real"],
      }]);
      await expect(adapter.updateDocumentMetadata("linked", userId, { version: 3 }, guard))
        .resolves.toMatchObject({ version: 3 });
    });
  });

  describe("renameDocument", () => {
    it("renames and resolves app refs via batch", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "old.pdf", originalName: "old.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: ["app-1"],
      }]);
      seedApps([
        { id: "app-1", userId, company: "Acme", role: "Dev" },
      ]);

      const result = await adapter.renameDocument("doc-1", userId, "new-name.pdf");

      expect(result).not.toBeNull();
      expect(result!.originalName).toBe("new-name.pdf");
      expect(result!.applications).toHaveLength(1);
      expect(mockGetAll).toHaveBeenCalledTimes(1);
    });

    it("returns null for document not owned by user", async () => {
      seedDocs([{
        id: "doc-1", userId: "other-user", filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
      }]);

      const result = await adapter.renameDocument("doc-1", userId, "nope.pdf");
      expect(result).toBeNull();
    });

    it("rejects renaming an exact submitted document version", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
        submissionId: "submission-1",
      }]);

      await expect(
        adapter.renameDocument("doc-1", userId, "changed.pdf"),
      ).rejects.toThrow("submitted_document_immutable");
    });
  });

  describe("submitted document lifecycle", () => {
    it("allows only the submitted-to-historical state transition", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
        submissionId: "submission-1",
      }]);
      stores.documents.get("doc-1")!.state = "submitted";

      const historical = await adapter.updateDocumentMetadata("doc-1", userId, {
        state: "historical",
      });
      expect(historical.state).toBe("historical");

      await expect(
        adapter.updateDocumentMetadata("doc-1", userId, { state: "submitted" }),
      ).rejects.toThrow("submitted_document_immutable");
      await expect(
        adapter.updateDocumentMetadata("doc-1", userId, { version: 2 }),
      ).rejects.toThrow("submitted_document_immutable");
    });

    it("keeps historical submitted artifacts immutable after their submission record is removed", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [], submissionId: null,
      }]);
      stores.documents.get("doc-1")!.state = "historical";

      await expect(adapter.renameDocument("doc-1", userId, "renamed.pdf"))
        .rejects.toThrow("submitted_document_immutable");
      await expect(adapter.updateDocumentLinks("doc-1", userId, []))
        .rejects.toThrow("submitted_document_immutable");
      await expect(adapter.deleteDocument("doc-1", userId))
        .rejects.toThrow("submitted_document_immutable");
      await expect(adapter.updateDocumentMetadata("doc-1", userId, { source: "changed" }))
        .rejects.toThrow("submitted_document_immutable");
      await expect(adapter.updateDocumentMetadata("doc-1", userId, { state: "submitted" }))
        .rejects.toThrow("submitted_document_immutable");
    });

    it("rejects deleting an exact submitted document version", async () => {
      seedDocs([{
        id: "doc-1", userId, filename: "f.pdf", originalName: "f.pdf",
        size: 100, mimeType: "application/pdf", applicationIds: [],
        submissionId: "submission-1",
      }]);

      await expect(adapter.deleteDocument("doc-1", userId)).rejects.toThrow(
        "submitted_document_immutable",
      );
    });
  });

  describe("large application link sets", () => {
    it("verifies 35 linked applications in one transaction", async () => {
      const apps = Array.from({ length: 35 }, (_, i) => ({
        id: `app-${i}`, userId, company: `Co-${i}`, role: "Eng",
      }));
      seedApps(apps);

      const result = await adapter.createDocument(userId, {
        filename: "big.pdf",
        originalName: "big.pdf",
        size: 9999,
        mimeType: "application/pdf",
        applicationIds: apps.map((a) => a.id),
      });

      expect(mockGetAll).not.toHaveBeenCalled();
      expect(result.applications).toHaveLength(35);
    });
  });
});

describe("FirestoreAdapter — first-class application events", () => {
  const userId = "user-1";

  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(stores).forEach((store) => store.clear());
    mockGetAll.mockImplementation(async (...refs: MockDocRef[]) =>
      Promise.all(refs.map((ref) => ref.get())),
    );
  });

  function seedEventApplication() {
    stores.applications.set("app-1", {
      userId,
      company: "Acme",
      role: "Engineer",
      status: "applied",
      currentStage: "recruiter_screen",
      followUpAt: { toDate: () => new Date("2026-07-25T10:00:00Z") },
      createdAt: mockTimestamp,
      updatedAt: mockTimestamp,
    });
  }

  it("atomically records an interview schedule and updates the projection", async () => {
    seedEventApplication();
    const adapter = new FirestoreAdapter();
    const result = await adapter.recordApplicationEvent("app-1", userId, {
      type: "interview_scheduled",
      occurredAt: new Date("2026-07-24T09:00:00Z"),
      idempotencyKey: "schedule-123",
      source: "test",
      metadata: {
        interviewType: "technical",
        scheduledAt: "2026-07-28T12:30:00.000Z",
      },
      contactId: null,
      outcome: null,
    });

    expect(result.replayed).toBe(false);
    expect(result.application).toMatchObject({ status: "interview", currentStage: "interview_scheduled" });
    expect(result.application.followUpAt?.toISOString()).toBe("2026-07-28T12:30:00.000Z");
    expect(result.event.metadata).toMatchObject({
      fromStage: "recruiter_screen",
      toStage: "interview_scheduled",
      fromStatus: "applied",
      toStatus: "interview",
    });
    expect(stores.applicationEvents.size).toBe(1);
    expect(result.event.metadata).not.toHaveProperty("requestHash");
    expect([...stores.applicationEvents.values()][0].requestHash).toEqual(expect.any(String));
  });

  it("touches the application for event-only commands", async () => {
    seedEventApplication();
    stores.applications.get("app-1")!.updatedAt = { toDate: () => new Date("2024-01-01") };

    const result = await new FirestoreAdapter().recordApplicationEvent("app-1", userId, {
      type: "note_added",
      occurredAt: new Date("2026-07-24T09:00:00Z"),
      source: "test",
      metadata: { note: "Chronological update" },
      contactId: null,
      outcome: null,
    });

    expect(result.application.updatedAt.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(stores.applicationEvents.size).toBe(1);
  });

  it("replays the same command once and rejects a changed payload", async () => {
    seedEventApplication();
    const adapter = new FirestoreAdapter();
    const base = {
      type: "follow_up_scheduled" as const,
      occurredAt: new Date("2026-07-24T09:00:00Z"),
      idempotencyKey: "follow-up-123",
      source: "test",
      metadata: { followUpAt: "2026-07-30T09:00:00.000Z" },
      contactId: null,
      outcome: null,
    };
    await adapter.recordApplicationEvent("app-1", userId, base);
    const replay = await adapter.recordApplicationEvent("app-1", userId, base);
    expect(replay.replayed).toBe(true);
    expect(stores.applicationEvents.size).toBe(1);
    await expect(adapter.recordApplicationEvent("app-1", userId, {
      ...base,
      metadata: { followUpAt: "2026-07-31T09:00:00.000Z" },
    })).rejects.toThrow("idempotency_conflict");
  });

  it("replays a legacy idempotency hash after migration", async () => {
    seedEventApplication();
    const command = {
      type: "follow_up_scheduled" as const,
      occurredAt: new Date("2026-07-24T09:00:00Z"),
      idempotencyKey: "legacy-follow-up",
      source: "test",
      metadata: { followUpAt: "2026-07-30T09:00:00.000Z" },
      contactId: null,
      outcome: null,
    };
    const legacyHash = submissionRequestHash({
      applicationId: "app-1",
      type: command.type,
      occurredAt: command.occurredAt,
      metadata: command.metadata,
    });
    const eventId = submissionRequestHash({ userId, key: command.idempotencyKey }).slice(0, 40);
    stores.applicationEvents.set(eventId, {
      userId,
      applicationId: "app-1",
      type: command.type,
      idempotencyKey: command.idempotencyKey,
      occurredAt: mockTimestamp,
      createdAt: mockTimestamp,
      metadata: { ...command.metadata, requestHash: legacyHash },
    });

    const replay = await new FirestoreAdapter().recordApplicationEvent("app-1", userId, command);
    expect(replay.replayed).toBe(true);
    expect(replay.event.metadata).not.toHaveProperty("requestHash");
    expect(replay.event).not.toHaveProperty("requestHash");
    expect(stores.applicationEvents.size).toBe(1);
  });

  it.each([
    {
      label: "contact",
      seed: () => stores.contacts.set("contact-1", { applicationId: "other-app", name: "Recruiter" }),
      input: { contactId: "contact-1", metadata: { toStage: "technical" } },
      code: "contact_not_found",
    },
    {
      label: "document",
      seed: () => stores.documents.set("document-1", { userId, applicationIds: ["other-app"] }),
      input: { contactId: null, metadata: { toStage: "technical", documentId: "document-1" } },
      code: "document_not_found",
    },
    {
      label: "submission",
      seed: () => stores.applicationSubmissions.set("submission-1", { userId, applicationId: "other-app" }),
      input: { contactId: null, metadata: { toStage: "technical", submissionId: "submission-1" } },
      code: "submission_not_found",
    },
  ])("rejects a linked $label outside the owner/application boundary", async ({ seed, input, code }) => {
    seedEventApplication();
    seed();
    await expect(new FirestoreAdapter().recordApplicationEvent("app-1", userId, {
      type: "stage_changed",
      occurredAt: new Date("2026-07-24T09:00:00Z"),
      idempotencyKey: `missing-${code}`,
      source: "test",
      outcome: null,
      ...input,
    })).rejects.toThrow(code);
    expect(stores.applicationEvents.size).toBe(0);
  });

  it("rejects stale commands without writing an event", async () => {
    seedEventApplication();
    const adapter = new FirestoreAdapter();
    await expect(adapter.recordApplicationEvent("app-1", userId, {
      type: "application_rejected",
      occurredAt: new Date("2026-07-24T09:00:00Z"),
      expectedUpdatedAt: new Date("2026-01-01T00:00:00Z"),
      metadata: { outcome: "declined" },
      contactId: null,
      outcome: "declined",
    })).rejects.toThrow("conflict");
    expect(stores.applicationEvents.size).toBe(0);
    expect(stores.applications.get("app-1")!.status).toBe("applied");
  });

  it("allows unrelated updates to preserve an oversized legacy summary unchanged", async () => {
    seedEventApplication();
    const legacyNotes = "x".repeat(10_001);
    stores.applications.set("app-1", { ...stores.applications.get("app-1")!, notes: legacyNotes });
    await expect(new FirestoreAdapter().updateApplication("app-1", userId, {
      company: "Acme 2",
      notes: legacyNotes,
    })).resolves.toMatchObject({ company: "Acme 2", notes: legacyNotes });
  });

  it("still rejects a newly changed oversized summary", async () => {
    seedEventApplication();
    stores.applications.set("app-1", { ...stores.applications.get("app-1")!, notes: "legacy" });
    await expect(new FirestoreAdapter().updateApplication("app-1", userId, {
      notes: "x".repeat(10_001),
    })).rejects.toThrow("notes_too_long");
  });

  it("skips sparse scan windows before returning a filtered page", async () => {
    seedApps([
      { id: "app-acme", userId, company: "Acme", role: "Engineer" },
      { id: "app-beta", userId, company: "Beta", role: "Engineer" },
    ]);
    const timestamp = { toDate: () => new Date("2026-07-24T09:00:00Z") };
    for (let id = 1; id <= 7; id += 1) {
      stores.applicationEvents.set(String(id), {
        userId,
        applicationId: id === 1 ? "app-beta" : "app-acme",
        type: "stage_changed",
        occurredAt: timestamp,
        createdAt: timestamp,
      });
    }
    const adapter = new FirestoreAdapter();
    const page = await adapter.listApplicationEventsFiltered(userId, {
      company: "Beta", order: "newest", limit: 1,
    });
    expect(page.items.map((event) => event.id)).toEqual(["1"]);
    expect(page.nextCursor).toBeNull();
  });

  it("keeps fixture event keys visible when workspace markers agree with their parents", async () => {
    const adapter = new FirestoreAdapter();
    const fixtures = createDemoFixtures(new Date("2026-08-10T12:00:00.000Z"));
    await adapter.ensureDemoWorkspace(userId, fixtures);

    const page = await adapter.listApplicationEventsFiltered(userId, {
      order: "newest",
      limit: 20,
    }, { demoVisibility: "only" });

    expect(page.items).toHaveLength(fixtures.events.length);
    expect(page.items.every((event) => event.application?.company.includes("Fictional Demo")))
      .toBe(true);
  });

  it("validates parent visibility and marker agreement before filtered pagination", async () => {
    const timestamp = { toDate: () => new Date("2026-07-24T09:00:00Z") };
    stores.applications.set("demo-app", {
      userId,
      company: "Demo",
      role: "Engineer",
      isDemo: true,
      demoWorkspaceId: "workspace-1",
      demoKey: "demo-app",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    stores.applications.set("real-app", {
      userId,
      company: "Real",
      role: "Engineer",
      isDemo: false,
      demoWorkspaceId: null,
      demoKey: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    for (let index = 99; index >= 40; index -= 1) {
      const applicationId = index % 3 === 0 ? "missing-app" : index % 3 === 1 ? "demo-app" : "real-app";
      const childClaimsDemo = applicationId === "real-app";
      stores.applicationEvents.set(String(index).padStart(3, "0"), {
        userId,
        applicationId,
        type: "stage_changed",
        occurredAt: timestamp,
        createdAt: timestamp,
        isDemo: childClaimsDemo,
        demoWorkspaceId: childClaimsDemo ? "mismatched-workspace" : null,
        demoKey: childClaimsDemo ? `mismatch:event:${index}` : null,
      });
    }
    stores.applicationEvents.set("002", {
      userId,
      applicationId: "real-app",
      type: "stage_changed",
      occurredAt: timestamp,
      createdAt: timestamp,
      isDemo: false,
      demoWorkspaceId: null,
      demoKey: null,
    });
    stores.applicationEvents.set("001", {
      userId,
      applicationId: "real-app",
      type: "stage_changed",
      occurredAt: timestamp,
      createdAt: timestamp,
      isDemo: false,
      demoWorkspaceId: null,
      demoKey: null,
    });
    const adapter = new FirestoreAdapter();

    const first = await adapter.listApplicationEventsFiltered(userId, {
      order: "newest",
      limit: 1,
    }, { demoVisibility: "exclude" });
    expect(first.items.map((event) => event.id)).toEqual(["002"]);
    expect(first.items[0].application?.company).toBe("Real");
    expect(first.nextCursor).toBeTruthy();

    const { decodeEventCursor } = await import("../../applications/events");
    const second = await adapter.listApplicationEventsFiltered(userId, {
      order: "newest",
      limit: 1,
      cursor: decodeEventCursor(first.nextCursor!),
    }, { demoVisibility: "exclude" });
    expect(second.items.map((event) => event.id)).toEqual(["001"]);
    expect(second.nextCursor).toBeNull();
    expect(queryStats.eventReadSizes.some((size) => size === 50)).toBe(true);
  });

  it("validates child marker agreement before applying an application timeline limit", async () => {
    stores.applications.set("app-1", {
      userId,
      company: "Acme Demo",
      role: "Engineer",
      isDemo: true,
      demoWorkspaceId: "workspace-1",
      demoKey: "app-1",
      createdAt: mockTimestamp,
      updatedAt: mockTimestamp,
    });
    const timestamp = { toDate: () => new Date("2026-07-24T09:00:00Z") };
    stores.applicationEvents.set("2", {
      userId,
      applicationId: "app-1",
      type: "stage_changed",
      occurredAt: timestamp,
      createdAt: timestamp,
      isDemo: false,
      demoWorkspaceId: null,
      demoKey: null,
    });
    stores.applicationEvents.set("1", {
      userId,
      applicationId: "app-1",
      type: "stage_changed",
      occurredAt: timestamp,
      createdAt: timestamp,
      isDemo: true,
      demoWorkspaceId: "workspace-1",
      demoKey: "app-1:event:1",
    });

    const events = await new FirestoreAdapter().listApplicationEvents(
      "app-1",
      userId,
      1,
      { demoVisibility: "include" },
    );

    expect(events.map((event) => event.id)).toEqual(["1"]);
  });

  it("applies legacy timeline limits before reading Firestore events", async () => {
    seedApps([{ id: "app-1", userId, company: "Acme", role: "Engineer" }]);
    const timestamp = { toDate: () => new Date("2026-07-24T09:00:00Z") };
    for (let id = 1; id <= 5; id += 1) {
      stores.applicationEvents.set(String(id), {
        userId,
        applicationId: "app-1",
        type: "stage_changed",
        occurredAt: timestamp,
        createdAt: timestamp,
      });
    }

    const events = await new FirestoreAdapter().listApplicationEvents(
      "app-1",
      userId,
      2,
    );

    expect(events).toHaveLength(2);
    expect(queryStats.eventLimits).toEqual([2]);
    expect(queryStats.eventReadSizes).toEqual([2]);
  });

  it("uses the same lexical ID tie-breaker for sorting and cursors", async () => {
    seedApps([{ id: "app-1", userId, company: "Acme", role: "Engineer" }]);
    const timestamp = { toDate: () => new Date("2026-07-24T09:00:00Z") };
    stores.applicationEvents.set("2", { userId, applicationId: "app-1", type: "stage_changed", occurredAt: timestamp, createdAt: timestamp });
    stores.applicationEvents.set("10", { userId, applicationId: "app-1", type: "stage_changed", occurredAt: timestamp, createdAt: timestamp });
    const adapter = new FirestoreAdapter();
    const first = await adapter.listApplicationEventsFiltered(userId, { order: "newest", limit: 1 });
    expect(first.items.map((event) => event.id)).toEqual(["2"]);
    const { decodeEventCursor } = await import("../../applications/events");
    const second = await adapter.listApplicationEventsFiltered(userId, {
      order: "newest", limit: 1, cursor: decodeEventCursor(first.nextCursor!),
    });
    expect(second.items.map((event) => event.id)).toEqual(["10"]);
    const legacyList = await adapter.listApplicationEvents("app-1", userId, 2);
    expect(legacyList.map((event) => event.id)).toEqual(["2", "10"]);
  });

  it("paginates owner-scoped filtered activity deterministically", async () => {
    seedApps([
      { id: "app-1", userId, company: "Acme", role: "Engineer" },
      { id: "app-2", userId, company: "Beta", role: "Platform Engineer" },
    ]);
    const timestamp = { toDate: () => new Date("2026-07-24T09:00:00Z") };
    stores.applicationEvents.set("1", { userId, applicationId: "app-1", type: "stage_changed", occurredAt: timestamp, createdAt: timestamp });
    stores.applicationEvents.set("2", { userId, applicationId: "app-2", type: "stage_changed", occurredAt: timestamp, createdAt: timestamp });
    stores.applicationEvents.set("3", { userId: "other", applicationId: "app-1", type: "stage_changed", occurredAt: timestamp, createdAt: timestamp });
    const adapter = new FirestoreAdapter();
    const first = await adapter.listApplicationEventsFiltered(userId, {
      types: ["stage_changed"], order: "newest", limit: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(first.items[0].id).toBe("2");
    expect(first.items[0].application?.company).toBe("Beta");
    expect(first.nextCursor).toBeTruthy();
    const { decodeEventCursor } = await import("../../applications/events");
    const second = await adapter.listApplicationEventsFiltered(userId, {
      types: ["stage_changed"], order: "newest", limit: 1,
      cursor: decodeEventCursor(first.nextCursor!),
    });
    expect(second.items.map((event) => event.id)).toEqual(["1"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("FirestoreAdapter — CV patch isolation", () => {
  beforeEach(() => {
    stores.applications.clear();
    stores.documents.clear();
    stores.cvPatches.clear();
  });

  it("stores opaque Firestore IDs in Firestore and enforces application ownership", async () => {
    stores.applications.set("opaque-app-id", { userId: "owner" });
    const adapter = new FirestoreAdapter();
    const data = {
      experienceIds: ["exp-1"],
      skillCategories: ["Engineering"],
      includeProjects: true,
      includeEducation: true,
    };

    await expect(adapter.upsertCvPatch("opaque-app-id", "other-user", data)).rejects.toThrow("not_found");
    const patch = await adapter.upsertCvPatch("opaque-app-id", "owner", data);

    expect(patch).toMatchObject({ id: "opaque-app-id", applicationId: "opaque-app-id" });
    await expect(adapter.getCvPatch("opaque-app-id", "other-user")).resolves.toBeNull();
    await expect(adapter.getCvPatch("opaque-app-id", "owner")).resolves.toMatchObject({ applicationId: "opaque-app-id" });
  });

  it("deletes the owner-scoped CV patch with its application", async () => {
    stores.applications.set("opaque-app-id", { userId: "owner" });
    stores.cvPatches.set("opaque-app-id", { applicationId: "opaque-app-id", userId: "owner" });
    const adapter = new FirestoreAdapter();

    await adapter.deleteApplication("opaque-app-id", "owner");

    expect(stores.applications.has("opaque-app-id")).toBe(false);
    expect(stores.cvPatches.has("opaque-app-id")).toBe(false);
  });
});

describe("FirestoreAdapter — explicit owner scopes", () => {
  beforeEach(() => {
    stores.applications.clear();
    stores.documents.clear();
  });

  it("does not treat an empty owner id as a global-read sentinel", async () => {
    stores.applications.set("other-app", {
      userId: "other-user",
      company: "Other",
      role: "Engineer",
      status: "applied",
      createdAt: mockTimestamp,
      updatedAt: mockTimestamp,
    });

    seedDocs([{
      id: "other-doc",
      userId: "other-user",
      filename: "other.pdf",
      originalName: "other.pdf",
      size: 1,
      mimeType: "application/pdf",
      applicationIds: ["other-app"],
    }]);
    const adapter = new FirestoreAdapter();

    await expect(adapter.listApplications("")).resolves.toEqual([]);
    await expect(adapter.listApplicationsPaginated("", {})).resolves.toMatchObject({ data: [], total: 0 });
    await expect(adapter.getApplication("other-app", "")).resolves.toBeNull();
    await expect(adapter.listApplicationsFiltered("", {})).resolves.toEqual([]);
    await expect(adapter.listDocuments("")).resolves.toEqual([]);
    await expect(adapter.getDocument("other-doc", "")).resolves.toBeNull();
  });
});
