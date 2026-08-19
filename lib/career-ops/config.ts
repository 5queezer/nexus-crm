import { createHmac } from "crypto";

/**
 * Server-only Career Ops configuration.
 *
 * Nothing in this module may be imported from a client component: it reads the
 * Hermes bearer token. The token is deliberately kept off the exported config
 * object's enumerable surface (see `secret` below) so an accidental
 * `JSON.stringify(config)` in a log line or an API response cannot leak it.
 */

export const CAREER_OPS_MEMORY_SCOPE_PREFIX = "agent:career-ops:nexus:dm:";
export const CAREER_OPS_MAX_MESSAGE_LENGTH = 8_000;
export const CAREER_OPS_MAX_TITLE_LENGTH = 120;
export const CAREER_OPS_CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const CAREER_OPS_JSON_BODY_LIMIT = 32 * 1024;

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000;
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const REDACTED_ERROR_LIMIT = 300;

export type CareerOpsDisabledReason =
  | "disabled"
  | "not_configured"
  | "invalid_base_url"
  | "owner_not_configured"
  | "not_owner";

export type CareerOpsConfig =
  | { enabled: false; reason: CareerOpsDisabledReason }
  | {
      enabled: true;
      baseUrl: string;
      connectTimeoutMs: number;
      streamIdleTimeoutMs: number;
      runTimeoutMs: number;
      /**
       * The Nexus user whose API token the Hermes profile uses for Nexus MCP.
       * Every Career Ops run's tool calls act as this user, so only this user
       * may use the feature.
       */
      ownerUserId: string;
      /** Non-enumerable: never appears in JSON.stringify or object spread. */
      readonly secret: string;
      readonly scopeSecret: string;
    };

function boundedTimeout(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1_000) return fallback;
  return Math.min(Math.trunc(parsed), MAX_TIMEOUT_MS);
}

function normalizeBaseUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.search || parsed.hash) return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

export function readCareerOpsConfig(): CareerOpsConfig {
  const flag = process.env.HERMES_CAREER_OPS_ENABLED?.trim().toLowerCase();
  const rawBaseUrl = process.env.HERMES_CAREER_OPS_BASE_URL?.trim();
  const apiKey = process.env.HERMES_CAREER_OPS_API_KEY?.trim();

  if (!rawBaseUrl || !apiKey) return { enabled: false, reason: "not_configured" };
  if (flag !== "true" && flag !== "1") return { enabled: false, reason: "disabled" };

  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  if (!baseUrl) return { enabled: false, reason: "invalid_base_url" };

  // The Hermes profile holds ONE Nexus API token, and the Nexus MCP server
  // scopes every tool call to that token's owner. So an agent run always acts
  // as that user, whoever started it. Requiring the binding to be declared
  // keeps a multi-user deployment from silently serving one user's CRM data to
  // another. Fail closed: without it, the feature stays off.
  const ownerUserId = process.env.HERMES_CAREER_OPS_OWNER_USER_ID?.trim();
  if (!ownerUserId) return { enabled: false, reason: "owner_not_configured" };

  const config = {
    enabled: true as const,
    baseUrl,
    connectTimeoutMs: boundedTimeout(
      process.env.HERMES_CAREER_OPS_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECT_TIMEOUT_MS,
    ),
    streamIdleTimeoutMs: boundedTimeout(
      process.env.HERMES_CAREER_OPS_STREAM_IDLE_TIMEOUT_MS,
      DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ),
    runTimeoutMs: boundedTimeout(
      process.env.HERMES_CAREER_OPS_RUN_TIMEOUT_MS,
      DEFAULT_RUN_TIMEOUT_MS,
    ),
    ownerUserId,
  };

  // Non-enumerable so the secret survives neither JSON.stringify nor {...config}.
  Object.defineProperty(config, "secret", { value: apiKey, enumerable: false });
  Object.defineProperty(config, "scopeSecret", {
    value: process.env.HERMES_CAREER_OPS_SCOPE_SECRET?.trim() || apiKey,
    enumerable: false,
  });

  return config as CareerOpsConfig;
}

/**
 * Stable long-term memory scope for a Nexus user.
 *
 * Hermes caps `X-Hermes-Session-Key` at 256 characters and rejects CR/LF/NUL.
 * A keyed hash keeps the scope stable and non-guessable while keeping the raw
 * Nexus user ID (and any PII) out of the Hermes operator's logs.
 */
export function careerOpsMemoryScope(
  config: Extract<CareerOpsConfig, { enabled: true }>,
  userId: string,
): string {
  const digest = createHmac("sha256", config.scopeSecret).update(userId).digest("hex");
  return `${CAREER_OPS_MEMORY_SCOPE_PREFIX}${digest.slice(0, 32)}`;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(api[_-]?key|apikey|token|secret|authorization)\b\s*[:=]\s*"?[A-Za-z0-9._~+/=-]{8,}"?/gi,
  /\bsk-[A-Za-z0-9._-]{8,}/gi,
];

/**
 * Conservative redaction for text that came from (or names) the upstream.
 * Applied to everything derived from a Hermes response before it can reach a
 * log line, an error message, or an API response body.
 */
export function redactUpstreamError(input: unknown): string {
  if (input === undefined || input === null) return "";
  const raw = input instanceof Error ? input.message : String(input);
  let text = raw;
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");

  const configuredKey = process.env.HERMES_CAREER_OPS_API_KEY?.trim();
  if (configuredKey && configuredKey.length >= 4) {
    text = text.split(configuredKey).join("[redacted]");
  }
  const scopeSecret = process.env.HERMES_CAREER_OPS_SCOPE_SECRET?.trim();
  if (scopeSecret && scopeSecret.length >= 4) {
    text = text.split(scopeSecret).join("[redacted]");
  }

  return text.slice(0, REDACTED_ERROR_LIMIT);
}
