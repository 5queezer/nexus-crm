import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (available inside vi.mock factories) ──────────────────────

const { mockGetAll, stores, mockTimestamp, batchState, applyUpdate } = vi.hoisted(() => {
  const stores = {
    applications: new Map<string, Record<string, unknown>>(),
    documents: new Map<string, Record<string, unknown>>(),
    contacts: new Map<string, Record<string, unknown>>(),
    applicationSubmissions: new Map<string, Record<string, unknown>>(),
    applicationEvents: new Map<string, Record<string, unknown>>(),
    applicationCanonicalUrls: new Map<string, Record<string, unknown>>(),
  };

  const mockGetAll = vi.fn();
  const mockTimestamp = { toDate: () => new Date("2025-01-01") };
  const batchState = {
    commitCount: 0,
    failOnCommit: null as number | null,
    beforeCommit: null as (() => void) | null,
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

  return { mockGetAll, stores, mockTimestamp, batchState, applyUpdate };
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
});

describe("FirestoreAdapter — retryable application deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(stores).forEach((store) => store.clear());
  });

  it("removes only the deleted application link without overwriting a concurrent document mutation", async () => {
    const adapter = new FirestoreAdapter();
    stores.applications.set("app-1", {
      userId: "user-1", company: "Acme", role: "Engineer", canonicalJobUrl: null,
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

  it("continues sparse in-memory filters with a bounded scan cursor", async () => {
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
    const first = await adapter.listApplicationEventsFiltered(userId, {
      company: "Beta", order: "newest", limit: 1,
    });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).toBeTruthy();
    const { decodeEventCursor } = await import("../../applications/events");
    const second = await adapter.listApplicationEventsFiltered(userId, {
      company: "Beta", order: "newest", limit: 1,
      cursor: decodeEventCursor(first.nextCursor!),
    });
    expect(second.items.map((event) => event.id)).toEqual(["1"]);
    expect(second.nextCursor).toBeNull();
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
