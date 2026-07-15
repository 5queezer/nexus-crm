import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionAuth: vi.fn(),
  getConnectorSecret: vi.fn(),
  discoverMcpTools: vi.fn(),
  recordConnectorHealth: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireSessionAuth: mocks.requireSessionAuth }));
vi.mock("@/lib/agent/connectors", () => ({
  prismaConnectorRepository: {},
  getConnectorSecret: mocks.getConnectorSecret,
  recordConnectorHealth: mocks.recordConnectorHealth,
}));
vi.mock("@/lib/agent/mcp-client", () => ({ discoverMcpTools: mocks.discoverMcpTools }));

import { GET } from "../route";

const context = { params: Promise.resolve({ id: "connector-1" }) };

describe("GET /api/agent/connectors/:id/tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSessionAuth.mockResolvedValue({ userId: "user-a" });
    mocks.getConnectorSecret.mockResolvedValue({
      id: "connector-1",
      name: "Research",
      url: "https://mcp.example.com",
      authorization: null,
      updatedAt: new Date(),
    });
  });

  it("returns and records current successful discovery health", async () => {
    const health = { lastCheckedAt: new Date(), lastStatus: "healthy", lastErrorCode: null };
    mocks.discoverMcpTools.mockResolvedValue([{ name: "research__search" }]);
    mocks.recordConnectorHealth.mockResolvedValue(health);

    const response = await GET(new Request("http://test"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tools: [{ name: "research__search" }], health: {
      ...health,
      lastCheckedAt: health.lastCheckedAt.toISOString(),
    } });
    expect(mocks.recordConnectorHealth).toHaveBeenCalledWith({}, "user-a", "connector-1", "healthy");
  });

  it("returns a sanitized failure while recording failed health", async () => {
    mocks.discoverMcpTools.mockRejectedValue(new Error("Bearer secret-value from upstream"));
    mocks.recordConnectorHealth.mockResolvedValue({
      lastCheckedAt: new Date(),
      lastStatus: "failed",
      lastErrorCode: "DISCOVERY_FAILED",
    });

    const response = await GET(new Request("http://test"), context);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("Connector discovery failed");
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(mocks.recordConnectorHealth).toHaveBeenCalledWith({}, "user-a", "connector-1", "failed");
  });
});
