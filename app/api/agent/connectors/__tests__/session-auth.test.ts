import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  listConnectorMetadata: vi.fn(),
  saveConnector: vi.fn(),
  deleteConnector: vi.fn(),
  getConnectorSecret: vi.fn(),
  discoverMcpTools: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mocks.requireAuth,
  requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/agent/connectors", () => ({
  prismaConnectorRepository: {},
  listConnectorMetadata: mocks.listConnectorMetadata,
  saveConnector: mocks.saveConnector,
  deleteConnector: mocks.deleteConnector,
  getConnectorSecret: mocks.getConnectorSecret,
}));
vi.mock("@/lib/agent/mcp-client", () => ({ discoverMcpTools: mocks.discoverMcpTools }));

import { GET as listConnectors, POST as createConnector } from "../route";
import { DELETE as deleteConnectorRoute, PUT as updateConnector } from "../[id]/route";
import { GET as listTools } from "../[id]/tools/route";

const context = () => ({ params: Promise.resolve({ id: "connector-1" }) });

describe("connector route session authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "user-a", authType: "api_token" });
    mocks.requireSessionAuth.mockImplementation(async (options) => {
      const result = await mocks.requireAuth(options);
      return result?.authType === "session" ? result : null;
    });
    mocks.listConnectorMetadata.mockResolvedValue([]);
    mocks.deleteConnector.mockResolvedValue(false);
    mocks.getConnectorSecret.mockResolvedValue(null);
  });

  it.each([
    ["connector list", () => listConnectors()],
    ["connector creation", () => createConnector(new Request("http://test", { method: "POST" }))],
    ["connector update", () => updateConnector(new Request("http://test", { method: "PUT" }), context())],
    ["connector delete", () => deleteConnectorRoute(new Request("http://test"), context())],
    ["connector tool discovery", () => listTools(new Request("http://test"), context())],
  ])("rejects bearer-token authentication for %s", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(401);
    expect(mocks.listConnectorMetadata).not.toHaveBeenCalled();
    expect(mocks.saveConnector).not.toHaveBeenCalled();
    expect(mocks.deleteConnector).not.toHaveBeenCalled();
    expect(mocks.getConnectorSecret).not.toHaveBeenCalled();
    expect(mocks.discoverMcpTools).not.toHaveBeenCalled();
  });
});
