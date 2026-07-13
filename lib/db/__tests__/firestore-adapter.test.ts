import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (available inside vi.mock factories) ──────────────────────

const { mockGetAll, stores, mockTimestamp, batchState } = vi.hoisted(() => {
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
  const batchState = { commitCount: 0, failOnCommit: null as number | null };

  return { mockGetAll, stores, mockTimestamp, batchState };
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
      if (existing) store.set(id, { ...existing, ...d });
    },
    async delete() { store.delete(id); },
  };
  return ref;
}

function makeQuery(
  store: Map<string, Record<string, unknown>>,
  filters: Array<{ field: string; operator: string; value: unknown }> = [],
  sort?: { field: string; direction: "asc" | "desc" },
  max?: number,
) {
  return {
    where(field: string, operator: string, value: unknown) {
      if (!["==", "array-contains", "in"].includes(operator)) {
        throw new Error(`Unsupported mock operator: ${operator}`);
      }
      return makeQuery(store, [...filters, { field, operator, value }], sort, max);
    },
    orderBy(field: string, direction: "asc" | "desc" = "asc") {
      return makeQuery(store, filters, { field, direction }, max);
    },
    limit(value: number) {
      return makeQuery(store, filters, sort, value);
    },
    async get() {
      let entries = Array.from(store.entries()).filter(([, data]) =>
        filters.every(({ field, operator, value }) => {
          if (operator === "==") return data[field] === value;
          if (operator === "array-contains") return Array.isArray(data[field]) && data[field].includes(value);
          return Array.isArray(value) && value.includes(data[field]);
        }),
      );
      if (sort) {
        entries.sort(([, left], [, right]) => {
          const a = left[sort.field] as { toDate?: () => Date } | Date | number | string | undefined;
          const b = right[sort.field] as { toDate?: () => Date } | Date | number | string | undefined;
          const normalize = (item: typeof a) => {
            if (item && typeof item === "object" && "toDate" in item && item.toDate) return item.toDate().getTime();
            if (item instanceof Date) return item.getTime();
            return item ?? "";
          };
          const result = normalize(a) < normalize(b) ? -1 : normalize(a) > normalize(b) ? 1 : 0;
          return sort.direction === "desc" ? -result : result;
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
          writes.push(() => ref.__store.set(ref.id, { ...ref.__store.get(ref.id)!, ...data }));
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
          ref.__store.set(ref.id, { ...current, ...data });
        }),
        commit: async () => {
          batchState.commitCount += 1;
          if (batchState.failOnCommit === batchState.commitCount) throw new Error("injected_batch_failure");
          writes.forEach((write) => write());
        },
      };
    },
  }),
  Timestamp: {
    now: () => mockTimestamp,
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
  FieldValue: { serverTimestamp: () => mockTimestamp },
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

  function input(answer = "Exact submitted answer") {
    return {
      applicationId: "app-1",
      idempotencyKey: "pleo-submit-2026-07-13",
      submittedAt,
      followUpAt: new Date("2026-07-17T07:00:00Z"),
      answers: [{ question: "Why Pleo?", answer }],
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

  it("atomically records, verifies, and idempotently replays a package", async () => {
    const adapter = new FirestoreAdapter();
    const created = await adapter.recordApplicationSubmission(userId, input());

    expect(created.replayed).toBe(false);
    expect(created.verified).toBe(true);
    expect(created.application.status).toBe("applied");
    expect(created.submission.answers).toEqual([{ question: "Why Pleo?", answer: "Exact submitted answer" }]);
    expect(created.documents[0].state).toBe("submitted");
    expect(stores.applicationSubmissions).toHaveLength(1);
    expect(stores.applicationEvents).toHaveLength(1);

    const replay = await adapter.recordApplicationSubmission(userId, input());
    expect(replay.replayed).toBe(true);
    expect(stores.applicationSubmissions).toHaveLength(1);
    expect(stores.applicationEvents).toHaveLength(1);
  });

  it("rejects reuse of a historical submission artifact without partial writes", async () => {
    const adapter = new FirestoreAdapter();
    stores.documents.get("doc-1")!.state = "historical";

    await expect(adapter.recordApplicationSubmission(userId, input()))
      .rejects.toThrow("document_already_submitted");
    expect(stores.applicationSubmissions).toHaveLength(0);
    expect(stores.applicationEvents).toHaveLength(0);
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
    expect(stores.applicationSubmissions).toHaveLength(0);
    expect(stores.applicationEvents).toHaveLength(0);
  });

  it("rejects cross-user submission attempts without partial writes", async () => {
    const adapter = new FirestoreAdapter();
    await expect(
      adapter.recordApplicationSubmission("other-user", input()),
    ).rejects.toThrow("not_found");
    expect(stores.applicationSubmissions).toHaveLength(0);
    expect(stores.applicationEvents).toHaveLength(0);
  });

  it("rejects writes while application deletion is in progress", async () => {
    const adapter = new FirestoreAdapter();
    stores.applications.get("app-1")!.deletionState = "in_progress";

    await expect(adapter.recordApplicationSubmission(userId, input())).rejects.toThrow("application_deleting");
    expect(stores.applicationSubmissions).toHaveLength(0);
    expect(stores.applicationEvents).toHaveLength(0);
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
    expect(stores.applicationSubmissions).toHaveLength(0);
    expect(stores.applicationEvents).toHaveLength(0);
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
    expect(stores.applicationSubmissions).toHaveLength(0);
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
