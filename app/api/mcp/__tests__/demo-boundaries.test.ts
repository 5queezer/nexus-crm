import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listApplications: vi.fn(),
  getApplication: vi.fn(),
  listApplicationsFiltered: vi.fn(),
  findApplicationByCanonicalJobUrl: vi.fn(),
  listApplicationEventsFiltered: vi.fn(),
  listApplicationSubmissions: vi.fn(),
  getApplicationSubmission: vi.fn(),
  listApplicationEvents: vi.fn(),
  listDocumentsByApplication: vi.fn(),
  listUserSubmissions: vi.fn(),
  listDocuments: vi.fn(),
  listDocumentsFiltered: vi.fn(),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  recordApplicationEvent: vi.fn(),
  recordApplicationSubmission: vi.fn(),
  createContact: vi.fn(),
  batchCreateContacts: vi.fn(),
  updateDocumentLinks: vi.fn(),
  updateDocumentMetadata: vi.fn(),
  getDocument: vi.fn(),
  getCvProfile: vi.fn(),
  upsertCvPatch: vi.fn(),
  batchUpsertApplications: vi.fn(),
  batchDeleteApplications: vi.fn(),
}));
const generateAndStoreCv = vi.hoisted(() => vi.fn());
const downloadDocumentContent = vi.hoisted(() => vi.fn());
const uploadDocumentContent = vi.hoisted(() => vi.fn());
const deleteDocumentWithContent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getDb: () => mocks }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cv/generate", () => ({ generateAndStoreCv }));
vi.mock("@/lib/documents/download", () => ({ downloadDocumentContent }));
vi.mock("@/lib/documents/upload", () => ({ uploadDocumentContent, MAX_DOCUMENT_BASE64_SIZE: 1_000_000 }));
vi.mock("@/lib/documents/service", () => ({ deleteDocumentWithContent }));

import { createMcpServer } from "../route";

const DEMO_EXCLUDE = { demoVisibility: "exclude" };
const GUARDED_DOCUMENT_MUTATION = { requireNonDemoProvenance: true };
const auth = {
  userId: "owner-1",
  readScopeUserId: "owner-1",
  user: { id: "owner-1", name: "Owner", email: "owner@example.com", image: null, isAdmin: false },
  authType: "mcp_oauth" as const,
  scopes: ["mcp:tools", "mcp:submissions"],
};

let client: Client;
let server: ReturnType<typeof createMcpServer>;

async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

function textValue(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  if (content[0]?.type !== "text" || typeof content[0].text !== "string") throw new Error("expected text");
  return content[0].text;
}

function json(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse(textValue(result)) as Record<string, unknown>;
}

describe("MCP demo application boundaries", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.listApplications.mockResolvedValue([]);
    mocks.getApplication.mockResolvedValue(null);
    mocks.listApplicationsFiltered.mockResolvedValue([]);
    mocks.findApplicationByCanonicalJobUrl.mockResolvedValue(null);
    mocks.listApplicationEventsFiltered.mockResolvedValue({ items: [], nextCursor: null });
    mocks.listApplicationSubmissions.mockResolvedValue([]);
    mocks.getApplicationSubmission.mockResolvedValue(null);
    mocks.listApplicationEvents.mockResolvedValue([]);
    mocks.listDocumentsByApplication.mockResolvedValue([]);
    mocks.listUserSubmissions.mockResolvedValue([]);
    mocks.listDocuments.mockResolvedValue([]);
    mocks.listDocumentsFiltered.mockResolvedValue([]);
    mocks.getDocument.mockResolvedValue({ id: "doc-1", applications: [] });
    mocks.getCvProfile.mockResolvedValue({ id: "profile-1" });
    server = createMcpServer(auth);
    client = new Client({ name: "demo-boundary-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("excludes demos from application list, detail, filtered, and canonical URL reads", async () => {
    await call("list_applications");
    const detail = await call("get_application", { id: "demo-app" });
    await call("list_applications_filtered", { search: "demo" });
    const canonical = await call("find_application_by_job_url", { jobUrl: "https://example.com/jobs/demo" });

    expect(mocks.listApplicationsFiltered).toHaveBeenNthCalledWith(
      1,
      "owner-1",
      expect.objectContaining({ limit: 50 }),
      DEMO_EXCLUDE,
    );
    expect(mocks.getApplication).toHaveBeenCalledWith("demo-app", "owner-1", DEMO_EXCLUDE);
    expect(detail.isError).toBe(true);
    expect(mocks.listApplicationsFiltered).toHaveBeenNthCalledWith(2, "owner-1", expect.any(Object), DEMO_EXCLUDE);
    expect(json(canonical)).toMatchObject({ application: null });
    expect(mocks.findApplicationByCanonicalJobUrl).toHaveBeenCalledWith(
      "owner-1",
      "https://example.com/jobs/demo",
      DEMO_EXCLUDE,
    );
  });

  it("excludes demos from activity and rejects demo recall before reading child records", async () => {
    await call("list_application_activity", { applicationId: "demo-app" });
    const recall = await call("get_interview_recall_package", { applicationId: "demo-app" });

    expect(mocks.listApplicationEventsFiltered).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ applicationId: "demo-app" }),
      DEMO_EXCLUDE,
    );
    expect(recall.isError).toBe(true);
    expect(mocks.getApplication).toHaveBeenCalledWith("demo-app", "owner-1", DEMO_EXCLUDE);
    expect(mocks.listApplicationSubmissions).not.toHaveBeenCalled();
    expect(mocks.listApplicationEvents).not.toHaveBeenCalled();
    expect(mocks.listDocumentsByApplication).not.toHaveBeenCalled();
  });

  it("excludes demo-owned children from pipeline health findings", async () => {
    mocks.listApplications.mockResolvedValue([{
      id: "real-app", status: "inbound", appliedAt: null, followUpAt: null,
    }]);
    mocks.listUserSubmissions.mockResolvedValue([{
      id: "demo-submission", applicationId: "demo-app", answers: [], documentIds: [],
    }]);
    mocks.listDocuments.mockResolvedValue([{
      id: "demo-document", applications: [{ id: "demo-app" }],
    }]);

    const result = await call("pipeline_healthcheck");

    expect(mocks.listApplications).toHaveBeenCalledWith("owner-1", DEMO_EXCLUDE);
    expect(json(result)).toEqual({ healthy: true, findingCount: 0, findings: [] });
  });

  it("excludes documents owned only by a demo from list and detail reads", async () => {
    const demoDocument = { id: "demo-document", applications: [{ id: "demo-app" }] };
    mocks.listDocumentsFiltered.mockResolvedValue([demoDocument]);
    mocks.getDocument.mockResolvedValue(demoDocument);

    const listed = await call("list_documents");
    const detail = await call("get_document", { id: "demo-document" });

    expect(json(listed)).toEqual([]);
    expect(detail.isError).toBe(true);
    expect(textValue(detail)).toBe("Document not found");
    expect(mocks.getApplication).toHaveBeenCalledWith("demo-app", "owner-1", DEMO_EXCLUDE);
  });

  it("fails closed for documents with unresolved raw parent links across machine reads", async () => {
    const danglingDocument = {
      id: "dangling-document",
      applicationIds: ["deleted-demo-app"],
      applications: [],
    };
    mocks.listDocumentsFiltered.mockResolvedValue([danglingDocument]);
    mocks.listDocuments.mockResolvedValue([danglingDocument]);
    mocks.getDocument.mockResolvedValue(danglingDocument);

    const listed = await call("list_documents");
    const orphaned = await call("list_documents", { orphaned: true });
    const detail = await call("get_document", { id: danglingDocument.id });
    const download = await call("download_document_content", { id: danglingDocument.id });
    const health = await call("pipeline_healthcheck");

    expect(json(listed)).toEqual([]);
    expect(json(orphaned)).toEqual([]);
    expect(detail.isError).toBe(true);
    expect(download.isError).toBe(true);
    expect(downloadDocumentContent).not.toHaveBeenCalled();
    expect(json(health)).toEqual({ healthy: true, findingCount: 0, findings: [] });
  });

  it("strips raw and hidden parent IDs from mixed document responses and nested packages", async () => {
    const mixedDocument = {
      id: "mixed-document",
      applicationIds: ["real-app", "demo-app", "foreign-app", "dangling-app"],
      applications: [
        { id: "real-app" },
        { id: "demo-app" },
        { id: "foreign-app" },
      ],
    };
    const submission = { id: "submission-1", applicationId: "real-app", documents: [mixedDocument] };
    mocks.getApplication.mockImplementation(async (id: string) => id === "real-app" ? { id } : null);
    mocks.listDocumentsFiltered.mockResolvedValue([mixedDocument]);
    mocks.getDocument.mockResolvedValue(mixedDocument);
    mocks.listApplicationSubmissions.mockResolvedValue([submission]);
    mocks.getApplicationSubmission.mockResolvedValue(submission);
    mocks.listDocumentsByApplication.mockResolvedValue([mixedDocument]);

    const listed = await call("list_documents");
    const detail = await call("get_document", { id: mixedDocument.id });
    const submissionList = await call("list_application_submissions", { applicationId: "real-app" });
    const submissionDetail = await call("get_application_submission", { id: "submission-1" });
    const recall = await call("get_interview_recall_package", { applicationId: "real-app" });

    for (const result of [listed, detail, submissionList, submissionDetail, recall]) {
      const text = textValue(result);
      expect(text).toContain("real-app");
      expect(text).not.toContain("applicationIds");
      expect(text).not.toContain("demo-app");
      expect(text).not.toContain("foreign-app");
      expect(text).not.toContain("dangling-app");
    }
  });

  it("scans forward across adapter pages to fill the first logical visible document page", async () => {
    const hiddenPage = Array.from({ length: 200 }, (_, index) => ({
      id: `demo-document-${index}`,
      applications: [{ id: "demo-app" }],
    }));
    const realDocument = { id: "real-document", applications: [{ id: "real-app" }] };
    mocks.listDocumentsFiltered
      .mockResolvedValueOnce(hiddenPage)
      .mockResolvedValueOnce([realDocument]);
    mocks.getApplication.mockImplementation(async (id: string) =>
      id === "real-app" ? { id } : null,
    );

    const listed = await call("list_documents", { page: 1, pageSize: 1 });

    expect(json(listed)).toEqual([realDocument]);
    expect(mocks.listDocumentsFiltered).toHaveBeenNthCalledWith(
      1,
      "owner-1",
      expect.objectContaining({ page: 1, pageSize: 200, fields: undefined }),
    );
    expect(mocks.listDocumentsFiltered).toHaveBeenNthCalledWith(
      2,
      "owner-1",
      expect.objectContaining({ page: 2, pageSize: 200, fields: undefined }),
    );
    expect(mocks.getApplication.mock.calls.filter(([id]) => id === "demo-app")).toHaveLength(1);
    expect(mocks.getApplication.mock.calls.filter(([id]) => id === "real-app")).toHaveLength(1);
  });

  it("preserves logical pagination while scanning hidden document prefixes", async () => {
    const hiddenPrefix = Array.from({ length: 198 }, (_, index) => ({
      id: `demo-document-${index}`,
      applications: [{ id: "demo-app" }],
    }));
    const visibleDocuments = [1, 2, 3, 4].map((index) => ({
      id: `real-document-${index}`,
      applications: [{ id: "real-app" }],
    }));
    mocks.listDocumentsFiltered
      .mockResolvedValueOnce([...hiddenPrefix, ...visibleDocuments.slice(0, 2)])
      .mockResolvedValueOnce(visibleDocuments.slice(2));
    mocks.getApplication.mockImplementation(async (id: string) =>
      id === "real-app" ? { id } : null,
    );

    const listed = await call("list_documents", { page: 2, pageSize: 2 });

    expect(json(listed)).toEqual(visibleDocuments.slice(2));
  });

  it("rejects document pages beyond the declared logical pagination bound", async () => {
    const listed = await call("list_documents", { page: 21, pageSize: 1 });

    expect(listed.isError).toBe(true);
    expect(mocks.listDocumentsFiltered).not.toHaveBeenCalled();
  });

  it("fails explicitly instead of returning an incomplete page at the scan bound", async () => {
    const hiddenPage = Array.from({ length: 200 }, (_, index) => ({
      id: `demo-document-${index}`,
      applications: [{ id: "demo-app" }],
    }));
    for (let page = 0; page < 21; page += 1) {
      mocks.listDocumentsFiltered.mockResolvedValueOnce(hiddenPage);
    }
    mocks.listDocumentsFiltered.mockResolvedValueOnce([]);

    const listed = await call("list_documents", { page: 1, pageSize: 1 });

    expect(listed.isError).toBe(true);
    expect(json(listed)).toEqual({
      error: { code: "document_scan_limit_exceeded", maxScannedDocuments: 4000 },
    });
    expect(mocks.listDocumentsFiltered).toHaveBeenCalledTimes(20);
  });

  const mutationCases = [
    { name: "update", tool: "update_application", args: { id: "demo-app", company: "Changed" }, mutation: "updateApplication" },
    { name: "delete", tool: "delete_application", args: { id: "demo-app" }, mutation: "deleteApplication" },
    { name: "event", tool: "record_application_event", args: { applicationId: "demo-app", type: "note_added", metadata: { note: "x" } }, mutation: "recordApplicationEvent" },
    { name: "note", tool: "append_application_note", args: { applicationId: "demo-app", note: "x", occurredAt: "2026-08-10T10:00:00.000Z", idempotencyKey: "demo-note" }, mutation: "recordApplicationEvent" },
    { name: "contact", tool: "create_contact", args: { applicationId: "demo-app", name: "Recruiter" }, mutation: "createContact" },
    { name: "batch contact", tool: "batch_create_contacts", args: { applicationId: "demo-app", contacts: [{ name: "Recruiter" }] }, mutation: "batchCreateContacts" },
    { name: "submission", tool: "record_application_submission", args: { applicationId: "demo-app", submittedAt: "2026-08-10T10:00:00.000Z", idempotencyKey: "demo-submission", answers: [], documentIds: [] }, mutation: "recordApplicationSubmission" },
    { name: "document link", tool: "update_document_links", args: { id: "doc-1", applicationIds: ["demo-app"] }, mutation: "updateDocumentLinks" },
    { name: "document metadata", tool: "update_document_metadata", args: { id: "demo-document", documentType: "resume" }, mutation: "updateDocumentMetadata" },
    { name: "CV", tool: "generate_tailored_cv", args: { applicationId: "demo-app", experienceIds: [], skillCategories: [] }, mutation: "upsertCvPatch" },
    { name: "batch update", tool: "batch_upsert_applications", args: { items: [{ id: "demo-app", company: "Changed" }] }, mutation: "batchUpsertApplications" },
    { name: "batch delete", tool: "batch_delete_applications", args: { ids: ["demo-app"] }, mutation: "batchDeleteApplications" },
  ] as const;

  it.each(mutationCases)("rejects demo-targeted $name before mutation", async ({ name, tool, args, mutation }) => {
    if (name === "document metadata") {
      mocks.getDocument.mockResolvedValue({ id: "demo-document", applications: [{ id: "demo-app" }] });
    }
    const result = await call(tool, args);

    expect(result.isError).toBe(true);
    expect(mocks.getApplication).toHaveBeenCalledWith("demo-app", "owner-1", DEMO_EXCLUDE);
    expect(mocks[mutation]).not.toHaveBeenCalled();
    expect(generateAndStoreCv).not.toHaveBeenCalled();
  });

  it("rejects uploading and linking a document to a demo before storage mutation", async () => {
    const result = await call("upload_document_content", {
      filename: "resume.pdf",
      mimeType: "application/pdf",
      contentBase64: "YQ==",
      applicationIds: ["demo-app"],
    });

    expect(result.isError).toBe(true);
    expect(mocks.getApplication).toHaveBeenCalledWith("demo-app", "owner-1", DEMO_EXCLUDE);
    expect(uploadDocumentContent).not.toHaveBeenCalled();
  });

  it("rejects relinking an existing demo-only document before checking replacement links", async () => {
    mocks.getDocument.mockResolvedValue({
      id: "demo-document",
      applications: [{ id: "demo-app" }],
    });

    const result = await call("update_document_links", {
      id: "demo-document",
      applicationIds: [],
    });

    expect(result.isError).toBe(true);
    expect(mocks.getDocument).toHaveBeenCalledWith("demo-document", "owner-1");
    expect(mocks.getApplication).toHaveBeenCalledWith("demo-app", "owner-1", DEMO_EXCLUDE);
    expect(mocks.updateDocumentLinks).not.toHaveBeenCalled();
  });

  it("rejects downloading content for a demo-only document before storage access", async () => {
    mocks.getDocument.mockResolvedValue({
      id: "demo-document",
      applications: [{ id: "demo-app" }],
    });

    const result = await call("download_document_content", { id: "demo-document" });

    expect(result.isError).toBe(true);
    expect(downloadDocumentContent).not.toHaveBeenCalled();
  });

  it("rejects deleting a document linked only to a demo before storage mutation", async () => {
    mocks.getDocument.mockResolvedValue({ id: "demo-document", applications: [{ id: "demo-app" }] });

    const result = await call("delete_document", { id: "demo-document" });

    expect(result.isError).toBe(true);
    expect(mocks.getApplication).toHaveBeenCalledWith("demo-app", "owner-1", DEMO_EXCLUDE);
    expect(deleteDocumentWithContent).not.toHaveBeenCalled();
  });

  it("passes the transaction-time demo guard to every document mutation", async () => {
    const realDocument = { id: "doc-1", applications: [] };
    mocks.getDocument.mockResolvedValue(realDocument);
    mocks.getApplication.mockResolvedValue({ id: "real-app" });
    mocks.updateDocumentLinks.mockResolvedValue(realDocument);
    mocks.updateDocumentMetadata.mockResolvedValue(realDocument);
    deleteDocumentWithContent.mockResolvedValue(realDocument);

    await call("update_document_links", { id: "doc-1", applicationIds: ["real-app"] });
    await call("update_document_metadata", { id: "doc-1", documentType: "resume" });
    await call("delete_document", { id: "doc-1" });

    expect(mocks.updateDocumentLinks).toHaveBeenCalledWith(
      "doc-1",
      "owner-1",
      ["real-app"],
      GUARDED_DOCUMENT_MUTATION,
    );
    expect(mocks.updateDocumentMetadata).toHaveBeenCalledWith(
      "doc-1",
      "owner-1",
      expect.objectContaining({ documentType: "resume" }),
      GUARDED_DOCUMENT_MUTATION,
    );
    expect(deleteDocumentWithContent).toHaveBeenCalledWith(
      mocks,
      "doc-1",
      "owner-1",
      GUARDED_DOCUMENT_MUTATION,
    );
  });

  it("sanitizes upload, relink, and metadata mutation document responses", async () => {
    const mixedDocument = {
      id: "doc-1",
      applicationIds: ["real-app", "demo-app", "foreign-app", "dangling-app"],
      applications: [{ id: "real-app" }, { id: "demo-app" }, { id: "foreign-app" }],
    };
    mocks.getDocument.mockResolvedValue(mixedDocument);
    mocks.getApplication.mockImplementation(async (id: string) => id === "real-app" ? { id } : null);
    mocks.updateDocumentLinks.mockResolvedValue(mixedDocument);
    mocks.updateDocumentMetadata.mockResolvedValue(mixedDocument);
    uploadDocumentContent.mockImplementation(async (
      _args: unknown,
      _userId: string,
      sanitize: (document: typeof mixedDocument) => Promise<typeof mixedDocument | null>,
    ) => {
      const visible = await sanitize(mixedDocument);
      return { content: [{ type: "text", text: JSON.stringify(visible) }] };
    });

    const relink = await call("update_document_links", { id: "doc-1", applicationIds: ["real-app"] });
    const metadata = await call("update_document_metadata", { id: "doc-1", documentType: "resume" });
    const upload = await call("upload_document_content", {
      filename: "resume.pdf", mimeType: "application/pdf", contentBase64: "YQ==", applicationIds: ["real-app"],
    });

    for (const result of [relink, metadata, upload]) {
      const text = textValue(result);
      expect(text).toContain("real-app");
      expect(text).not.toContain("applicationIds");
      expect(text).not.toContain("demo-app");
      expect(text).not.toContain("foreign-app");
      expect(text).not.toContain("dangling-app");
    }
  });
});
