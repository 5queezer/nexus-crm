import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (available inside vi.mock factories) ──────────────────────

const { mockGetAll, stores, mockTimestamp } = vi.hoisted(() => {
  const stores = {
    applications: new Map<string, Record<string, unknown>>(),
    documents: new Map<string, Record<string, unknown>>(),
    contacts: new Map<string, Record<string, unknown>>(),
  };

  const mockGetAll = vi.fn();
  const mockTimestamp = { toDate: () => new Date("2025-01-01") };

  return { mockGetAll, stores, mockTimestamp };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface MockSnap {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
  ref: { id: string };
}

function makeDocRef(store: Map<string, Record<string, unknown>>, id: string) {
  return {
    id,
    ref: { id },
    async get(): Promise<MockSnap> {
      const data = store.get(id);
      return { id, exists: !!data, data: () => data, ref: { id } };
    },
    async update(d: Record<string, unknown>) {
      const existing = store.get(id);
      if (existing) store.set(id, { ...existing, ...d });
    },
    async delete() { store.delete(id); },
  };
}

function makeCollection(store: Map<string, Record<string, unknown>>) {
  return {
    doc: (id: string) => makeDocRef(store, id),
    async add(data: Record<string, unknown>) {
      const id = `generated-${store.size + 1}`;
      store.set(id, data);
      return {
        id,
        async get(): Promise<MockSnap> {
          return { id, exists: true, data: () => store.get(id)!, ref: { id } };
        },
      };
    },
    orderBy() {
      return {
        where() { return { async get() { return { docs: [] }; } }; },
        async get() { return { docs: [] }; },
      };
    },
    where() {
      return { async get() { return { docs: [] }; } };
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
    batch: () => ({ delete: vi.fn(), commit: vi.fn() }),
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
        ref: { id: r.id },
      };
    }),
  );
}

function seedDocs(docs: Array<{ id: string; userId: string; filename: string; originalName: string; size: number; mimeType: string; applicationIds: string[] }>) {
  stores.documents.clear();
  for (const d of docs) {
    stores.documents.set(d.id, {
      userId: d.userId,
      filename: d.filename,
      originalName: d.originalName,
      size: d.size,
      mimeType: d.mimeType,
      applicationIds: d.applicationIds,
      uploadedAt: mockTimestamp,
    });
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

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

  describe("createDocument", () => {
    it("uses getAll (batch) instead of individual get() calls", async () => {
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

      expect(mockGetAll).toHaveBeenCalledTimes(1);
      expect(result.applications).toHaveLength(2);
      expect(result.applications![0].company).toBe("Acme");
      expect(result.applications![1].company).toBe("Globex");
    });

    it("filters out apps not owned by the user", async () => {
      seedApps([
        { id: "app-1", userId, company: "Acme", role: "Dev" },
        { id: "app-2", userId: "other-user", company: "Evil Corp", role: "Spy" },
      ]);

      const result = await adapter.createDocument(userId, {
        filename: "doc.pdf",
        originalName: "doc.pdf",
        size: 512,
        mimeType: "application/pdf",
        applicationIds: ["app-1", "app-2"],
      });

      expect(result.applications).toHaveLength(1);
      expect(result.applications![0].company).toBe("Acme");
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

    it("filters out non-existent app IDs", async () => {
      seedApps([
        { id: "app-1", userId, company: "Acme", role: "Dev" },
      ]);

      const result = await adapter.createDocument(userId, {
        filename: "test.pdf",
        originalName: "test.pdf",
        size: 100,
        mimeType: "application/pdf",
        applicationIds: ["app-1", "app-nonexistent"],
      });

      expect(result.applications).toHaveLength(1);
      expect(result.applications![0].id).toBe("app-1");
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
      ).rejects.toThrow("Not found");
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
  });

  describe("batch chunking", () => {
    it("chunks into batches of 30 for large app lists", async () => {
      const apps = Array.from({ length: 35 }, (_, i) => ({
        id: `app-${i}`, userId, company: `Co-${i}`, role: "Eng",
      }));
      seedApps(apps);

      let callCount = 0;
      mockGetAll.mockImplementation(async (...refs: Array<{ id: string }>) => {
        callCount++;
        return refs.map((r) => {
          const data = stores.applications.get(r.id);
          return { id: r.id, exists: !!data, data: () => data, ref: { id: r.id } };
        });
      });

      const result = await adapter.createDocument(userId, {
        filename: "big.pdf",
        originalName: "big.pdf",
        size: 9999,
        mimeType: "application/pdf",
        applicationIds: apps.map((a) => a.id),
      });

      // 35 apps → 2 chunks (30 + 5)
      expect(callCount).toBe(2);
      expect(result.applications).toHaveLength(35);
    });
  });
});
