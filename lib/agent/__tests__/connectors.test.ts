import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorRecord, ConnectorRepository } from "../connectors";
import {
  deleteConnector,
  getConnectorSecret,
  listConnectorMetadata,
  saveConnector,
} from "../connectors";
import { discoverMcpTools } from "../mcp-client";

class MemoryConnectorRepository implements ConnectorRepository {
  records = new Map<string, ConnectorRecord>();
  async find(userId: string, id: string) {
    const value = this.records.get(id);
    return value?.userId === userId ? value : null;
  }
  async list(userId: string) {
    return [...this.records.values()].filter((record) => record.userId === userId);
  }
  async upsert(input: Omit<ConnectorRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
    const existing = input.id ? this.records.get(input.id) : undefined;
    const now = new Date();
    const record: ConnectorRecord = {
      ...input,
      id: existing?.id ?? input.id ?? `connector-${this.records.size + 1}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return record;
  }
  async remove(userId: string, id: string) {
    const record = this.records.get(id);
    if (!record || record.userId !== userId) return false;
    return this.records.delete(id);
  }
}

describe("per-user MCP connectors", () => {
  beforeEach(() => {
    process.env.AGENT_SECRET_ENCRYPTION_KEY = "33".repeat(32);
  });
  afterEach(() => delete process.env.AGENT_SECRET_ENCRYPTION_KEY);

  it("stores authorization encrypted and returns metadata only", async () => {
    const repository = new MemoryConnectorRepository();
    const metadata = await saveConnector(repository, "user-a", {
      name: "Research tools",
      url: "https://mcp.example.com/api",
      authorization: "Bearer top-secret-token",
      validate: async (value) => new URL(value),
    });

    const stored = repository.records.get(metadata.id)!;
    expect(stored.encryptedAuthorization).not.toContain("top-secret-token");
    expect(JSON.stringify(metadata)).not.toContain("top-secret-token");
    expect(metadata.hasAuthorization).toBe(true);
  });

  it("scopes list, secret lookup, and delete to the authenticated user", async () => {
    const repository = new MemoryConnectorRepository();
    const saved = await saveConnector(repository, "user-a", {
      name: "Tools",
      url: "https://mcp.example.com/api",
      authorization: "Bearer user-a-token",
      validate: async (value) => new URL(value),
    });

    expect(await listConnectorMetadata(repository, "user-b")).toEqual([]);
    expect(await getConnectorSecret(repository, "user-b", saved.id)).toBeNull();
    expect(await deleteConnector(repository, "user-b", saved.id)).toBe(false);
    expect(await getConnectorSecret(repository, "user-a", saved.id)).toMatchObject({
      authorization: "Bearer user-a-token",
    });
  });
});

describe("bounded MCP discovery", () => {
  it("namespaces discovered tools and always closes the client", async () => {
    const close = vi.fn();
    const listTools = vi.fn().mockResolvedValue({
      tools: [
        { name: "search", description: "Search", inputSchema: { type: "object" } },
        { name: "read", description: "Read", inputSchema: { type: "object" } },
      ],
    });
    const tools = await discoverMcpTools(
      { id: "connector-1", name: "Research Tools", url: "https://mcp.example.com", authorization: null },
      {
        validate: async (value) => new URL(value),
        connect: async () => ({ listTools, close }),
      },
    );

    expect(tools.map((tool) => tool.name)).toEqual(["research_tools__search", "research_tools__read"]);
    expect(close).toHaveBeenCalledOnce();
    expect(listTools).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ timeout: 5_000 }) }));
  });

  it("rejects oversized discovered tool metadata", async () => {
    const close = vi.fn();
    await expect(
      discoverMcpTools(
        { id: "connector-1", name: "Tools", url: "https://mcp.example.com", authorization: null },
        {
          validate: async (value) => new URL(value),
          connect: async () => ({
            listTools: async () => ({
              tools: [{ name: "oversized", description: "x".repeat(300_000) }],
            }),
            close,
          }),
        },
      ),
    ).rejects.toThrow("metadata is too large");
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects more than fifty discovered tools", async () => {
    const close = vi.fn();
    await expect(
      discoverMcpTools(
        { id: "connector-1", name: "Tools", url: "https://mcp.example.com", authorization: null },
        {
          validate: async (value) => new URL(value),
          connect: async () => ({
            listTools: async () => ({ tools: Array.from({ length: 51 }, (_, i) => ({ name: `tool-${i}` })) }),
            close,
          }),
        },
      ),
    ).rejects.toThrow("too many tools");
    expect(close).toHaveBeenCalledOnce();
  });
});
