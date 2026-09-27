import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  updateApplication: vi.fn(),
  batchUpsertApplications: vi.fn(),
  findApplicationByCanonicalJobUrl: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: () => mocks }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cv/generate", () => ({ generateAndStoreCv: vi.fn() }));
vi.mock("@/lib/documents/download", () => ({ downloadDocumentContent: vi.fn() }));
vi.mock("@/lib/documents/upload", () => ({ uploadDocumentContent: vi.fn(), MAX_DOCUMENT_BASE64_SIZE: 1_000_000 }));
vi.mock("@/lib/documents/service", () => ({ deleteDocumentWithContent: vi.fn() }));

import { createMcpServer } from "../route";

const triage = {
  companySize: "small",
  salaryBandMentioned: true,
  triageQuality: 4,
  triageReason: "Strong backend evidence; confirm location eligibility before applying.",
  incomingSource: "outbound",
};
const clearedTriage = {
  companySize: null,
  salaryBandMentioned: false,
  triageQuality: null,
  triageReason: null,
  incomingSource: null,
};
const opportunity = { company: "Example", role: "Engineer", jobUrl: "https://example.com/jobs/1" };
const current = { id: "app-1", status: "inbound", updatedAt: new Date("2026-09-01T00:00:00Z"), ...triage };
const tools = ["create_application", "update_application", "upsert_application_by_job_url", "batch_upsert_applications"] as const;

let client: Client;
let server: ReturnType<typeof createMcpServer>;

/** Builds arguments for an application write tool with the supplied triage fields. */
function argsFor(name: typeof tools[number], fields: Record<string, unknown>) {
  if (name === "update_application") return { id: current.id, ...fields };
  if (name === "batch_upsert_applications") return { items: [{ id: current.id, ...fields }] };
  return { ...opportunity, ...fields };
}

/** Parses the JSON payload from the first text content item in an MCP tool result. */
function decoded(result: Awaited<ReturnType<Client["callTool"]>>) {
  const item = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(item[0].text);
}

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.getApplication.mockResolvedValue(current);
  mocks.findApplicationByCanonicalJobUrl.mockResolvedValue(null);
  mocks.createApplication.mockImplementation(async (_owner, data) => ({ id: current.id, ...data }));
  mocks.updateApplication.mockImplementation(async (_id, _owner, data) => ({ ...current, ...data }));
  mocks.batchUpsertApplications.mockResolvedValue({ total: 1, succeeded: 1, failed: 0, results: [] });
  server = createMcpServer({
    userId: "owner-1", readScopeUserId: "owner-1",
    user: { id: "owner-1", name: "Owner", email: "owner@example.com", image: null, isAdmin: false },
    authType: "mcp_oauth", scopes: ["mcp:tools"],
  });
  client = new Client({ name: "triage-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
});

describe("MCP structured triage", () => {
  it("advertises optional triage fields on all application write tools", async () => {
    const listed = await client.listTools();
    for (const name of tools) {
      const schema = listed.tools.find((tool) => tool.name === name)!.inputSchema;
      const fields = name === "batch_upsert_applications"
        ? (schema.properties!.items as { items: { properties: object; required?: string[] } }).items
        : schema;
      for (const key of Object.keys(triage)) {
        expect(fields.properties).toHaveProperty(key);
        expect(fields.required ?? []).not.toContain(key);
      }
      // Rejection/lifecycle mutation is intentionally not part of this patch.
      expect(fields.properties).not.toHaveProperty("autoRejected");
    }
  });

  for (const name of tools) {
    it.each([triage, clearedTriage])(`${name} forwards explicit triage values including null/false: %j`, async (fields) => {
      const result = await client.callTool({ name, arguments: argsFor(name, fields) });
      expect(result.isError).not.toBe(true);
      if (name === "batch_upsert_applications") {
        expect(mocks.batchUpsertApplications).toHaveBeenCalledWith("owner-1", [expect.objectContaining(fields)]);
      } else if (name === "update_application") {
        expect(mocks.updateApplication).toHaveBeenCalledWith(current.id, "owner-1", expect.objectContaining(fields));
      } else {
        expect(mocks.createApplication).toHaveBeenCalledWith("owner-1", expect.objectContaining(fields));
      }
      if (name !== "batch_upsert_applications") {
        const value = decoded(result);
        expect(value.application ?? value).toMatchObject(fields);
      }
    });

    it(`${name} leaves omitted triage fields out of the write payload`, async () => {
      const result = await client.callTool({ name, arguments: argsFor(name, {}) });
      expect(result.isError).not.toBe(true);
      const payload = name === "batch_upsert_applications"
        ? mocks.batchUpsertApplications.mock.calls[0][1][0]
        : name === "update_application"
          ? mocks.updateApplication.mock.calls[0][2]
          : mocks.createApplication.mock.calls[0][1];
      for (const key of Object.keys(triage)) expect(payload).not.toHaveProperty(key);
    });

    it.each([
      { triageQuality: 0 }, { triageQuality: 6 }, { triageQuality: 2.5 }, { triageQuality: "4" },
      { triageReason: "x".repeat(1001) }, { triageReason: 4 },
      { companySize: "huge" }, { incomingSource: "unknown" },
      { salaryBandMentioned: "false" }, { salaryBandMentioned: null },
    ])(`${name} rejects invalid triage before any write: %j`, async (fields) => {
      const result = await client.callTool({ name, arguments: argsFor(name, fields) });
      expect(result.isError).toBe(true);
      expect(mocks.createApplication).not.toHaveBeenCalled();
      expect(mocks.updateApplication).not.toHaveBeenCalled();
      expect(mocks.batchUpsertApplications).not.toHaveBeenCalled();
    });
  }

  it("preserves triage on URL-upsert updates and supports explicit clearing", async () => {
    mocks.findApplicationByCanonicalJobUrl.mockResolvedValue(current);
    await client.callTool({ name: "upsert_application_by_job_url", arguments: opportunity });
    const first = mocks.updateApplication.mock.calls[0][2];
    for (const key of Object.keys(triage)) expect(first).not.toHaveProperty(key);
    const result = await client.callTool({ name: "upsert_application_by_job_url", arguments: { ...opportunity, ...clearedTriage } });
    expect(result.isError).not.toBe(true);
    expect(mocks.updateApplication).toHaveBeenLastCalledWith(current.id, "owner-1", expect.objectContaining(clearedTriage));
    expect(decoded(result).application).toMatchObject(clearedTriage);
  });

  it("forwards triage for both new and existing batch entries", async () => {
    const result = await client.callTool({ name: "batch_upsert_applications", arguments: {
      items: [{ ...opportunity, ...triage }, { id: current.id, ...clearedTriage }],
    } });
    expect(result.isError).not.toBe(true);
    expect(mocks.batchUpsertApplications).toHaveBeenCalledWith("owner-1", [
      expect.objectContaining({ ...opportunity, ...triage }),
      expect.objectContaining({ id: current.id, ...clearedTriage }),
    ]);
  });

  it("previews triage without writing, keeping concurrency checks", async () => {
    const result = await client.callTool({ name: "update_application", arguments: {
      id: current.id, ...clearedTriage, dryRun: true, expectedUpdatedAt: current.updatedAt.toISOString(),
    } });
    expect(decoded(result)).toMatchObject({ dryRun: true, application: clearedTriage });
    expect(mocks.updateApplication).not.toHaveBeenCalled();
    const stale = await client.callTool({ name: "update_application", arguments: {
      id: current.id, ...triage, dryRun: true, expectedUpdatedAt: "2026-08-01T00:00:00Z",
    } });
    expect(stale.isError).toBe(true);
    expect(decoded(stale)).toMatchObject({ error: { code: "conflict" } });
  });

  it("reads written triage back through get_application without changing status", async () => {
    const result = await client.callTool({ name: "update_application", arguments: { id: current.id, ...clearedTriage } });
    mocks.getApplication.mockResolvedValue(decoded(result));
    const readback = await client.callTool({ name: "get_application", arguments: { id: current.id } });
    expect(decoded(readback)).toMatchObject({ id: current.id, status: "inbound", ...clearedTriage });
    expect(mocks.getApplication).toHaveBeenLastCalledWith(current.id, "owner-1", { demoVisibility: "exclude" });
  });

  it("keeps lifecycle and owner boundaries on a triage update", async () => {
    const lifecycle = await client.callTool({ name: "update_application", arguments: { id: current.id, ...triage, status: "offer" } });
    expect(lifecycle.isError).toBe(true);
    expect(decoded(lifecycle)).toMatchObject({ error: { code: "lifecycle_event_required" } });
    mocks.getApplication.mockResolvedValue(null);
    const missing = await client.callTool({ name: "update_application", arguments: { id: "other-owner-app", ...triage } });
    expect(missing.isError).toBe(true);
    expect(mocks.updateApplication).not.toHaveBeenCalled();
  });
});
