import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * One contract suite executed against both backends.
 *
 * The Prisma and Firestore fakes below are deliberately minimal: they model
 * only the query shapes the Career Ops adapter code uses, including the
 * uniqueness failure mode each backend expresses differently (a unique index
 * violation vs. a create() on an existing document id).
 */

type Row = Record<string, unknown>;

let mockClock = Date.UTC(2026, 0, 1);

const { prismaTables, firestoreStores } = vi.hoisted(() => ({
  prismaTables: {
    careerOpsThread: new Map<string, Row>(),
    careerOpsRun: new Map<string, Row>(),
    application: new Map<string, Row>(),
  },
  firestoreStores: {
    careerOpsThreads: new Map<string, Row>(),
    careerOpsRuns: new Map<string, Row>(),
    applications: new Map<string, Row>(),
    contacts: new Map<string, Row>(),
    documents: new Map<string, Row>(),
    applicationSubmissions: new Map<string, Row>(),
    applicationEvents: new Map<string, Row>(),
    applicationCanonicalUrls: new Map<string, Row>(),
    cvPatches: new Map<string, Row>(),
  } as Record<string, Map<string, Row>>,
}));

// ── Prisma fake ─────────────────────────────────────────────────────────────

class PrismaUniqueError extends Error {
  code = "P2002";
  constructor() {
    super("Unique constraint failed");
  }
}

class PrismaForeignKeyError extends Error {
  code = "P2003";
  constructor() {
    super("Foreign key constraint failed");
  }
}

/**
 * Mirrors the partial unique index created by
 * 20260819170000_career_ops_active_run_invariant. Without it the fake would
 * accept two live runs on one conversation and the parity suite would pass
 * while real Postgres rejected the same write.
 */
const ACTIVE_STATUSES = ["queued", "running", "waiting_for_approval", "stopping"];

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    // The monotonic status guard filters with `notIn`, so the fake has to model
    // it or the guard would look effective here while doing nothing.
    if (value && typeof value === "object" && "notIn" in (value as Row)) {
      const excluded = (value as { notIn: unknown[] }).notIn;
      return !excluded.includes(row[key]);
    }
    // The deletion guard selects active runs with `in`; without this the fake
    // would match nothing and the guard would look effective while doing
    // nothing.
    if (value && typeof value === "object" && "in" in (value as Row)) {
      const included = (value as { in: unknown[] }).in;
      return included.includes(row[key]);
    }
    // The reservation cutoff filters with `lt`. Unmodelled, it matched nothing,
    // so an expiry test would pass while the production write never fired.
    if (value && typeof value === "object" && "lt" in (value as Row)) {
      const bound = (value as { lt: unknown }).lt;
      const left = row[key];
      if (left instanceof Date && bound instanceof Date) {
        return left.getTime() < bound.getTime();
      }
      return false;
    }
    // Postgres has only NULL for "no value"; this fake leaves an unset column
    // `undefined`. Without treating them alike, a `field: null` filter matches
    // nothing here while matching real rows in production — so a guard could
    // look effective in tests and be inert against the database, or the
    // reverse.
    if (value === null) return row[key] === null || row[key] === undefined;
    return row[key] === value;
  });
}

function makeTable(
  name: keyof typeof prismaTables,
  uniqueBy: string[],
  options: {
    activeRunIndex?: boolean;
    parent?: keyof typeof prismaTables;
    /** Models the nullable FK from a thread to the application it is scoped to. */
    optionalParent?: { table: keyof typeof prismaTables; field: string };
  } = {},
) {
  const store = prismaTables[name];
  let sequence = 0;
  return {
    async create({ data }: { data: Row }) {
      if (options.parent && !prismaTables[options.parent].has(data.threadId as string)) {
        throw new PrismaForeignKeyError();
      }
      const link = options.optionalParent
        ? (data[options.optionalParent.field] as string | number | null)
        : null;
      if (
        options.optionalParent &&
        link !== null &&
        link !== undefined &&
        !prismaTables[options.optionalParent.table].has(String(link))
      ) {
        throw new PrismaForeignKeyError();
      }
      const duplicate = Array.from(store.values()).some((row) =>
        uniqueBy.every((key) => row[key] === data[key]),
      );
      if (duplicate) throw new PrismaUniqueError();
      if (
        options.activeRunIndex &&
        ACTIVE_STATUSES.includes(data.status as string) &&
        Array.from(store.values()).some(
          (row) =>
            row.threadId === data.threadId && ACTIVE_STATUSES.includes(row.status as string),
        )
      ) {
        throw new PrismaUniqueError();
      }
      sequence += 1;
      const now = new Date(Date.now() + sequence);
      const row: Row = { id: `${name}-${sequence}`, createdAt: now, updatedAt: now, ...data };
      store.set(row.id as string, row);
      return { ...row };
    },
    async findFirst({ where }: { where: Row }) {
      const found = Array.from(store.values()).find((row) => matches(row, where));
      return found ? { ...found } : null;
    },
    async findMany({ where, orderBy }: { where: Row; orderBy?: Array<Row> }) {
      const rows = Array.from(store.values()).filter((row) => matches(row, where));
      if (orderBy) {
        rows.sort((left, right) => {
          for (const clause of orderBy) {
            const [field, direction] = Object.entries(clause)[0] as [string, "asc" | "desc"];
            const a = left[field] as never;
            const b = right[field] as never;
            if (a === b) continue;
            const result = a < b ? -1 : 1;
            return direction === "desc" ? -result : result;
          }
          return 0;
        });
      }
      return rows.map((row) => ({ ...row }));
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      let count = 0;
      for (const [key, row] of store.entries()) {
        if (!matches(row, where)) continue;
        store.set(key, { ...row, ...data, updatedAt: new Date(Date.now() + ++sequence) });
        count += 1;
      }
      return { count };
    },
    async deleteMany({ where }: { where: Row }) {
      let count = 0;
      for (const [key, row] of store.entries()) {
        if (!matches(row, where)) continue;
        store.delete(key);
        count += 1;
      }
      return { count };
    },
  };
}

vi.mock("@/lib/prisma", () => {
  const client: Record<string, unknown> = {
    careerOpsThread: makeTable("careerOpsThread", ["userId", "hermesSessionId"], {
      optionalParent: { table: "application", field: "applicationId" },
    }),
    careerOpsRun: makeTable("careerOpsRun", ["threadId", "clientRequestId"], {
      activeRunIndex: true,
      parent: "careerOpsThread",
    }),
    shareLink: { deleteMany: vi.fn() },
  };
  // The callback runs against the same stores. That models an atomic
  // *decision* — the guard and the write see one consistent state, which is
  // what the deletion contract depends on — not rollback.
  //
  // `$queryRaw` here stands in for the `SELECT ... FOR UPDATE` that serializes
  // claiming against deletion. The fake is single-threaded, so transactions
  // already cannot interleave; the lock's real effect is verified directly
  // against Postgres rather than here.
  client.$queryRaw = async () => [];
  client.$transaction = async <T,>(callback: (tx: unknown) => Promise<T>): Promise<T> =>
    callback(client);
  return { prisma: client };
});

// ── Firestore fake ──────────────────────────────────────────────────────────

interface MockRef {
  id: string;
  __store: Map<string, Row>;
  get: () => Promise<{ id: string; exists: boolean; data: () => Row | undefined; ref: MockRef }>;
  set: (data: Row) => Promise<void>;
  create: (data: Row) => Promise<void>;
  update: (data: Row) => Promise<void>;
  delete: () => Promise<void>;
}

function makeRef(store: Map<string, Row>, id: string): MockRef {
  const ref: MockRef = {
    id,
    __store: store,
    async get() {
      const data = store.get(id);
      return { id, exists: !!data, data: () => data, ref };
    },
    async set(data: Row) {
      store.set(id, data);
    },
    async create(data: Row) {
      if (store.has(id)) throw Object.assign(new Error("already exists"), { code: 6 });
      store.set(id, data);
    },
    async update(data: Row) {
      const current = store.get(id);
      if (!current) throw new Error("not_found");
      store.set(id, { ...current, ...data });
    },
    async delete() {
      store.delete(id);
    },
  };
  return ref;
}

function makeQuery(
  store: Map<string, Row>,
  filters: Array<{ field: string; operator: string; value: unknown }> = [],
  sorts: Array<{ field: string; direction: "asc" | "desc" }> = [],
) {
  const normalize = (value: unknown) => {
    if (value && typeof value === "object" && "toDate" in value) {
      return (value as { toDate: () => Date }).toDate().getTime();
    }
    if (value instanceof Date) return value.getTime();
    return value ?? "";
  };
  const compare = (left: unknown, right: unknown) => {
    const a = normalize(left) as never;
    const b = normalize(right) as never;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  return {
    where(field: string, operator: string, value: unknown) {
      return makeQuery(store, [...filters, { field, operator, value }], sorts);
    },
    orderBy(field: string, direction: "asc" | "desc" = "asc") {
      return makeQuery(store, filters, [...sorts, { field, direction }]);
    },
    limit() {
      return makeQuery(store, filters, sorts);
    },
    async get() {
      const entries = Array.from(store.entries()).filter(([id, data]) =>
        filters.every(({ field, operator, value }) => {
          const actual = field === "__name__" ? id : data[field];
          if (operator === "==") return actual === value;
          if (operator === "array-contains") return Array.isArray(actual) && actual.includes(value);
          if (operator === "in") return Array.isArray(value) && value.includes(actual);
          return true;
        }),
      );
      entries.sort(([leftId, left], [rightId, right]) => {
        for (const sort of sorts) {
          const result = compare(
            sort.field === "__name__" ? leftId : left[sort.field],
            sort.field === "__name__" ? rightId : right[sort.field],
          );
          if (result) return sort.direction === "desc" ? -result : result;
        }
        return 0;
      });
      return {
        empty: entries.length === 0,
        docs: entries.map(([id, data]) => ({
          id,
          exists: true,
          data: () => data,
          ref: makeRef(store, id),
        })),
      };
    },
  };
}

let autoId = 0;

/** Serializes transactions so the fake matches Firestore's isolation. */
let transactionQueue: Promise<void> = Promise.resolve();

type TxHandle = {
  get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
  create: (ref: MockRef, data: Row) => void;
  set: (ref: MockRef, data: Row) => void;
  update: (ref: MockRef, data: Row) => void;
  delete: (ref: MockRef) => void;
};

async function runSerializedTransaction<T>(
  callback: (transaction: TxHandle) => Promise<T>,
): Promise<T> {
  const writes: Array<() => void> = [];
  const result = await callback({
    get: (ref) => ref.get(),
    create: (ref, data) => {
      if (ref.__store.has(ref.id)) throw Object.assign(new Error("already exists"), { code: 6 });
      writes.push(() => ref.__store.set(ref.id, data));
    },
    set: (ref, data) => writes.push(() => ref.__store.set(ref.id, data)),
    update: (ref, data) => {
      const current = ref.__store.get(ref.id);
      if (!current) throw new Error("not_found");
      writes.push(() => ref.__store.set(ref.id, { ...current, ...data }));
    },
    delete: (ref) => writes.push(() => ref.__store.delete(ref.id)),
  });
  writes.forEach((write) => write());
  return result;
}

function makeCollection(store: Map<string, Row>) {
  return {
    ...makeQuery(store),
    doc: (id?: string) => makeRef(store, id ?? `auto-${(autoId += 1)}`),
  };
}

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{ name: "mock" }],
  initializeApp: vi.fn(),
  applicationDefault: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => {
      if (!firestoreStores[name]) firestoreStores[name] = new Map();
      return makeCollection(firestoreStores[name]);
    },
    getAll: vi.fn(),
    /**
     * Firestore transactions are serializable: a concurrent writer that
     * invalidates the read set causes an abort and retry. The fake models that
     * guarantee by running transactions one at a time, so a concurrency test
     * here fails for the same reason it would against a real Firestore rather
     * than passing because the fake has no isolation at all.
     */
    async runTransaction<T>(callback: (transaction: TxHandle) => Promise<T>): Promise<T> {
      const previous = transactionQueue;
      let release!: () => void;
      transactionQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await runSerializedTransaction(callback);
      } finally {
        release();
      }
    },
    batch: () => {
      // Firestore rejects a batch of more than 500 writes. The adapter chunks
      // at 450 precisely because of that, so the fake has to enforce it — an
      // unbounded fake would accept writes the real backend refuses and the
      // chunking could regress unnoticed.
      const FIRESTORE_BATCH_LIMIT = 500;
      const writes: Array<() => void> = [];
      const add = (write: () => void) => {
        if (writes.length >= FIRESTORE_BATCH_LIMIT) {
          throw new Error("firestore: maximum 500 writes allowed per request");
        }
        writes.push(write);
      };
      return {
        set: (ref: MockRef, data: Row) => add(() => ref.__store.set(ref.id, data)),
        update: (ref: MockRef, data: Row) =>
          add(() => ref.__store.set(ref.id, { ...ref.__store.get(ref.id), ...data })),
        delete: (ref: MockRef) => add(() => ref.__store.delete(ref.id)),
        commit: async () => writes.forEach((write) => write()),
      };
    },
  }),
  // Defined here, not at module scope: `vi.mock` factories are hoisted above
  // top-level declarations, and a class referenced from one is not initialized
  // yet. It must be a constructor — the adapters narrow with `instanceof`, and
  // a plain object literal threw the moment production code tested the type.
  Timestamp: class FakeTimestamp {
    constructor(private readonly at: Date) {}
    toDate(): Date {
      return this.at;
    }
    /** Monotonic so same-tick writes still order deterministically. */
    static now(): FakeTimestamp {
      mockClock += 1;
      return new FakeTimestamp(new Date(mockClock));
    }
    static fromDate(value: Date): FakeTimestamp {
      return new FakeTimestamp(value);
    }
  },
  FieldPath: { documentId: () => "__name__" },
  FieldValue: {
    serverTimestamp: () => ({ toDate: () => new Date() }),
    arrayRemove: (...values: unknown[]) => ({ __arrayRemove: values }),
    delete: () => null,
  },
}));

vi.mock("@/types", () => ({
  normalizeStatus: (value: string) => value,
  COMPANY_SIZE_OPTIONS: [],
  INCOMING_SOURCE_OPTIONS: [],
}));

import { PrismaAdapter } from "../prisma-adapter";
import { FirestoreAdapter } from "../firestore-adapter";
import type { DatabaseAdapter } from "../adapter";
import type { CareerOpsRunStatus } from "../types";

const backends: Array<[string, () => DatabaseAdapter]> = [
  ["prisma", () => new PrismaAdapter()],
  ["firestore", () => new FirestoreAdapter()],
];

function resetStores() {
  mockClock = Date.UTC(2026, 0, 1);
  for (const store of Object.values(prismaTables)) store.clear();
  for (const store of Object.values(firestoreStores)) store.clear();
  autoId = 0;
}

describe.each(backends)("Career Ops persistence contract (%s)", (_name, makeAdapter) => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    resetStores();
    db = makeAdapter();
  });

  async function seedThread(userId: string, overrides: Partial<{ title: string; hermesSessionId: string; applicationId: string | null }> = {}) {
    return db.createCareerOpsThread(userId, {
      hermesSessionId: overrides.hermesSessionId ?? `sess-${Math.random().toString(36).slice(2)}`,
      title: overrides.title ?? "Career Ops",
      applicationId: overrides.applicationId ?? null,
    });
  }

  /**
   * Both backends require the linked application to exist when a scoped
   * conversation is written — relationally through a foreign key, in Firestore
   * through a re-read inside the creating transaction.
   */
  function seedApplication(id: string, userId: string) {
    firestoreStores.applications.set(id, { userId, company: "Acme", role: "Engineer" });
    prismaTables.application.set(id, { id, userId });
  }

  /**
   * Legacy shape used by the tests written against the pre-atomic API. The
   * claim now reports why it failed, so translate the two success outcomes and
   * make any refusal loud rather than silently returning undefined.
   */
  async function claimRun(
    userId: string,
    data: {
      threadId: string;
      hermesRunId: string;
      clientRequestId: string;
      status: CareerOpsRunStatus;
    },
  ) {
    const claim = await db.claimCareerOpsRun(userId, data);
    if (claim.outcome === "active_run_exists") throw new Error("active_run_exists");
    if (claim.outcome === "thread_gone") throw new Error("thread_gone");
    return { run: claim.run, created: claim.outcome === "claimed" };
  }

  it("creates and reads back an owner-scoped thread", async () => {
    const thread = await seedThread("user-a", { hermesSessionId: "sess-1", title: "Pipeline" });
    expect(thread.userId).toBe("user-a");
    expect(thread.hermesSessionId).toBe("sess-1");
    expect(thread.title).toBe("Pipeline");
    expect(thread.applicationId).toBeNull();

    await expect(db.getCareerOpsThread(thread.id, "user-a")).resolves.toMatchObject({
      id: thread.id,
      hermesSessionId: "sess-1",
    });
  });

  it("hides another user's thread from get, list, rename and delete", async () => {
    const thread = await seedThread("user-a");
    await seedThread("user-b");

    await expect(db.getCareerOpsThread(thread.id, "user-b")).resolves.toBeNull();
    await expect(db.renameCareerOpsThread(thread.id, "user-b", "hijack")).resolves.toBeNull();
    await expect(db.deleteCareerOpsThread(thread.id, "user-b")).resolves.toMatchObject({
      outcome: "not_found",
    });

    const listed = await db.listCareerOpsThreads("user-b");
    expect(listed.map((item) => item.id)).not.toContain(thread.id);
    await expect(db.getCareerOpsThread(thread.id, "user-a")).resolves.not.toBeNull();
  });

  it("lists only the owner's threads, most recently updated first", async () => {
    const first = await seedThread("user-a", { hermesSessionId: "s1", title: "one" });
    const second = await seedThread("user-a", { hermesSessionId: "s2", title: "two" });
    await seedThread("user-b", { hermesSessionId: "s3", title: "other" });

    const listed = await db.listCareerOpsThreads("user-a");
    expect(listed.map((item) => item.id)).toEqual([second.id, first.id]);

    await db.renameCareerOpsThread(first.id, "user-a", "one renamed");
    const reordered = await db.listCareerOpsThreads("user-a");
    expect(reordered[0].id).toBe(first.id);
    expect(reordered[0].title).toBe("one renamed");
  });

  it("returns an empty list for a user with no threads", async () => {
    await expect(db.listCareerOpsThreads("user-z")).resolves.toEqual([]);
  });

  it("persists an application link on the thread", async () => {
    seedApplication("42", "user-a");
    const thread = await seedThread("user-a", { applicationId: "42" });
    expect(thread.applicationId).toBe("42");
    await expect(db.getCareerOpsThread(thread.id, "user-a")).resolves.toMatchObject({
      applicationId: "42",
    });
  });

  it("creates a run and reads it back under the owner", async () => {
    const thread = await seedThread("user-a");
    const { run, created } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-request-1",
      status: "queued",
    });
    expect(created).toBe(true);
    expect(run).toMatchObject({
      userId: "user-a",
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-request-1",
      status: "queued",
    });
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({ id: run.id });
  });

  it("deduplicates run creation on (threadId, clientRequestId)", async () => {
    const thread = await seedThread("user-a");
    const first = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "same-client-id",
      status: "queued",
    });
    const second = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_2",
      clientRequestId: "same-client-id",
      status: "queued",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
    expect(second.run.hermesRunId).toBe("run_1");
  });

  it("creates distinct runs for distinct client request ids once the first settles", async () => {
    const thread = await seedThread("user-a");
    const first = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-one",
      status: "queued",
    });
    await db.updateCareerOpsRunStatus(first.run.id, "user-a", "completed");

    const second = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_2",
      clientRequestId: "client-id-two",
      status: "queued",
    });
    expect(second.run.id).not.toBe(first.run.id);
    expect(second.created).toBe(true);
  });

  it("admits only one active run per conversation", async () => {
    // Two tabs, two different client request ids, no coordination. Only the
    // database can decide this — a read-then-write guard lets both through and
    // both start a privileged agent run against one Hermes session.
    const thread = await seedThread("user-a");
    await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "tab-one",
      status: "queued",
    });

    await expect(
      db.claimCareerOpsRun("user-a", {
        threadId: thread.id,
        hermesRunId: "run_2",
        clientRequestId: "tab-two",
        status: "queued",
      }),
    ).resolves.toEqual({ outcome: "active_run_exists" });
  });

  it("admits only one winner when concurrent claims race", async () => {
    const thread = await seedThread("user-a");
    const results = await Promise.all(
      ["tab-one", "tab-two", "tab-three"].map((clientRequestId) =>
        db.claimCareerOpsRun("user-a", {
          threadId: thread.id,
          hermesRunId: "",
          clientRequestId,
          status: "queued",
        }),
      ),
    );
    expect(results.filter((r) => r.outcome === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "active_run_exists")).toHaveLength(2);
  });

  it("resolves an idempotent retry to its own run rather than refusing it", async () => {
    // The first attempt's own reservation is the conversation's active run, so
    // a naive active-run guard would reject the retry that is trying to recover
    // from a lost response.
    const thread = await seedThread("user-a");
    const first = await db.claimCareerOpsRun("user-a", {
      threadId: thread.id,
      hermesRunId: "",
      clientRequestId: "same-id",
      status: "queued",
    });
    const retry = await db.claimCareerOpsRun("user-a", {
      threadId: thread.id,
      hermesRunId: "",
      clientRequestId: "same-id",
      status: "queued",
    });
    expect(first.outcome).toBe("claimed");
    expect(retry).toMatchObject({ outcome: "existing" });
    if (retry.outcome !== "existing") throw new Error("unreachable");
    if (first.outcome !== "claimed") throw new Error("unreachable");
    expect(retry.run.id).toBe(first.run.id);
  });

  it("reports a claim against a deleted conversation as gone, not as a new run", async () => {
    // Failure injection for the delete-during-submit race: the thread vanishes
    // between the caller's ownership read and the write. If this produced a run
    // anyway, a privileged Hermes run could execute with no resolvable mapping.
    const thread = await seedThread("user-a");
    await db.deleteCareerOpsThread(thread.id, "user-a");

    await expect(
      db.claimCareerOpsRun("user-a", {
        threadId: thread.id,
        hermesRunId: "",
        clientRequestId: "orphan",
        status: "queued",
      }),
    ).resolves.toEqual({ outcome: "thread_gone" });
  });

  it("never moves a terminal run back to an active status", async () => {
    // A delayed status poll that observed `running` must not resurrect a run
    // the event stream already settled — that would both misreport the run and
    // re-occupy the conversation's single active slot.
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-one",
      status: "running",
    });
    await db.updateCareerOpsRunStatus(run.id, "user-a", "completed");
    await db.updateCareerOpsRunStatus(run.id, "user-a", "running");

    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("finds the run already claimed by a client request id", async () => {
    const thread = await seedThread("user-a");
    await expect(
      db.findCareerOpsRunByClientRequestId(thread.id, "user-a", "client-id-lookup"),
    ).resolves.toBeNull();

    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-lookup",
      status: "queued",
    });

    await expect(
      db.findCareerOpsRunByClientRequestId(thread.id, "user-a", "client-id-lookup"),
    ).resolves.toMatchObject({ id: run.id, hermesRunId: "run_1" });
    await expect(
      db.findCareerOpsRunByClientRequestId(thread.id, "user-b", "client-id-lookup"),
    ).resolves.toBeNull();
  });

  it("scopes deduplication per owner, so two users never collide", async () => {
    const threadA = await seedThread("user-a", { hermesSessionId: "sa" });
    const threadB = await seedThread("user-b", { hermesSessionId: "sb" });
    const a = await claimRun("user-a", {
      threadId: threadA.id,
      hermesRunId: "run_a",
      clientRequestId: "shared-client-id",
      status: "queued",
    });
    const b = await claimRun("user-b", {
      threadId: threadB.id,
      hermesRunId: "run_b",
      clientRequestId: "shared-client-id",
      status: "queued",
    });

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.run.id).not.toBe(a.run.id);
    await expect(db.getCareerOpsRun(a.run.id, "user-b")).resolves.toBeNull();
    await expect(db.getCareerOpsRun(b.run.id, "user-a")).resolves.toBeNull();
  });

  it("refuses to claim a run on a thread the caller does not own", async () => {
    const thread = await seedThread("user-a");
    await expect(
      db.claimCareerOpsRun("user-b", {
        threadId: thread.id,
        hermesRunId: "run_x",
        clientRequestId: "client-id-x",
        status: "queued",
      }),
    ).resolves.toEqual({ outcome: "thread_gone" });
  });

  it("updates a run status only for its owner", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-status",
      status: "queued",
    });

    await db.updateCareerOpsRunStatus(run.id, "user-b", "completed");
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({ status: "queued" });

    await db.updateCareerOpsRunStatus(run.id, "user-a", "completed");
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("binds an upstream run id onto a reservation", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "",
      clientRequestId: "client-id-reserve",
      status: "queued",
    });
    expect(run.hermesRunId).toBe("");

    const bound = await db.bindCareerOpsRunHermesId(run.id, "user-a", "run_bound");
    expect(bound?.hermesRunId).toBe("run_bound");
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      hermesRunId: "run_bound",
    });
  });

  it("refuses to bind or delete another user's run", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "",
      clientRequestId: "client-id-foreign",
      status: "queued",
    });

    await expect(db.bindCareerOpsRunHermesId(run.id, "user-b", "run_x")).resolves.toBeNull();
    await db.deleteCareerOpsRun(run.id, "user-b");
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.not.toBeNull();
  });

  it("releases a reservation so the same client request id can be retried", async () => {
    const thread = await seedThread("user-a");
    const first = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "",
      clientRequestId: "client-id-release",
      status: "queued",
    });
    await db.deleteCareerOpsRun(first.run.id, "user-a");
    await expect(db.getCareerOpsRun(first.run.id, "user-a")).resolves.toBeNull();

    const second = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_retry",
      clientRequestId: "client-id-release",
      status: "queued",
    });
    expect(second.created).toBe(true);
    expect(second.run.hermesRunId).toBe("run_retry");
  });

  it("returns the most recent run on a thread, scoped to its owner", async () => {
    const thread = await seedThread("user-a");
    await expect(db.getLatestCareerOpsRun(thread.id, "user-a")).resolves.toBeNull();

    await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_old",
      clientRequestId: "client-id-old",
      status: "completed",
    });
    const newer = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_new",
      clientRequestId: "client-id-new",
      status: "running",
    });

    await expect(db.getLatestCareerOpsRun(thread.id, "user-a")).resolves.toMatchObject({
      id: newer.run.id,
      hermesRunId: "run_new",
    });
    await expect(db.getLatestCareerOpsRun(thread.id, "user-b")).resolves.toBeNull();
  });

  it("deletes a thread together with its runs", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-delete",
      status: "queued",
    });

    // Settle it first: an active run now blocks deletion by design.
    await db.updateCareerOpsRunStatus(run.id, "user-a", "completed");

    const removed = await db.deleteCareerOpsThread(thread.id, "user-a");
    expect(removed).toMatchObject({ outcome: "deleted" });
    if (removed.outcome !== "deleted") throw new Error("unreachable");
    expect(removed.thread.id).toBe(thread.id);
    await expect(db.getCareerOpsThread(thread.id, "user-a")).resolves.toBeNull();
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toBeNull();
    await expect(db.deleteCareerOpsThread(thread.id, "user-a")).resolves.toMatchObject({
      outcome: "not_found",
    });
  });

  it("moves a conversation to the top of history when a run is claimed", async () => {
    const older = await seedThread("user-a", { title: "Older" });
    await seedThread("user-a", { title: "Newer" });

    await claimRun("user-a", {
      threadId: older.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-bump",
      status: "queued",
    });

    const listed = await db.listCareerOpsThreads("user-a");
    expect(listed[0]?.id).toBe(older.id);
  });

  it("tracks only the outstanding approval challenge for a run", async () => {
    // One run can reach several gates. Only the challenge currently awaiting a
    // decision may be answered, so an earlier gate's token cannot authorize a
    // later action.
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-gates",
      status: "running",
    });

    await db.openCareerOpsApprovalGate(run.id, "user-a", "gate-a");
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      pendingApprovalChallengeId: "gate-a",
    });

    await db.openCareerOpsApprovalGate(run.id, "user-a", "gate-b");
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      pendingApprovalChallengeId: "gate-b",
    });

    await db.openCareerOpsApprovalGate(run.id, "user-a", null);
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      pendingApprovalChallengeId: null,
    });
  });

  it("lets binding and expiry have exactly one winner, in either order", async () => {
    // Both reach the same reservation. Only one may take effect: a row that is
    // bound *and* abandoned means a live Hermes run is attached to a closed
    // reservation while the conversation's active slot stands free for another.
    //
    // Both orderings are exercised deliberately. Racing them with Promise.all
    // proves nothing here — the fakes settle in call order, so it only ever
    // tested the ordering that happens to be safe.
    for (const expireFirst of [false, true]) {
      const thread = await seedThread("user-a");
      const { run } = await claimRun("user-a", {
        threadId: thread.id,
        hermesRunId: "",
        clientRequestId: `client-id-bind-race-${expireFirst}`,
        status: "queued",
      });
      // Cutoffs are relative to the row's own createdAt: the two fakes keep
      // different clocks, and a wall-clock cutoff would exercise only one.
      const created = (await db.getCareerOpsRun(run.id, "user-a"))!.createdAt;
      const cutoff = new Date(created.getTime() + 1);

      let bound: unknown;
      let expired: boolean;
      if (expireFirst) {
        expired = await db.expireCareerOpsRunReservation(run.id, "user-a", cutoff);
        bound = await db.bindCareerOpsRunHermesId(run.id, "user-a", "run_late");
      } else {
        bound = await db.bindCareerOpsRunHermesId(run.id, "user-a", "run_late");
        expired = await db.expireCareerOpsRunReservation(run.id, "user-a", cutoff);
      }

      const label = expireFirst ? "expiry first" : "binding first";
      expect([bound !== null, expired].filter(Boolean), label).toHaveLength(1);

      const settled = await db.getCareerOpsRun(run.id, "user-a");
      if (expireFirst) {
        expect(settled?.status, label).toBe("abandoned");
        expect(settled?.hermesRunId, label).toBe("");
      } else {
        expect(settled?.status, label).toBe("queued");
        expect(settled?.hermesRunId, label).toBe("run_late");
      }
    }
  });

  it("expires only an unbound, still-active reservation past its cutoff", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "",
      clientRequestId: "client-id-expiry-guards",
      status: "queued",
    });

    const created = (await db.getCareerOpsRun(run.id, "user-a"))!.createdAt;
    const past = new Date(created.getTime() + 1);

    // At its own creation instant: not yet past the cutoff.
    await expect(
      db.expireCareerOpsRunReservation(run.id, "user-a", created),
    ).resolves.toBe(false);
    // Another user's run is never this caller's to settle.
    await expect(db.expireCareerOpsRunReservation(run.id, "user-b", past)).resolves.toBe(false);

    // A bound run is live; expiry must not touch it however old it is.
    expect(await db.bindCareerOpsRunHermesId(run.id, "user-a", "run_bound")).not.toBeNull();
    await expect(db.expireCareerOpsRunReservation(run.id, "user-a", past)).resolves.toBe(false);
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      status: "queued",
      hermesRunId: "run_bound",
    });
  });

  it("frees the conversation once a reservation is abandoned", async () => {
    // `abandoned` is terminal, so the partial unique index releases the slot and
    // the conversation is usable again rather than wedged forever.
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "",
      clientRequestId: "client-id-abandon-frees",
      status: "queued",
    });
    const created = (await db.getCareerOpsRun(run.id, "user-a"))!.createdAt;
    await expect(
      db.expireCareerOpsRunReservation(run.id, "user-a", new Date(created.getTime() + 1)),
    ).resolves.toBe(true);

    // The slot is free: a fresh submission is admitted rather than refused.
    await expect(
      claimRun("user-a", {
        threadId: thread.id,
        hermesRunId: "run_next",
        clientRequestId: "client-id-abandon-next",
        status: "queued",
      }),
    ).resolves.toMatchObject({ created: true });
  });

  it("lets exactly one decision claim an open approval gate", async () => {
    // Grant and denial contend for the same gate. Two partial claims — one
    // consuming the challenge, one reading the run's status — let both through,
    // because the denial's status read was already stale by the time it acted.
    // One conditional write now decides for both.
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-gate",
      status: "running",
    });
    await db.openCareerOpsApprovalGate(run.id, "user-a", "gate-a");

    const claims = await Promise.all([
      db.claimCareerOpsApprovalGate(run.id, "user-a", "gate-a"),
      db.claimCareerOpsApprovalGate(run.id, "user-a", null),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    // The gate is closed afterwards: the run is no longer waiting and nothing
    // is outstanding, so a later decision finds nothing to answer.
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", null)).resolves.toBeNull();
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      approvalGateOpenedAt: null,
      pendingApprovalChallengeId: null,
    });
  });

  it("refuses a grant that names a challenge the gate is not holding", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-gate-wrong",
      status: "running",
    });
    await db.openCareerOpsApprovalGate(run.id, "user-a", "gate-b");

    // An earlier gate's token verifies against run, owner and choice; only the
    // claim can tell it apart from the one actually pending.
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", "gate-a")).resolves.toBeNull();
    const stillOpen = await db.getCareerOpsRun(run.id, "user-a");
    expect(stillOpen?.approvalGateOpenedAt).not.toBeNull();
    expect(stillOpen?.pendingApprovalChallengeId).toBe("gate-b");
  });

  it("lets a recovered denial claim a gate that has no challenge", async () => {
    // The mint write can fail, and the single-consumer stream cannot reissue a
    // prompt. Denial must still be possible — and still exactly once.
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-gate-recovered",
      status: "running",
    });
    await db.openCareerOpsApprovalGate(run.id, "user-a", null);

    const claims = await Promise.all([
      db.claimCareerOpsApprovalGate(run.id, "user-a", null),
      db.claimCareerOpsApprovalGate(run.id, "user-a", null),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toEqual({ challengeId: "" });
  });

  it("refuses to claim a gate on a run that is not waiting, or is not yours", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-gate-running",
      status: "running",
    });
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", null)).resolves.toBeNull();

    await db.openCareerOpsApprovalGate(run.id, "user-a", null);
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-b", null)).resolves.toBeNull();
    // Still open: another user's decision is never this gate's to close.
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", null)).resolves.not.toBeNull();
  });

  it("recovers a denial-only gate, but never one a decision already took", async () => {
    // Polling may be the first thing to see a gate: the event stream is
    // single-consumer and Hermes need not support it at all. Recovery has no
    // prompt and so no challenge, but the owner must still be able to refuse.
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-recovered-gate",
      status: "running",
    });

    expect(await db.recoverCareerOpsApprovalGate(run.id, "user-a")).toBe(true);
    const recovered = await db.getCareerOpsRun(run.id, "user-a");
    expect(recovered?.approvalGateOpenedAt).not.toBeNull();
    // Denial-only by construction: no challenge was disclosed, so nothing can
    // be granted against it.
    expect(recovered?.pendingApprovalChallengeId).toBeNull();
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", "gate-a")).resolves.toBeNull();
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", null)).resolves.not.toBeNull();

    // While a decision is unresolved it must decline: `pending` means one is in
    // flight, `outcome_unknown` that one may already have landed. Reopening
    // then would let a second decision answer the first's action.
    for (const state of ["pending", "outcome_unknown"] as const) {
      await db.recordCareerOpsApprovalDecision(run.id, "user-a", "deny", "", state);
      await expect(db.recoverCareerOpsApprovalGate(run.id, "user-a")).resolves.toBe(false);
    }

    // Once resolved, a gate Hermes still reports may be recovered again.
    await db.recordCareerOpsApprovalDecision(run.id, "user-a", "deny", "", "effect_completed");
    await expect(db.recoverCareerOpsApprovalGate(run.id, "user-a")).resolves.toBe(true);

    // And never on a finished run.
    await db.updateCareerOpsRunStatus(run.id, "user-a", "completed");
    await expect(db.recoverCareerOpsApprovalGate(run.id, "user-a")).resolves.toBe(false);
  });

  it("closes an open gate when the run reaches a terminal status", async () => {
    // A run can finish while a prompt is still on screen. Leaving the gate open
    // lets a delayed or direct denial claim it afterwards: the decision would
    // overwrite the finished run's approval audit and be forwarded upstream for
    // an action nobody is waiting on.
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-terminal-gate",
      status: "running",
    });
    await db.openCareerOpsApprovalGate(run.id, "user-a", "gate-a");

    await db.updateCareerOpsRunStatus(run.id, "user-a", "completed");

    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      status: "completed",
      approvalGateOpenedAt: null,
      pendingApprovalChallengeId: null,
    });
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", null)).resolves.toBeNull();
    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", "gate-a")).resolves.toBeNull();
  });

  it("does not let a status write reopen a claimed gate", async () => {
    // The hole this closes: another tab polling the run sees Hermes still
    // reporting `waiting_for_approval` — true until the decision POST lands —
    // and persisting that snapshot reopened the gate a decision had already
    // claimed, so a second decision could claim it and both were forwarded.
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-gate-vs-status",
      status: "running",
    });
    await db.openCareerOpsApprovalGate(run.id, "user-a", "gate-a");
    expect(await db.claimCareerOpsApprovalGate(run.id, "user-a", "gate-a")).not.toBeNull();

    // Recovery persists what Hermes reports. It writes status only.
    await db.updateCareerOpsRunStatus(run.id, "user-a", "waiting_for_approval");

    await expect(db.claimCareerOpsApprovalGate(run.id, "user-a", null)).resolves.toBeNull();
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      status: "waiting_for_approval",
      approvalGateOpenedAt: null,
    });
  });

  it("puts a claimed gate back when nothing was sent, and only then", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-gate-release",
      status: "running",
    });
    await db.openCareerOpsApprovalGate(run.id, "user-a", "gate-a");

    expect(await db.claimCareerOpsApprovalGate(run.id, "user-a", "gate-a")).toEqual({
      challengeId: "gate-a",
    });
    await db.releaseCareerOpsApprovalGate(run.id, "user-a", "gate-a");
    const restored = await db.getCareerOpsRun(run.id, "user-a");
    expect(restored?.approvalGateOpenedAt).not.toBeNull();
    expect(restored?.pendingApprovalChallengeId).toBe("gate-a");

    // A gate the agent has since moved on to is not this caller's to restore.
    await db.claimCareerOpsApprovalGate(run.id, "user-a", "gate-a");
    await db.openCareerOpsApprovalGate(run.id, "user-a", "gate-b");
    await db.releaseCareerOpsApprovalGate(run.id, "user-a", "gate-a");
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      pendingApprovalChallengeId: "gate-b",
    });
  });

  it("deletes a conversation whose history exceeds one write batch", async () => {
    // Firestore caps a batch at 500 writes. A long-lived conversation would be
    // undeletable if the cleanup were not chunked, and the fake now rejects an
    // oversized batch the way the real backend does.
    const thread = await seedThread("user-a");
    const runIds: string[] = [];
    for (let i = 0; i < 620; i += 1) {
      const { run } = await claimRun("user-a", {
        threadId: thread.id,
        hermesRunId: `run_${i}`,
        clientRequestId: `client-id-${i.toString().padStart(4, "0")}`,
        status: "queued",
      });
      runIds.push(run.id);
      await db.updateCareerOpsRunStatus(run.id, "user-a", "completed");
    }

    await expect(db.deleteCareerOpsThread(thread.id, "user-a")).resolves.toMatchObject({
      outcome: "deleted",
    });
    await expect(db.getCareerOpsThread(thread.id, "user-a")).resolves.toBeNull();

    // The runs must be gone too. Asserting only that the thread disappeared
    // would not detect lost chunking: an oversized batch throws, that failure
    // is deliberately non-fatal so the caller can still delete the upstream
    // session, and the orphaned run documents would go unnoticed.
    await expect(db.getCareerOpsRun(runIds[0], "user-a")).resolves.toBeNull();
    await expect(db.getCareerOpsRun(runIds[runIds.length - 1], "user-a")).resolves.toBeNull();
  });

  it("refuses to scope a conversation to an application that vanished", async () => {
    // The application is verified before Hermes is asked for a session, and can
    // be deleted during that round-trip; writing the thread anyway would point
    // a conversation at a record that no longer exists.
    await expect(
      db.createCareerOpsThread("user-a", {
        hermesSessionId: "sess-vanished",
        title: "Gone",
        applicationId: "999",
      }),
    ).rejects.toThrow();
  });

  it("refuses to delete a conversation that still holds an active run", async () => {
    // The refusal is decided by the delete itself, not by a prior read: a
    // submission that claims the conversation in between must not be stranded
    // with a privileged run and no mapping to stop it.
    const thread = await seedThread("user-a");
    await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_live",
      clientRequestId: "client-id-live",
      status: "running",
    });

    await expect(db.deleteCareerOpsThread(thread.id, "user-a")).resolves.toMatchObject({
      outcome: "active_run",
    });
    await expect(db.getCareerOpsThread(thread.id, "user-a")).resolves.toMatchObject({
      id: thread.id,
    });
  });

  it("records who decided an approval and when, and nothing else", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-approval",
      status: "waiting_for_approval",
    });
    expect(run.approvalChoice).toBeNull();

    await db.recordCareerOpsApprovalDecision(run.id, "user-a", "deny", "challenge-1", "effect_completed");
    const decided = await db.getCareerOpsRun(run.id, "user-a");
    expect(decided?.approvalChoice).toBe("deny");
    expect(decided?.approvalAt).toBeInstanceOf(Date);

    // Owner and run are already on the record; nothing about the operation is.
    expect(Object.keys(decided!)).not.toContain("approvalCommand");
    expect(JSON.stringify(decided)).not.toMatch(/rm -rf|command|arguments/i);
  });

  it("ignores an approval decision recorded by another user", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-foreign-approval",
      status: "waiting_for_approval",
    });
    await db.recordCareerOpsApprovalDecision(run.id, "user-b", "once", "challenge-1", "effect_completed");
    await expect(db.getCareerOpsRun(run.id, "user-a")).resolves.toMatchObject({
      approvalChoice: null,
    });
  });

  it("stores no credential material on either record", async () => {
    const thread = await seedThread("user-a");
    const { run } = await claimRun("user-a", {
      threadId: thread.id,
      hermesRunId: "run_1",
      clientRequestId: "client-id-secret",
      status: "queued",
    });
    for (const key of [...Object.keys(thread), ...Object.keys(run)]) {
      expect(key.toLowerCase()).not.toMatch(/key|token|secret|authorization|content|message/);
    }
  });
});

describe("Firestore application deletion clears the Career Ops link", () => {
  it("keeps the thread as a global conversation when its application is deleted", async () => {
    resetStores();
    const db = new FirestoreAdapter();
    firestoreStores.applications.set("app-1", { userId: "user-a", company: "Acme", role: "Dev" });
    const thread = await db.createCareerOpsThread("user-a", {
      hermesSessionId: "sess-1",
      title: "Acme",
      applicationId: "app-1",
    });

    await db.deleteApplication("app-1", "user-a");

    await expect(db.getCareerOpsThread(thread.id, "user-a")).resolves.toMatchObject({
      id: thread.id,
      applicationId: null,
    });
  });
});

describe("relational schema guarantees", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");

  it("cascades Career Ops rows when the owning user is deleted", () => {
    const threadModel = schema.slice(schema.indexOf("model CareerOpsThread"));
    expect(threadModel).toMatch(/user\s+User\s+@relation\(fields: \[userId\][^)]*onDelete: Cascade/);
    const runModel = schema.slice(schema.indexOf("model CareerOpsRun"));
    expect(runModel).toMatch(/user\s+User\s+@relation\(fields: \[userId\][^)]*onDelete: Cascade/);
    expect(runModel).toMatch(/thread\s+CareerOpsThread\s+@relation\([^)]*onDelete: Cascade/);
  });

  it("clears rather than deletes the thread when its application is removed", () => {
    const threadModel = schema.slice(schema.indexOf("model CareerOpsThread"));
    expect(threadModel).toMatch(/application\s+Application\?\s+@relation\([^)]*onDelete: SetNull/);
  });

  it("declares the deduplication and ownership indexes", () => {
    const threadModel = schema.slice(schema.indexOf("model CareerOpsThread"));
    expect(threadModel).toContain("@@unique([userId, hermesSessionId])");
    expect(threadModel).toContain("@@index([userId, updatedAt])");
    const runModel = schema.slice(schema.indexOf("model CareerOpsRun"));
    expect(runModel).toContain("@@unique([threadId, clientRequestId])");
  });
});

describe("Firestore index configuration", () => {
  const indexes = JSON.parse(
    readFileSync(path.join(process.cwd(), "firestore.indexes.json"), "utf8"),
  ) as { indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order: string }> }> };

  it("declares the owner-scoped thread ordering index", () => {
    const found = indexes.indexes.find(
      (index) =>
        index.collectionGroup === "careerOpsThreads" &&
        index.fields.some((field) => field.fieldPath === "userId") &&
        index.fields.some((field) => field.fieldPath === "updatedAt"),
    );
    expect(found).toBeDefined();
  });

  it("declares the owner-scoped run index", () => {
    const found = indexes.indexes.find(
      (index) =>
        index.collectionGroup === "careerOpsRuns" &&
        index.fields.some((field) => field.fieldPath === "userId") &&
        index.fields.some((field) => field.fieldPath === "createdAt"),
    );
    expect(found).toBeDefined();
  });
});
