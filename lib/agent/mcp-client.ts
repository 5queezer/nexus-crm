import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  resolveMcpDestination,
  validateMcpDestination,
  type ValidatedMcpDestination,
} from "./mcp-policy";

export type McpConnectorSecret = {
  id: string;
  name: string;
  url: string;
  authorization: string | null;
  updatedAt?: Date;
};

type DiscoveryClient = {
  listTools(options?: unknown): Promise<{
    tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  }>;
  close(): Promise<void> | void;
};

const MAX_RESPONSE_BYTES = 256 * 1024;

function connectorPrefix(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "connector";
}

function createPinnedAgent(destination: ValidatedMcpDestination) {
  const lookup = ((
    _hostname: string,
    options: { all?: boolean },
    callback:
      | ((error: NodeJS.ErrnoException | null, address: string, family: number) => void)
      | ((error: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void),
  ) => {
    if (options.all) {
      (callback as (error: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void)(
        null,
        [{ address: destination.address, family: destination.family }],
      );
      return;
    }
    (callback as (error: NodeJS.ErrnoException | null, address: string, family: number) => void)(
      null,
      destination.address,
      destination.family,
    );
  }) as LookupFunction;
  return new Agent({ connect: { lookup } });
}

function boundResponseBody(response: Response, maxBytes: number): Response {
  if (!response.body) return response;
  let bytes = 0;
  const bounded = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          controller.error(new Error("MCP response exceeded the byte limit"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(bounded, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createPinnedTransport(
  destination: ValidatedMcpDestination,
  baseFetch: typeof fetch = fetch,
) {
  const agent = createPinnedAgent(destination);
  const pinnedFetch: typeof fetch = async (input, init) => {
    const response = await baseFetch(input, {
      ...init,
      dispatcher: agent,
    } as RequestInit & { dispatcher: Agent });
    return boundResponseBody(response, MAX_RESPONSE_BYTES);
  };
  return {
    fetch: pinnedFetch,
    close: () => agent.close(),
  };
}

async function productionClient(connector: McpConnectorSecret) {
  const destination = await resolveMcpDestination(connector.url);
  const transport = createPinnedTransport(destination);
  const headers: Record<string, string> = connector.authorization
    ? { Authorization: connector.authorization }
    : {};
  try {
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: destination.url.toString(),
        headers,
        redirect: "error",
        fetch: transport.fetch,
      },
      maxRetries: 0,
    });
    return {
      client,
      close: async () => {
        await client.close();
        await transport.close();
      },
    };
  } catch (error) {
    await transport.close();
    throw error;
  }
}

export async function discoverMcpTools(
  connector: McpConnectorSecret,
  dependencies: {
    validate?: (url: string) => Promise<URL>;
    connect?: (input: {
      url: string;
      headers: Record<string, string>;
    }) => Promise<DiscoveryClient>;
  } = {},
) {
  let client: DiscoveryClient;
  let close: () => Promise<void>;
  if (dependencies.connect) {
    const destination = await (dependencies.validate ?? validateMcpDestination)(connector.url);
    const headers: Record<string, string> = connector.authorization
      ? { Authorization: connector.authorization }
      : {};
    client = await dependencies.connect({ url: destination.toString(), headers });
    close = async () => client.close();
  } else {
    const production = await productionClient(connector);
    client = production.client;
    close = production.close;
  }

  try {
    const result = await client.listTools({
      options: { timeout: 5_000, maxTotalTimeout: 5_000 },
    });
    if (result.tools.length > 50) {
      throw new Error("MCP connector returned too many tools");
    }
    const serializedTools = JSON.stringify(result.tools);
    if (Buffer.byteLength(serializedTools, "utf8") > MAX_RESPONSE_BYTES) {
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
    await close();
  }
}

export async function callMcpTool(
  connector: McpConnectorSecret,
  toolName: string,
  args: Record<string, unknown>,
) {
  const production = await productionClient(connector);
  try {
    const result = await production.client.callTool({
      name: toolName,
      arguments: args,
      options: { timeout: 15_000, maxTotalTimeout: 15_000 },
    });
    const serializedResult = JSON.stringify(result);
    if (Buffer.byteLength(serializedResult, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("MCP tool response is too large");
    }
    return result;
  } finally {
    await production.close();
  }
}
