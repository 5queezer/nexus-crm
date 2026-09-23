import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApplication: vi.fn(),
  updateApplication: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cv/generate", () => ({ generateAndStoreCv: vi.fn() }));
vi.mock("@/lib/documents/download", () => ({ downloadDocumentContent: vi.fn() }));
vi.mock("@/lib/documents/upload", () => ({ uploadDocumentContent: vi.fn(), MAX_DOCUMENT_BASE64_SIZE: 1_000_000 }));
vi.mock("@/lib/documents/service", () => ({ deleteDocumentWithContent: vi.fn() }));

import { createMcpServer } from "../route";

const auth = {
  userId: "owner-1",
  readScopeUserId: "owner-1",
  user: { id: "owner-1", name: "Owner", email: "owner@example.com", image: null, isAdmin: false },
  authType: "mcp_oauth" as const,
  scopes: ["mcp:tools"],
};

const activeApplication = {
  id: "app-1",
  company: "Acme",
  role: "Engineer",
  status: "inbound",
  currentStage: "New lead",
  appliedAt: null,
  archivedAt: null,
  updatedAt: new Date("2026-09-23T10:00:00.000Z"),
};

let client: Client;
let server: ReturnType<typeof createMcpServer>;

function json(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  if (content[0]?.type !== "text" || typeof content[0].text !== "string") {
    throw new Error("expected text content");
  }
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("MCP application archiving", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    server = createMcpServer(auth);
    client = new Client({ name: "archive-contract-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("exposes dedicated archive and unarchive tools", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["archive_application", "unarchive_application"]),
    );
  });

  it("archives without changing lifecycle fields", async () => {
    const archivedAt = "2026-09-23T12:00:00.000Z";
    mocks.getApplication.mockResolvedValue(activeApplication);
    mocks.updateApplication.mockResolvedValue({
      ...activeApplication,
      archivedAt: new Date(archivedAt),
      updatedAt: new Date("2026-09-23T12:00:01.000Z"),
    });

    const result = await client.callTool({
      name: "archive_application",
      arguments: {
        id: "app-1",
        archivedAt,
        expectedUpdatedAt: "2026-09-23T10:00:00.000Z",
      },
    });

    expect(result.isError).not.toBe(true);
    expect(json(result)).toMatchObject({
      changed: true,
      application: { id: "app-1", status: "inbound", currentStage: "New lead" },
    });
    expect(mocks.getApplication).toHaveBeenCalledWith(
      "app-1",
      "owner-1",
      { demoVisibility: "exclude" },
    );
    expect(mocks.updateApplication).toHaveBeenCalledWith("app-1", "owner-1", {
      archivedAt: new Date(archivedAt),
      expectedUpdatedAt: new Date("2026-09-23T10:00:00.000Z"),
    });
  });

  it("previews archive without writing", async () => {
    mocks.getApplication.mockResolvedValue(activeApplication);

    const result = await client.callTool({
      name: "archive_application",
      arguments: {
        id: "app-1",
        archivedAt: "2026-09-23T12:00:00.000Z",
        expectedUpdatedAt: "2026-09-23T10:00:00.000Z",
        dryRun: true,
      },
    });

    expect(json(result)).toMatchObject({
      dryRun: true,
      changed: true,
      application: { id: "app-1", archivedAt: "2026-09-23T12:00:00.000Z" },
    });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("treats repeated archive calls as idempotent", async () => {
    const archived = {
      ...activeApplication,
      archivedAt: new Date("2026-09-23T11:00:00.000Z"),
    };
    mocks.getApplication.mockResolvedValue(archived);

    const result = await client.callTool({
      name: "archive_application",
      arguments: { id: "app-1", archivedAt: "2026-09-23T12:00:00.000Z" },
    });

    expect(json(result)).toMatchObject({ changed: false, application: { id: "app-1" } });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("unarchives idempotently", async () => {
    const archived = {
      ...activeApplication,
      archivedAt: new Date("2026-09-23T11:00:00.000Z"),
    };
    mocks.getApplication.mockResolvedValue(archived);
    mocks.updateApplication.mockResolvedValue({ ...archived, archivedAt: null });

    const result = await client.callTool({
      name: "unarchive_application",
      arguments: { id: "app-1" },
    });

    expect(result.isError).not.toBe(true);
    expect(json(result)).toMatchObject({ changed: true, application: { id: "app-1", archivedAt: null } });
    expect(mocks.updateApplication).toHaveBeenCalledWith("app-1", "owner-1", {
      archivedAt: null,
      expectedUpdatedAt: new Date("2026-09-23T10:00:00.000Z"),
    });
  });

  it("accepts ISO 8601 timestamps with timezone offsets", async () => {
    mocks.getApplication.mockResolvedValue(activeApplication);

    const result = await client.callTool({
      name: "archive_application",
      arguments: {
        id: "app-1",
        archivedAt: "2026-09-23T14:00:00+02:00",
        dryRun: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(json(result)).toMatchObject({
      dryRun: true,
      application: { archivedAt: "2026-09-23T12:00:00.000Z" },
    });
  });

  it("treats a concurrent archive winner as an idempotent retry", async () => {
    const concurrentlyArchived = {
      ...activeApplication,
      archivedAt: new Date("2026-09-23T12:00:00.000Z"),
      updatedAt: new Date("2026-09-23T12:00:01.000Z"),
    };
    mocks.getApplication
      .mockResolvedValueOnce(activeApplication)
      .mockResolvedValueOnce(concurrentlyArchived);
    mocks.updateApplication.mockRejectedValue(new Error("conflict"));

    const result = await client.callTool({
      name: "archive_application",
      arguments: {
        id: "app-1",
        expectedUpdatedAt: "2026-09-23T10:00:00.000Z",
      },
    });

    expect(result.isError).not.toBe(true);
    expect(json(result)).toMatchObject({
      changed: false,
      application: { id: "app-1", archivedAt: "2026-09-23T12:00:00.000Z" },
    });
    expect(mocks.updateApplication).toHaveBeenCalledWith("app-1", "owner-1", {
      archivedAt: expect.any(Date),
      expectedUpdatedAt: new Date("2026-09-23T10:00:00.000Z"),
    });
  });

  it("does not disguise a stale token as a no-op", async () => {
    mocks.getApplication.mockResolvedValue({
      ...activeApplication,
      archivedAt: new Date("2026-09-23T11:00:00.000Z"),
      updatedAt: new Date("2026-09-23T11:00:01.000Z"),
    });

    const result = await client.callTool({
      name: "archive_application",
      arguments: {
        id: "app-1",
        expectedUpdatedAt: "2026-09-23T10:00:00.000Z",
      },
    });

    expect(result.isError).toBe(true);
    expect(json(result)).toEqual({ error: { code: "conflict" } });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("recognizes an exact archivedAt value as a replay", async () => {
    const archivedAt = "2026-09-23T11:00:00.000Z";
    mocks.getApplication.mockResolvedValue({
      ...activeApplication,
      archivedAt: new Date(archivedAt),
      updatedAt: new Date("2026-09-23T11:00:01.000Z"),
    });

    const result = await client.callTool({
      name: "archive_application",
      arguments: {
        id: "app-1",
        archivedAt,
        expectedUpdatedAt: "2026-09-23T10:00:00.000Z",
      },
    });

    expect(result.isError).not.toBe(true);
    expect(json(result)).toMatchObject({ changed: false, application: { id: "app-1" } });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("enforces owner scoping", async () => {
    mocks.getApplication.mockResolvedValue(null);

    const result = await client.callTool({
      name: "archive_application",
      arguments: { id: "other-owner-app" },
    });

    expect(result.isError).toBe(true);
    expect(json(result)).toEqual({ error: { code: "not_found" } });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("returns optimistic-concurrency conflicts", async () => {
    mocks.getApplication.mockResolvedValue(activeApplication);
    mocks.updateApplication.mockRejectedValue(new Error("conflict"));

    const result = await client.callTool({
      name: "archive_application",
      arguments: {
        id: "app-1",
        archivedAt: "2026-09-23T12:00:00.000Z",
        expectedUpdatedAt: "2026-09-23T10:00:00.000Z",
      },
    });

    expect(result.isError).toBe(true);
    expect(json(result)).toEqual({ error: { code: "conflict" } });
  });

  it("rejects malformed archive timestamps", async () => {
    const result = await client.callTool({
      name: "archive_application",
      arguments: { id: "app-1", archivedAt: "not-a-date" },
    });

    expect(result.isError).toBe(true);
    expect(mocks.getApplication).not.toHaveBeenCalled();
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });

  it("maps unexpected adapter failures to a controlled error", async () => {
    mocks.getApplication.mockResolvedValue(activeApplication);
    mocks.updateApplication.mockRejectedValue(new Error("database_unavailable"));

    const result = await client.callTool({
      name: "archive_application",
      arguments: { id: "app-1" },
    });

    expect(result.isError).toBe(true);
    expect(json(result)).toEqual({ error: { code: "application_update_failed" } });
  });
});
