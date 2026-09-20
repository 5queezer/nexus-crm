import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordApplicationEvent: vi.fn(),
  listApplicationEventsFiltered: vi.fn(),
  getApplication: vi.fn(),
  findApplicationByCanonicalJobUrl: vi.fn(),
  updateApplication: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    recordApplicationEvent: mocks.recordApplicationEvent,
    listApplicationEventsFiltered: mocks.listApplicationEventsFiltered,
    getApplication: mocks.getApplication,
    findApplicationByCanonicalJobUrl: mocks.findApplicationByCanonicalJobUrl,
    updateApplication: mocks.updateApplication,
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cv/generate", () => ({ generateAndStoreCv: vi.fn() }));
vi.mock("@/lib/documents/download", () => ({ downloadDocumentContent: vi.fn() }));
vi.mock("@/lib/documents/upload", () => ({ uploadDocumentContent: vi.fn(), MAX_DOCUMENT_BASE64_SIZE: 1_000_000 }));
vi.mock("@/lib/documents/service", () => ({ deleteDocumentWithContent: vi.fn() }));

import { createMcpServer } from "../route";

const auth = (scopes = ["mcp:tools"]) => ({
  userId: "owner-1",
  readScopeUserId: "owner-1",
  user: { id: "owner-1", name: "Owner", email: "owner@example.com", image: null, isAdmin: false },
  authType: "mcp_oauth" as const,
  scopes,
});

let client: Client;
let server: ReturnType<typeof createMcpServer>;

async function connect(scopes?: string[]) {
  server = createMcpServer(auth(scopes));
  client = new Client({ name: "event-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

function textValue(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  const item = content[0];
  if (item?.type !== "text" || typeof item.text !== "string") throw new Error("expected text content");
  return item.text;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>) {
  return JSON.parse(textValue(result)) as Record<string, unknown>;
}

describe("MCP application event contracts", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await connect();
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("records a typed event with MCP provenance and controlled replay output", async () => {
    mocks.getApplication.mockResolvedValue({ id: "app-1" });
    mocks.recordApplicationEvent.mockResolvedValue({ event: { id: "event-1" }, application: { id: "app-1" }, replayed: false });
    const result = await client.callTool({
      name: "record_application_event",
      arguments: {
        applicationId: "app-1",
        type: "stage_changed",
        occurredAt: "2026-07-24T09:00:00.000Z",
        idempotencyKey: "stage-key",
        metadata: { toStage: "technical" },
      },
    });
    expect(result.isError).not.toBe(true);
    expect(text(result)).toMatchObject({ event: { id: "event-1" }, replayed: false });
    expect(mocks.recordApplicationEvent).toHaveBeenCalledWith("app-1", "owner-1", expect.objectContaining({
      type: "stage_changed",
      source: "mcp",
      actor: "owner@example.com",
    }));
  });

  it("lists an owner-scoped cursor page in deterministic order", async () => {
    mocks.getApplication.mockResolvedValue({ id: "app-1" });
    mocks.listApplicationEventsFiltered.mockResolvedValue({ items: [{ id: "event-1" }], nextCursor: null });
    const result = await client.callTool({
      name: "list_application_events",
      arguments: { applicationId: "app-1", order: "oldest", limit: 20 },
    });
    expect(text(result)).toEqual({ items: [{ id: "event-1" }], nextCursor: null });
    expect(mocks.listApplicationEventsFiltered).toHaveBeenCalledWith("owner-1", expect.objectContaining({
      applicationId: "app-1", order: "oldest", limit: 20,
    }), { demoVisibility: "exclude" });
    expect(mocks.getApplication).toHaveBeenCalledWith("app-1", "owner-1", { demoVisibility: "exclude" });
  });

  it("does not let duplicate-safe upserts bypass lifecycle events", async () => {
    mocks.findApplicationByCanonicalJobUrl.mockResolvedValue({ id: "app-1", status: "inbound" });
    const result = await client.callTool({
      name: "upsert_application_by_job_url",
      arguments: {
        company: "Acme",
        role: "Engineer",
        jobUrl: "https://example.com/jobs/1",
        status: "offer",
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatchObject({ error: { code: "lifecycle_event_required" } });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("does not let duplicate-safe upserts bypass stage events", async () => {
    mocks.findApplicationByCanonicalJobUrl.mockResolvedValue({
      id: "app-1",
      status: "inbound",
      currentStage: "sourced",
    });
    const result = await client.callTool({
      name: "upsert_application_by_job_url",
      arguments: {
        company: "Acme",
        role: "Engineer",
        jobUrl: "https://example.com/jobs/1",
        currentStage: "screening",
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatchObject({ error: { code: "lifecycle_event_required" } });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("rejects lifecycle changes through update_application", async () => {
    const result = await client.callTool({
      name: "update_application",
      arguments: { id: "app-1", status: "offer" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatchObject({ error: { code: "lifecycle_event_required", fields: ["status"] } });
  });

  it("exposes archivedAt as an optional nullable ISO datetime in update_application", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find(({ name }) => name === "update_application");
    const properties = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties;

    expect(properties).toHaveProperty("archivedAt");
    expect(properties?.archivedAt).toMatchObject({
      anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    });
  });

  it("archives and reads back an application without changing lifecycle data", async () => {
    const archivedAt = "2026-09-20T12:57:21.000Z";
    let stored = {
      id: "app-1",
      company: "Acme",
      status: "interview",
      appliedAt: new Date("2026-01-10T09:00:00.000Z"),
      lastContact: new Date("2026-09-10T09:00:00.000Z"),
      followUpAt: new Date("2026-09-25T09:00:00.000Z"),
      currentStage: "technical",
      notes: "Keep unchanged",
      contacts: [{ id: "contact-1" }],
      submissions: [{ id: "submission-1" }],
      documents: [{ id: "document-1" }],
      archivedAt: null,
      updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    };
    mocks.getApplication.mockImplementation(async () => stored);
    mocks.updateApplication.mockImplementation(async (_id: string, _userId: string, update: Record<string, unknown>) => {
      stored = { ...stored, ...update };
      return stored;
    });

    const archive = await client.callTool({
      name: "update_application",
      arguments: { id: "app-1", archivedAt },
    });
    const readback = await client.callTool({ name: "get_application", arguments: { id: "app-1" } });

    expect(archive.isError).not.toBe(true);
    expect(mocks.updateApplication).toHaveBeenCalledWith(
      "app-1",
      "owner-1",
      { archivedAt: new Date(archivedAt) },
    );
    expect(text(readback)).toMatchObject({
      id: "app-1",
      archivedAt,
      status: "interview",
      appliedAt: "2026-01-10T09:00:00.000Z",
      lastContact: "2026-09-10T09:00:00.000Z",
      followUpAt: "2026-09-25T09:00:00.000Z",
      currentStage: "technical",
      notes: "Keep unchanged",
      contacts: [{ id: "contact-1" }],
      submissions: [{ id: "submission-1" }],
      documents: [{ id: "document-1" }],
    });
  });

  it("unarchives by persisting archivedAt: null", async () => {
    const current = { id: "app-1", archivedAt: new Date("2026-09-20T12:57:21.000Z"), updatedAt: new Date() };
    mocks.getApplication.mockResolvedValue(current);
    mocks.updateApplication.mockResolvedValue({ ...current, archivedAt: null });

    const result = await client.callTool({
      name: "update_application",
      arguments: { id: "app-1", archivedAt: null },
    });

    expect(result.isError).not.toBe(true);
    expect(mocks.updateApplication).toHaveBeenCalledWith("app-1", "owner-1", { archivedAt: null });
    expect(text(result)).toMatchObject({ archivedAt: null });
  });

  it("previews an archive without writing", async () => {
    const archivedAt = "2026-09-20T12:57:21.000Z";
    mocks.getApplication.mockResolvedValue({ id: "app-1", archivedAt: null, updatedAt: new Date() });

    const result = await client.callTool({
      name: "update_application",
      arguments: { id: "app-1", archivedAt, dryRun: true },
    });

    expect(result.isError).not.toBe(true);
    expect(text(result)).toMatchObject({ dryRun: true, application: { archivedAt } });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("rejects an invalid archive timestamp before mutation", async () => {
    const result = await client.callTool({
      name: "update_application",
      arguments: { id: "app-1", archivedAt: "not-a-timestamp" },
    });

    expect(result.isError).toBe(true);
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("does not archive an application outside the callers ownership scope", async () => {
    mocks.getApplication.mockResolvedValue(null);

    const result = await client.callTool({
      name: "update_application",
      arguments: { id: "foreign-app", archivedAt: "2026-09-20T12:57:21.000Z" },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toEqual({ error: { code: "not_found" } });
    expect(mocks.getApplication).toHaveBeenCalledWith(
      "foreign-app",
      "owner-1",
      { demoVisibility: "exclude" },
    );
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("keeps expectedUpdatedAt conflicts enforced for archival updates", async () => {
    mocks.getApplication.mockResolvedValue({
      id: "app-1",
      archivedAt: null,
      updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    });

    const result = await client.callTool({
      name: "update_application",
      arguments: {
        id: "app-1",
        archivedAt: "2026-09-20T12:57:21.000Z",
        expectedUpdatedAt: "2026-09-20T09:00:00.000Z",
        dryRun: true,
      },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toEqual({ error: { code: "conflict" } });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("keeps existing non-lifecycle update behavior unchanged", async () => {
    const current = { id: "app-1", company: "Acme", archivedAt: null, updatedAt: new Date() };
    mocks.getApplication.mockResolvedValue(current);
    mocks.updateApplication.mockResolvedValue({ ...current, company: "Renamed" });

    const result = await client.callTool({
      name: "update_application",
      arguments: { id: "app-1", company: "Renamed" },
    });

    expect(result.isError).not.toBe(true);
    expect(mocks.updateApplication).toHaveBeenCalledWith("app-1", "owner-1", { company: "Renamed" });
  });

  it("describes the accepted event metadata schema", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find(({ name }) => name === "record_application_event");

    expect(tool?.description).toContain("Metadata is a JSON object with event-specific keys");
    expect(tool?.description).toContain("stage_changed {toStage: string, fromStage?, toStatus?}");
    expect(tool?.description).toContain("interview_scheduled {interviewType: string, scheduledAt: ISO 8601 date-time");
    expect(tool?.description).toContain("Unknown keys are rejected");
  });

  it("returns actionable diagnostics for invalid event metadata", async () => {
    mocks.getApplication.mockResolvedValue({ id: "app-1" });
    const result = await client.callTool({
      name: "record_application_event",
      arguments: {
        applicationId: "app-1",
        type: "interview_scheduled",
        metadata: {
          interviewType: "technical",
          scheduledAt: "2026-07-28T12:30:00.000Z",
          durationMinutes: "sixty",
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toEqual({
      error: {
        code: "event_metadata_invalid",
        path: "metadata.durationMinutes",
        expected: "integer from 1 to 1440",
        reason: "durationMinutes must be an integer from 1 to 1440",
      },
    });
    expect(mocks.recordApplicationEvent).not.toHaveBeenCalled();
  });

  it("does not expose the workflow-reserved submission event through the generic tool", async () => {
    const result = await client.callTool({
      name: "record_application_event",
      arguments: { applicationId: "app-1", type: "application_submitted" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatchObject({
      error: { code: "submission_event_requires_submission_workflow" },
    });
    expect(mocks.recordApplicationEvent).not.toHaveBeenCalled();
  });
});
