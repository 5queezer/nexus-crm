import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const realApp = { id: 1, userId: "owner-1", company: "Real", role: "Engineer", isDemo: false };
  const demoApp = { id: 2, userId: "owner-1", company: "Demo", role: "Explorer", isDemo: true };
  let applications = [demoApp];
  let document: Record<string, unknown> | null;

  const reset = () => {
    applications = [demoApp];
    document = {
      id: 1,
      userId: "owner-1",
      filename: "stored.pdf",
      originalName: "resume.pdf",
      mimeType: "application/pdf",
      size: 100,
      documentType: "resume",
      state: "current",
      version: 1,
      contentHash: null,
      source: null,
      generatedAt: null,
      submittedAt: null,
      submissionId: null,
      demoProvenance: false,
      uploadedAt: new Date("2026-08-10T00:00:00Z"),
    };
  };
  reset();

  const documentApi = {
    findFirstOrThrow: vi.fn(async () => {
      if (!document) throw new Error("not_found");
      return { ...document, applications };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (!document) throw new Error("not_found");
      document = { ...document, ...data };
      return { ...document, applications };
    }),
    delete: vi.fn(async () => {
      if (!document) throw new Error("not_found");
      const deleted = document;
      document = null;
      return deleted;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 3,
      userId: "owner-1",
      filename: "new.pdf",
      originalName: "new.pdf",
      mimeType: "application/pdf",
      size: 100,
      documentType: "other",
      state: "current",
      version: 1,
      contentHash: null,
      source: "upload",
      generatedAt: null,
      submittedAt: null,
      submissionId: null,
      demoProvenance: false,
      uploadedAt: new Date("2026-08-10T00:00:00Z"),
      ...data,
      applications: [],
    })),
  };
  const applicationApi = {
    findMany: vi.fn(async ({ where }: { where: { id: { in: number[] }; userId: string; isDemo?: boolean } }) =>
      [realApp, demoApp].filter((app) =>
        where.id.in.includes(app.id)
        && app.userId === where.userId
        && (where.isDemo === undefined || app.isDemo === where.isDemo),
      ).map(({ id, isDemo }) => ({ id, isDemo })),
    ),
  };
  const transaction = {
    $queryRaw: vi.fn(async () => document ? [{ submissionId: null, state: document.state }] : []),
    document: documentApi,
    application: applicationApi,
    shareLink: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };

  return {
    prisma,
    transaction,
    documentApi,
    applicationApi,
    reset,
    useReal: () => { applications = [realApp]; },
    useMixed: () => { applications = [realApp, demoApp]; },
    useDetachedDemo: () => {
      applications = [];
      if (document) document.demoProvenance = true;
    },
    currentDocument: () => document,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: fake.prisma }));

import { PrismaAdapter } from "../prisma-adapter";

const adapter = new PrismaAdapter();
const guard = { requireNonDemoProvenance: true } as const;

describe("Prisma guarded document mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.reset();
  });

  it("serializes document association writes with demo workspace deletion", async () => {
    fake.useReal();

    await adapter.createDocument("owner-1", {
      filename: "new.pdf",
      originalName: "new.pdf",
      mimeType: "application/pdf",
      size: 100,
      applicationIds: ["1"],
    });
    const createQueries = (fake.transaction.$queryRaw.mock.calls as unknown[][])
      .map((call) => String(call[0]));
    expect(createQueries.some((query) => query.includes('FROM "User"'))).toBe(true);

    fake.transaction.$queryRaw.mockClear();
    await adapter.updateDocumentLinks("1", "owner-1", ["1"]);
    const relinkQueries = (fake.transaction.$queryRaw.mock.calls as unknown[][])
      .map((call) => String(call[0]));
    expect(relinkQueries.some((query) => query.includes('FROM "User"'))).toBe(true);
    expect(relinkQueries.some((query) => query.includes('FROM "Document"'))).toBe(true);
  });

  it("persists sticky demo provenance on creation and relinking", async () => {
    await adapter.createDocument("owner-1", {
      filename: "new.pdf", originalName: "new.pdf", mimeType: "application/pdf",
      size: 100, applicationIds: ["2"],
    });
    expect(fake.documentApi.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ demoProvenance: true }),
    }));

    await adapter.updateDocumentLinks("1", "owner-1", ["2"]);
    expect(fake.currentDocument()).toMatchObject({ demoProvenance: true });
    fake.useReal();
    await expect(adapter.updateDocumentLinks("1", "owner-1", ["1"], guard))
      .resolves.toMatchObject({ demoProvenance: true });
    await expect(adapter.updateDocumentMetadata("1", "owner-1", { version: 2 }, guard))
      .resolves.toMatchObject({ version: 2, demoProvenance: true });
  });

  it("rejects metadata, relink, and delete for demo-only current provenance", async () => {
    await expect(adapter.updateDocumentMetadata("1", "owner-1", { version: 2 }, guard))
      .rejects.toThrow("not_found");
    await expect(adapter.updateDocumentLinks("1", "owner-1", [], guard))
      .rejects.toThrow("not_found");
    await expect(adapter.deleteDocument("1", "owner-1", guard))
      .rejects.toThrow("not_found");

    expect(fake.currentDocument()).toMatchObject({ version: 1 });
    expect(fake.documentApi.update).not.toHaveBeenCalled();
    expect(fake.documentApi.delete).not.toHaveBeenCalled();
  });

  it("rejects guarded mutations for detached sticky demo provenance", async () => {
    fake.useDetachedDemo();

    await expect(adapter.updateDocumentMetadata("1", "owner-1", { version: 2 }, guard))
      .rejects.toThrow("not_found");
    await expect(adapter.updateDocumentLinks("1", "owner-1", ["1"], guard))
      .rejects.toThrow("not_found");
    await expect(adapter.deleteDocument("1", "owner-1", guard))
      .rejects.toThrow("not_found");

    expect(fake.currentDocument()).toMatchObject({ version: 1, demoProvenance: true });
    expect(fake.documentApi.update).not.toHaveBeenCalled();
    expect(fake.documentApi.delete).not.toHaveBeenCalled();
  });

  it("rejects a demo replacement even when current provenance is real", async () => {
    fake.useReal();

    await expect(adapter.updateDocumentLinks("1", "owner-1", ["2"], guard))
      .rejects.toThrow("invalid_applications");
    expect(fake.documentApi.update).not.toHaveBeenCalled();
  });

  it("rejects a demo parent inside guarded document creation", async () => {
    await expect(adapter.createDocument("owner-1", {
      filename: "new.pdf",
      originalName: "new.pdf",
      mimeType: "application/pdf",
      size: 100,
      applicationIds: ["2"],
    }, guard)).rejects.toThrow("invalid_applications");
    expect(fake.documentApi.create).not.toHaveBeenCalled();
  });

  it("allows guarded mutations for real or mixed current provenance", async () => {
    fake.useReal();
    await expect(adapter.updateDocumentMetadata("1", "owner-1", { version: 2 }, guard))
      .resolves.toMatchObject({ version: 2 });

    fake.useMixed();
    await expect(adapter.updateDocumentLinks("1", "owner-1", ["1"], guard))
      .resolves.toMatchObject({ id: "1" });
  });
});
