import { createMCPClient } from "@ai-sdk/mcp";
import { validateMcpDestination } from "./mcp-policy";

export type McpConnectorSecret = {
  id: string;
  name: string;
  url: string;
  authorization: string | null;
};

type DiscoveryClient = {
  listTools(options?: unknown): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  close(): Promise<void> | void;
};

function connectorPrefix(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "connector";
}

export async function discoverMcpTools(
  connector: McpConnectorSecret,
  dependencies: {
    validate?: (url: string) => Promise<URL>;
    connect?: (input: { url: string; headers: Record<string, string> }) => Promise<DiscoveryClient>;
  } = {},
) {
  const destination = await (dependencies.validate ?? validateMcpDestination)(connector.url);
  const headers: Record<string, string> = connector.authorization
    ? { Authorization: connector.authorization }
    : {};
  const client = dependencies.connect
    ? await dependencies.connect({ url: destination.toString(), headers })
    : await createMCPClient({
        transport: { type: "http", url: destination.toString(), headers, redirect: "error" },
        maxRetries: 0,
      });
  try {
    const result = await client.listTools({
      options: { timeout: 5_000, maxTotalTimeout: 5_000 },
    });
    if (result.tools.length > 50) throw new Error("MCP connector returned too many tools");
    const serializedTools = JSON.stringify(result.tools);
    if (Buffer.byteLength(serializedTools, "utf8") > 256 * 1024) {
      throw new Error("MCP tool metadata is too large");
    }
    const prefix = connectorPrefix(connector.name);
    return result.tools.map((item) => ({
      name: `${prefix}__${item.name}`,
      remoteName: item.name,
      description: item.description ?? "External MCP tool",
      inputSchema: item.inputSchema ?? { type: "object" },
    }));
  } finally {
    await client.close();
  }
}

export async function callMcpTool(
  connector: McpConnectorSecret,
  toolName: string,
  args: Record<string, unknown>,
) {
  const destination = await validateMcpDestination(connector.url);
  const headers: Record<string, string> = connector.authorization
    ? { Authorization: connector.authorization }
    : {};
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: destination.toString(),
      headers,
      redirect: "error",
    },
    maxRetries: 0,
  });
  try {
    const result = await client.callTool({
      name: toolName,
      arguments: args,
      options: { timeout: 15_000, maxTotalTimeout: 15_000 },
    });
    const serializedResult = JSON.stringify(result);
    if (Buffer.byteLength(serializedResult, "utf8") > 256 * 1024) {
      throw new Error("MCP tool response is too large");
    }
    return result;
  } finally {
    await client.close();
  }
}
