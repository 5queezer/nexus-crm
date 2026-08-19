import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApplication: vi.fn(),
  batchCreateContacts: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cv/generate", () => ({ generateAndStoreCv: vi.fn() }));
vi.mock("@/lib/documents/download", () => ({ downloadDocumentContent: vi.fn() }));
vi.mock("@/lib/documents/upload", () => ({
  uploadDocumentContent: vi.fn(),
  MAX_DOCUMENT_BASE64_SIZE: 1_000_000,
}));
vi.mock("@/lib/documents/service", () => ({ deleteDocumentWithContent: vi.fn() }));

import { createMcpServer } from "../route";

const auth = {
  userId: "owner-1",
  readScopeUserId: "owner-1",
  user: { id: "owner-1", name: "Owner", email: "owner@example.com", image: null, isAdmin: false },
  authType: "mcp_oauth" as const,
  scopes: ["mcp:tools", "mcp:submissions"],
};

let client: Client;
let server: ReturnType<typeof createMcpServer>;

function textValue(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  if (content[0]?.type !== "text" || typeof content[0].text !== "string") throw new Error("expected text");
  return content[0].text;
}

describe("MCP batch_create_contacts", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getApplication.mockResolvedValue({ id: "app-1" });
    mocks.batchCreateContacts.mockResolvedValue({
      total: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { index: 0, id: "contact-1", operation: "created" },
        { index: 1, id: "contact-2", operation: "created" },
      ],
    });
    server = createMcpServer(auth);
    client = new Client({ name: "batch-contact-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("rejects an unauthorized application before any contact write", async () => {
    mocks.getApplication.mockResolvedValueOnce(null);

    const result = await client.callTool({
      name: "batch_create_contacts",
      arguments: { applicationId: "foreign-app", contacts: [{ name: "Recruiter" }] },
    });

    expect(result.isError).toBe(true);
    expect(textValue(result)).toBe("Application not found or access denied");
    expect(mocks.batchCreateContacts).not.toHaveBeenCalled();
  });

  it("advertises the batch limit and partial-success result", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find(({ name }) => name === "batch_create_contacts");

    expect(tool?.description).toContain("created independently");
    expect(tool?.description).toContain("Returns total, succeeded, failed");
    expect(tool?.inputSchema).toMatchObject({
      required: ["applicationId", "contacts"],
      properties: { contacts: { minItems: 1, maxItems: 50 } },
    });
  });

  it("reports an adapter-level batch failure like other batch tools", async () => {
    mocks.batchCreateContacts.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await client.callTool({
      name: "batch_create_contacts",
      arguments: { applicationId: "app-1", contacts: [{ name: "Recruiter" }] },
    });

    expect(result.isError).toBe(true);
    expect(textValue(result)).toBe("Batch contact creation failed");
  });

  it("creates sanitized contacts and returns the batch result shape", async () => {
    const expected = {
      total: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { index: 0, id: "contact-1", operation: "created" },
        { index: 1, id: "contact-2", operation: "created" },
      ],
    };

    const result = await client.callTool({
      name: "batch_create_contacts",
      arguments: {
        applicationId: "app-1",
        contacts: [
          {
            name: "n".repeat(300),
            email: "e".repeat(300),
            phone: "p".repeat(60),
            role: "r".repeat(120),
            linkedIn: "l".repeat(600),
          },
          { name: "Recruiter" },
        ],
      },
    });

    expect(mocks.getApplication).toHaveBeenCalledWith("app-1", "owner-1", { demoVisibility: "exclude" });
    expect(mocks.batchCreateContacts).toHaveBeenCalledWith("app-1", "owner-1", [
      {
        name: "n".repeat(255),
        email: "e".repeat(255),
        phone: "p".repeat(50),
        role: "r".repeat(100),
        linkedIn: "l".repeat(500),
      },
      { name: "Recruiter", email: null, phone: null, role: null, linkedIn: null },
    ]);
    expect(JSON.parse(textValue(result))).toEqual(expected);
  });
});
