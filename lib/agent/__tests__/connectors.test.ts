import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorRecord, ConnectorRepository } from "../connectors";
import {
  deleteConnector,
  getConnectorSecret,
  listConnectorMetadata,
  recordConnectorHealth,
  saveConnector,
} from "../connectors";
import {
  closeMcpClientAndTransport,
  discoverMcpTools,
  createPinnedTransport,
} from "../mcp-client";
import { resolveMcpDestination } from "../mcp-policy";
import { canonicalizeMcpCall } from "../mcp-proposal";

const ORIGINAL_KEY = process.env.AGENT_SECRET_ENCRYPTION_KEY;

async function parseTestUrl(value: string): Promise<URL> {
  try {
    return new URL(value);
  } catch {
    throw new Error("Invalid test URL");
  }
}

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
  async updateHealth(userId: string, id: string, health: { checkedAt: Date; status: "healthy" | "failed"; errorCode: string | null }) {
    const record = this.records.get(id);
    if (!record || record.userId !== userId) return false;
    this.records.set(id, {
      ...record,
      lastCheckedAt: health.checkedAt,
      lastStatus: health.status,
      lastErrorCode: health.errorCode,
    });
    return true;
  }
}

describe("per-user MCP connectors", () => {
  beforeEach(() => {
    process.env.AGENT_SECRET_ENCRYPTION_KEY = "33".repeat(32);
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.AGENT_SECRET_ENCRYPTION_KEY;
    else process.env.AGENT_SECRET_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it("stores authorization encrypted and returns metadata only", async () => {
    const repository = new MemoryConnectorRepository();
    const metadata = await saveConnector(repository, "user-a", {
      name: "Research tools",
      url: "https://mcp.example.com/api",
      authorization: "Bearer top-secret-token",
      validate: parseTestUrl,
    });

    const stored = repository.records.get(metadata.id)!;
    expect(stored.encryptedAuthorization).not.toContain("top-secret-token");
    expect(JSON.stringify(metadata)).not.toContain("top-secret-token");
    expect(metadata.hasAuthorization).toBe(true);
  });

  it("never carries authorization to a different connector origin", async () => {
    const repository = new MemoryConnectorRepository();
    const saved = await saveConnector(repository, "user-a", {
      name: "Tools",
      url: "https://first.example.com/mcp",
      authorization: "Bearer user-a-token",
      validate: parseTestUrl,
    });

    const moved = await saveConnector(repository, "user-a", {
      id: saved.id,
      name: "Tools",
      url: "https://second.example.com/mcp",
      validate: parseTestUrl,
    });

    expect(moved.hasAuthorization).toBe(false);
    expect((await getConnectorSecret(repository, "user-a", saved.id))?.authorization).toBeNull();
  });

  it("records sanitized health without changing the connector configuration version", async () => {
    const repository = new MemoryConnectorRepository();
    const saved = await saveConnector(repository, "user-a", {
      name: "Tools",
      url: "https://mcp.example.com/api",
      validate: parseTestUrl,
    });
    const version = repository.records.get(saved.id)!.updatedAt;

    const health = await recordConnectorHealth(repository, "user-a", saved.id, "failed");

    expect(health).toMatchObject({ lastStatus: "failed", lastErrorCode: "DISCOVERY_FAILED" });
    expect(repository.records.get(saved.id)).toMatchObject({
      lastStatus: "failed",
      lastErrorCode: "DISCOVERY_FAILED",
      updatedAt: version,
    });
  });

  it("scopes list, secret lookup, and delete to the authenticated user", async () => {
    const repository = new MemoryConnectorRepository();
    const saved = await saveConnector(repository, "user-a", {
      name: "Tools",
      url: "https://mcp.example.com/api",
      authorization: "Bearer user-a-token",
      validate: parseTestUrl,
    });

    expect(await listConnectorMetadata(repository, "user-b")).toEqual([]);
    expect(await getConnectorSecret(repository, "user-b", saved.id)).toBeNull();
    expect(await deleteConnector(repository, "user-b", saved.id)).toBe(false);
    expect(await getConnectorSecret(repository, "user-a", saved.id)).toMatchObject({
      authorization: "Bearer user-a-token",
    });
  });
});

describe("reviewed MCP calls", () => {
  it("canonicalizes and validates reviewed arguments", () => {
    const schema = {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer" } },
      required: ["query"],
      additionalProperties: false,
    };
    const reviewed = canonicalizeMcpCall({ limit: 5, query: "platform" }, schema);
    const reordered = canonicalizeMcpCall({ query: "platform", limit: 5 }, schema);
    expect(reviewed.arguments).toEqual({ limit: 5, query: "platform" });
    expect(reviewed.argumentsHash).toBe(reordered.argumentsHash);
    expect(reviewed.schemaHash).toBe(reordered.schemaHash);
    expect(() => canonicalizeMcpCall({ query: 42 }, schema)).toThrow(
      "MCP arguments do not match the tool schema",
    );
    expect(() =>
      canonicalizeMcpCall(
        { query: "roles", api_key: "must-not-be-stored" },
        { ...schema, properties: { ...schema.properties, api_key: { type: "string" } } },
      ),
    ).toThrow("MCP arguments contain a sensitive field");
    for (const sensitive of ["token", "session_token", "client_secret", "db_password"]) {
      expect(() =>
        canonicalizeMcpCall(
          { query: "roles", [sensitive]: "must-not-be-stored" },
          { ...schema, additionalProperties: true },
        ),
      ).toThrow("MCP arguments contain a sensitive field");
    }
  });
});

describe("pinned MCP transport", () => {
  it("uses the validated address dispatcher and rejects oversized bodies while streaming", async () => {
    const destination = await resolveMcpDestination("https://mcp.example.com/api", {
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    });
    let receivedInit: RequestInit | undefined;
    const baseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      receivedInit = init;
      return new Response(new Uint8Array(300_000));
    }) as typeof fetch;
    const transport = createPinnedTransport(destination, baseFetch);
    try {
      const response = await transport.fetch("https://mcp.example.com/api");
      expect(receivedInit).toHaveProperty("dispatcher");
      await expect(response.arrayBuffer()).rejects.toThrow("MCP response exceeded the byte limit");
    } finally {
      await transport.close();
    }
  });
});

describe("MCP cleanup", () => {
  it("closes the pinned transport when client cleanup rejects", async () => {
    const client = { close: vi.fn().mockRejectedValue(new Error("client close failed")) };
    const transport = { close: vi.fn().mockResolvedValue(undefined) };

    await expect(closeMcpClientAndTransport(client, transport)).rejects.toThrow(
      "client close failed",
    );
    expect(transport.close).toHaveBeenCalledOnce();
  });
});

describe("bounded MCP discovery", () => {
  it("times out stalled initialization and closes a client that arrives late", async () => {
    let resolveClient!: (client: { listTools: () => Promise<{ tools: [] }>; close: () => void }) => void;
    const close = vi.fn();
    const pendingClient = new Promise<{ listTools: () => Promise<{ tools: [] }>; close: () => void }>((resolve) => {
      resolveClient = resolve;
    });
    const discovery = discoverMcpTools(
      { id: "connector-1", name: "Tools", url: "https://mcp.example.com", authorization: null },
      {
        validate: parseTestUrl,
        connect: async () => pendingClient,
        initializationTimeoutMs: 10,
      },
    );

    await expect(discovery).rejects.toThrow("MCP initialization timed out");
    resolveClient({ listTools: async () => ({ tools: [] }), close });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).toHaveBeenCalledOnce();
  });

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
        validate: parseTestUrl,
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
          validate: parseTestUrl,
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
          validate: parseTestUrl,
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
