export type ProviderId = "openai" | "anthropic";

export type ProviderOption = {
  id: ProviderId;
  label: string;
  models: Array<{ id: string; label: string; description: string }>;
};

export type Credential = {
  id: string;
  provider: ProviderId;
  keyHint: string;
  defaultModel: string;
  status: string;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  createdAt: string;
};

export type AgentThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: AgentMessage[];
};

export type ProposalDiff = { field: string; from: unknown; to: unknown };

export type ActionProposal = {
  id: string;
  kind: string;
  targetType: string;
  targetId: string;
  expectedDiff: ProposalDiff[];
  sanitizedPayload?: {
    toolName?: string;
    arguments?: Record<string, unknown>;
    connectorName?: string;
    connectorUrl?: string;
    connectorVersion?: string;
  } | null;
  assumptions?: { reason?: string } | null;
  status: string;
  expiresAt: string;
  createdAt: string;
};

export type Connector = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasAuthorization: boolean;
  lastCheckedAt?: string | null;
  lastStatus?: string | null;
  lastErrorCode?: string | null;
};

export type McpTool = { name: string; description?: string };

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
