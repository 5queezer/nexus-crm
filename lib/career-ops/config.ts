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
export const REDACTED_ERROR_LIMIT = 300;

/**
 * What replaces a credential in redacted text.
 *
 * Exported because callers have to be able to tell it apart from content: a
 * string that is nothing but placeholders looks non-empty while saying nothing,
 * which is the difference between an approval prompt that discloses an action
 * and one that only appears to.
 */
export const REDACTION_PLACEHOLDER = "[redacted]";

/**
 * Shortest secret this deployment will accept, and the shortest one exact
 * redaction will strip. One constant for both on purpose.
 *
 * They were two numbers and they disagreed: configuration accepted a key of any
 * length while redaction skipped anything under four characters, so a very
 * short key was live *and* unredactable — the generic credential patterns
 * require longer tokens, so an upstream error or transcript echoing it would
 * have carried the bearer secret through to the logs and the browser intact. A
 * key too short to redact is a key too short to hold.
 *
 * Sixteen because that is the floor at which a bearer token is a credential at
 * all; the runbook already tells operators to generate 64 hex characters.
 */
export const MIN_CAREER_OPS_SECRET_LENGTH = 16;

/**
 * Longest secret this deployment will accept, and the longest one the streaming
 * seam can hold intact. One constant for both, for the same reason as the
 * minimum above.
 *
 * `SecretBoundaryRedactor` holds back a tail one character shorter than the
 * longest configured secret so a key split across two deltas is reassembled
 * before either half is emitted — but that tail is itself capped, because an
 * upstream streaming an endless token must not grow the buffer without bound.
 * A key longer than the cap defeats the mechanism silently: the first delta
 * carrying more than the cap has its prefix emitted, and no pattern matches a
 * bare high-entropy prefix. So the cap becomes a configuration bound instead: a
 * key beyond it is refused at startup rather than accepted and streamed in the
 * clear.
 */
export const MAX_CAREER_OPS_SECRET_LENGTH = 4096;

export type CareerOpsDisabledReason =
  | "disabled"
  | "not_configured"
  | "invalid_base_url"
  /** A secret shorter than redaction can strip; see MIN_CAREER_OPS_SECRET_LENGTH. */
  | "weak_api_key"
  | "weak_scope_secret"
  /** A secret longer than the stream seam can hold; see MAX_CAREER_OPS_SECRET_LENGTH. */
  | "oversized_api_key"
  | "oversized_scope_secret"
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
  // Fail closed rather than run with a secret redaction cannot strip.
  if (apiKey.length < MIN_CAREER_OPS_SECRET_LENGTH) {
    return { enabled: false, reason: "weak_api_key" };
  }
  // ...or one the streaming seam cannot hold intact; see
  // MAX_CAREER_OPS_SECRET_LENGTH.
  if (apiKey.length > MAX_CAREER_OPS_SECRET_LENGTH) {
    return { enabled: false, reason: "oversized_api_key" };
  }
  const rawScopeSecret = process.env.HERMES_CAREER_OPS_SCOPE_SECRET?.trim();
  if (rawScopeSecret && rawScopeSecret.length < MIN_CAREER_OPS_SECRET_LENGTH) {
    return { enabled: false, reason: "weak_scope_secret" };
  }
  if (rawScopeSecret && rawScopeSecret.length > MAX_CAREER_OPS_SECRET_LENGTH) {
    return { enabled: false, reason: "oversized_scope_secret" };
  }
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
    value: rawScopeSecret || apiKey,
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
  // `<keyword>: <scheme> <credential>`, where the scheme word is optional.
  //
  // Without the scheme alternative this rule stopped at `Basic` and matched
  // nothing at all — five characters is below the eight-character token floor —
  // so `Authorization: Basic <base64 of user:pass>` passed through intact. The
  // scheme is matched generically rather than against a list of known ones: a
  // custom scheme is exactly the case where stopping early leaks, and once the
  // text says `authorization:` an extra word of over-redaction costs nothing.
  //
  // The optional quote before the separator is for JSON, where the key's own
  // closing quote sits between the keyword and the colon.
  /\b(?:api[_-]?key|apikey|token|secret|authorization)\b"?\s*[:=]\s*"?(?:[A-Za-z][A-Za-z0-9-]{0,31}\s+)?[A-Za-z0-9._~+/=-]{8,}"?/gi,
  // A Basic credential with no header name around it, anchored on base64
  // padding. The label is what makes the rule above safe to widen; `basic` on
  // its own is an ordinary English word, and only the `=` tail separates a
  // credential from "basic responsibilities". Unpadded bare Basic values are
  // therefore outside this rule and rely on the labelled form above.
  /\bbasic\s+[A-Za-z0-9+/]{8,}={1,2}/gi,
  // Self-identifying credentials, which arrive with no label at all.
  //
  // Exact matching only knows this deployment's own two secrets, and the rules
  // above need a keyword. Hermes holds other connector credentials — the Nexus
  // MCP token above all — and an agent that prints one usually prints it bare:
  // no `Bearer`, no `token=`. These shapes are distinctive enough to strip on
  // sight, and each is anchored on a fixed prefix (or, for a JWT, on its
  // three-segment structure) so ordinary prose cannot match.
  /\bsk-[A-Za-z0-9._-]{8,}/gi,
  /\bjt_[A-Za-z0-9._-]{16,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bAIza[A-Za-z0-9_-]{16,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/gi,
  // JWT: three base64url segments, the first decoding to a JOSE header. The
  // length floors keep it off ordinary dotted text.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/** A character that can appear inside a credential token. */
export const CREDENTIAL_TOKEN_CHAR = /[A-Za-z0-9._~+/=-]/;

/**
 * The same credential shapes as `SECRET_PATTERNS`, but in their *incomplete*
 * form: the keyword plus however much of the token has arrived so far.
 *
 * `SECRET_PATTERNS` needs eight token characters before it matches — which is
 * exactly the state a partially-arrived credential is not yet in. Streaming
 * code cutting a buffer has to reason about the candidate, not the completed
 * match, or it emits a prefix too short to match and retains a suffix that no
 * longer carries the keyword.
 *
 * Keep in step with `SECRET_PATTERNS`: a shape added there without a candidate
 * here is protected in whole text and split-able across a stream seam.
 */
export const CREDENTIAL_CANDIDATES: RegExp[] = [
  /\bbearer\s*[A-Za-z0-9._~+/=-]*/gi,
  /\b(?:api[_-]?key|apikey|token|secret|authorization)\b"?\s*[:=]?\s*"?(?:[A-Za-z][A-Za-z0-9-]{0,31}\s+)?[A-Za-z0-9._~+/=-]*/gi,
  /\bbasic\s*[A-Za-z0-9+/]*={0,2}/gi,
  /\bsk-[A-Za-z0-9._-]*/gi,
  /\bjt_[A-Za-z0-9._-]*/gi,
  /\bgh[pousr]_[A-Za-z0-9]*/g,
  /\bAIza[A-Za-z0-9_-]*/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]*/g,
  /\bxox[abposr]-[A-Za-z0-9-]*/gi,
  /\beyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2}/g,
];

/**
 * Conservative redaction for text that came from (or names) the upstream.
 * Applied to everything derived from a Hermes response before it can reach a
 * log line, an error message, or an API response body.
 */
/**
 * Strip credential-like content without bounding the length.
 *
 * Assistant output and streamed deltas need the same stripping as error text
 * but must not be truncated to an error-sized excerpt, so the two concerns are
 * separated here.
 */
export function redactSecrets(input: unknown): string {
  if (input === undefined || input === null) return "";
  let text = input instanceof Error ? input.message : String(input);

  // Exact configured secrets first. The generic patterns below match things
  // like `Bearer <prefix>`, and running them first would replace a prefix of
  // the real key with a placeholder — after which the exact key is no longer
  // present to match and its remainder survives.
  for (const secret of configuredSecrets()) {
    text = text.split(secret).join(REDACTION_PLACEHOLDER);
  }
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, REDACTION_PLACEHOLDER);
  return text;
}

/** The exact secrets this deployment holds, longest first. */
export function configuredSecrets(): string[] {
  return [
    process.env.HERMES_CAREER_OPS_API_KEY?.trim(),
    process.env.HERMES_CAREER_OPS_SCOPE_SECRET?.trim(),
  ]
    // The same bounds configuration enforces, so every accepted secret is one
    // this can actually strip and one the stream seam can hold whole.
    .filter(
      (value): value is string =>
        !!value &&
        value.length >= MIN_CAREER_OPS_SECRET_LENGTH &&
        value.length <= MAX_CAREER_OPS_SECRET_LENGTH,
    )
    .sort((a, b) => b.length - a.length);
}

export function redactUpstreamError(input: unknown): string {
  return redactSecrets(input).slice(0, REDACTED_ERROR_LIMIT);
}
