import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listApplications: vi.fn(),
  listApplicationsFiltered: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { createMcpServer } from "../route";

const auth = {
  userId: "owner-1",
  readScopeUserId: "owner-1",
  user: { id: "owner-1", name: "Owner", email: "owner@example.com", image: null, isAdmin: false },
  authType: "mcp_oauth" as const,
  scopes: ["mcp:tools"],
};

const applications = Array.from({ length: 100 }, (_, index) => ({
  id: `app-${String(index).padStart(3, "0")}`,
  company: `Company ${index}`,
  role: `Engineer ${index}`,
  status: "applied",
  currentStage: "screen",
  rating: 4,
  updatedAt: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  notes: `Note ${index}`,
  jobDescription: "x".repeat(50_000),
}));

let client: Client;
let server: ReturnType<typeof createMcpServer>;

function text(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  if (content[0]?.type !== "text" || typeof content[0].text !== "string") throw new Error("expected text");
  return content[0].text;
}

describe("MCP application list", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.listApplicationsFiltered.mockImplementation(async (_userId, filter) => {
      let rows = applications;
      if (filter.search) {
        const q = filter.search.toLowerCase();
        rows = rows.filter((app) =>
          filter.searchFields.some((field: "company" | "role") => app[field].toLowerCase().includes(q)),
        );
      }
      if (filter.cursor) {
        rows = rows.slice(rows.findIndex((app) => app.id === filter.cursor) + 1);
      }
      return rows.slice(0, filter.limit).map((app) => Object.fromEntries(
        ["id", ...filter.fields].map((field) => [field, app[field as keyof typeof app]]),
      ));
    });
    server = createMcpServer(auth);
    client = new Client({ name: "application-list-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("returns a bounded compact index and supports field, cursor, and company-role query options", async () => {
    const defaultResult = await client.callTool({ name: "list_applications", arguments: {} });
    const defaultText = text(defaultResult);
    const defaultRows = JSON.parse(defaultText) as Array<Record<string, unknown>>;

    expect(defaultRows).toHaveLength(50);
    expect(Object.keys(defaultRows[0])).toEqual([
      "id", "company", "role", "status", "currentStage", "rating", "updatedAt",
    ]);
    expect(defaultText.length).toBeLessThan(20_000);
    expect(mocks.listApplications).not.toHaveBeenCalled();
    expect(mocks.listApplicationsFiltered).toHaveBeenNthCalledWith(1, "owner-1", {
      search: undefined,
      searchFields: ["company", "role"],
      fields: ["id", "company", "role", "status", "currentStage", "rating", "updatedAt"],
      limit: 50,
      cursor: undefined,
    }, { demoVisibility: "exclude" });

    const tools = await client.listTools();
    const compactTool = tools.tools.find((tool) => tool.name === "list_applications");
    const filteredTool = tools.tools.find((tool) => tool.name === "list_applications_filtered");
    expect(compactTool?.description).toContain("compact");
    expect(filteredTool?.description).toContain("advanced");

    const selectedResult = await client.callTool({
      name: "list_applications",
      arguments: { q: "engineer", fields: ["notes"], limit: 2, cursor: "app-020" },
    });
    expect(JSON.parse(text(selectedResult))).toEqual([
      { id: "app-021", notes: "Note 21" },
      { id: "app-022", notes: "Note 22" },
    ]);
  });
});
