import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordApplicationEvent: vi.fn(),
  listApplicationEventsFiltered: vi.fn(),
  getApplication: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    recordApplicationEvent: mocks.recordApplicationEvent,
    listApplicationEventsFiltered: mocks.listApplicationEventsFiltered,
    getApplication: mocks.getApplication,
  }),
}));
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

let client: Client;
let server: ReturnType<typeof createMcpServer>;

async function connect() {
  server = createMcpServer(auth);
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
    }));
  });

  it("rejects lifecycle changes through update_application", async () => {
    const result = await client.callTool({
      name: "update_application",
      arguments: { id: "app-1", status: "offer" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatchObject({ error: { code: "lifecycle_event_required", fields: ["status"] } });
  });

  it("does not expose the workflow-reserved submission event through the generic tool", async () => {
    const result = await client.callTool({
      name: "record_application_event",
      arguments: { applicationId: "app-1", type: "application_submitted" },
    });
    expect(result.isError).toBe(true);
    expect(textValue(result)).toContain("Input validation error");
    expect(mocks.recordApplicationEvent).not.toHaveBeenCalled();
  });
});
