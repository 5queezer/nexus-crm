import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAREER_OPS_MAX_MESSAGE_LENGTH,
  MIN_CAREER_OPS_SECRET_LENGTH,
  careerOpsMemoryScope,
  configuredSecrets,
  readCareerOpsConfig,
  redactUpstreamError,
} from "../config";

const KEYS = [
  "HERMES_CAREER_OPS_ENABLED",
  "HERMES_CAREER_OPS_BASE_URL",
  "HERMES_CAREER_OPS_API_KEY",
  "HERMES_CAREER_OPS_SCOPE_SECRET",
  "HERMES_CAREER_OPS_OWNER_USER_ID",
  "HERMES_CAREER_OPS_CONNECT_TIMEOUT_MS",
  "HERMES_CAREER_OPS_STREAM_IDLE_TIMEOUT_MS",
  "HERMES_CAREER_OPS_RUN_TIMEOUT_MS",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function enable(overrides: Record<string, string> = {}) {
  process.env.HERMES_CAREER_OPS_ENABLED = "true";
  process.env.HERMES_CAREER_OPS_BASE_URL = "http://127.0.0.1:8642/p/career-ops";
  process.env.HERMES_CAREER_OPS_API_KEY = "hermes-test-key-value";
  process.env.HERMES_CAREER_OPS_OWNER_USER_ID = "user-a";
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
}

describe("readCareerOpsConfig", () => {
  it("is disabled when nothing is configured", () => {
    const config = readCareerOpsConfig();
    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error("unreachable");
    expect(config.reason).toBe("not_configured");
  });

  it("is disabled when the feature flag is off even with credentials present", () => {
    enable({ HERMES_CAREER_OPS_ENABLED: "false" });
    const config = readCareerOpsConfig();
    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error("unreachable");
    expect(config.reason).toBe("disabled");
  });

  it("is disabled when the API key is missing", () => {
    enable();
    delete process.env.HERMES_CAREER_OPS_API_KEY;
  delete process.env.HERMES_CAREER_OPS_OWNER_USER_ID;
    const config = readCareerOpsConfig();
    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error("unreachable");
    expect(config.reason).toBe("not_configured");
  });

  it("refuses a secret too short for redaction to strip", () => {
    // Configuration accepted a key of any length while exact redaction skipped
    // short ones, and the generic credential patterns need longer tokens — so a
    // very short key was live *and* unredactable. An upstream error or
    // transcript echoing it would have carried the bearer secret straight into
    // the logs and the browser. The two bounds are now one constant.
    enable();
    process.env.HERMES_CAREER_OPS_API_KEY = "abc";
    let config = readCareerOpsConfig();
    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error("unreachable");
    expect(config.reason).toBe("weak_api_key");
    // And nothing that short is treated as a redactable secret either.
    expect(configuredSecrets()).not.toContain("abc");

    // An explicitly set scope secret is held to the same bound.
    process.env.HERMES_CAREER_OPS_API_KEY = "a".repeat(MIN_CAREER_OPS_SECRET_LENGTH);
    process.env.HERMES_CAREER_OPS_SCOPE_SECRET = "short";
    config = readCareerOpsConfig();
    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error("unreachable");
    expect(config.reason).toBe("weak_scope_secret");
    delete process.env.HERMES_CAREER_OPS_SCOPE_SECRET;
  });

  it("accepts and redacts a secret at the minimum length", () => {
    // The bound has to admit what it accepts: a key exactly at the floor must
    // both enable the feature and be stripped from upstream text.
    enable();
    const key = `k${"1234567890".repeat(3)}`.slice(0, MIN_CAREER_OPS_SECRET_LENGTH);
    process.env.HERMES_CAREER_OPS_API_KEY = key;
    expect(readCareerOpsConfig().enabled).toBe(true);
    expect(configuredSecrets()).toContain(key);
    expect(redactUpstreamError(`upstream said ${key}`)).not.toContain(key);
  });

  it("is disabled when the base URL is not an absolute http(s) URL", () => {
    for (const value of ["/p/career-ops", "ftp://host/p", "javascript:alert(1)", "not a url"]) {
      enable({ HERMES_CAREER_OPS_BASE_URL: value });
      const config = readCareerOpsConfig();
      expect(config.enabled, value).toBe(false);
      if (config.enabled) throw new Error("unreachable");
      expect(config.reason, value).toBe("invalid_base_url");
    }
  });

  it("normalizes the base URL by trimming trailing slashes", () => {
    enable({ HERMES_CAREER_OPS_BASE_URL: "http://127.0.0.1:8642/p/career-ops///" });
    const config = readCareerOpsConfig();
    expect(config.enabled).toBe(true);
    if (!config.enabled) throw new Error("unreachable");
    expect(config.baseUrl).toBe("http://127.0.0.1:8642/p/career-ops");
  });

  it("applies bounded timeout defaults and clamps out-of-range values", () => {
    enable();
    const defaults = readCareerOpsConfig();
    if (!defaults.enabled) throw new Error("unreachable");
    expect(defaults.connectTimeoutMs).toBeGreaterThan(0);
    expect(defaults.streamIdleTimeoutMs).toBeGreaterThan(defaults.connectTimeoutMs);
    expect(defaults.runTimeoutMs).toBeGreaterThanOrEqual(defaults.streamIdleTimeoutMs);

    enable({
      HERMES_CAREER_OPS_CONNECT_TIMEOUT_MS: "0",
      HERMES_CAREER_OPS_STREAM_IDLE_TIMEOUT_MS: "not-a-number",
      HERMES_CAREER_OPS_RUN_TIMEOUT_MS: "99999999",
    });
    const clamped = readCareerOpsConfig();
    if (!clamped.enabled) throw new Error("unreachable");
    expect(clamped.connectTimeoutMs).toBe(defaults.connectTimeoutMs);
    expect(clamped.streamIdleTimeoutMs).toBe(defaults.streamIdleTimeoutMs);
    expect(clamped.runTimeoutMs).toBeLessThanOrEqual(30 * 60_000);
  });

  it("is disabled until the MCP token owner is declared", () => {
    enable();
    delete process.env.HERMES_CAREER_OPS_OWNER_USER_ID;
    const config = readCareerOpsConfig();
    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error("unreachable");
    // The agent's tool calls act as the token owner, so serving anyone before
    // that binding is declared would expose the owner's CRM data.
    expect(config.reason).toBe("owner_not_configured");
  });

  it("never exposes the API key through a stringified config", () => {
    enable();
    const config = readCareerOpsConfig();
    expect(JSON.stringify(config)).not.toContain("hermes-test-key-value");
  });
});

describe("careerOpsMemoryScope", () => {
  it("produces a stable, prefixed scope for the same user", () => {
    enable();
    const config = readCareerOpsConfig();
    if (!config.enabled) throw new Error("unreachable");
    const first = careerOpsMemoryScope(config, "user-a");
    const second = careerOpsMemoryScope(config, "user-a");
    expect(first).toBe(second);
    expect(first.startsWith("agent:career-ops:nexus:dm:")).toBe(true);
  });

  it("differs between users and contains no personal identifier", () => {
    enable();
    const config = readCareerOpsConfig();
    if (!config.enabled) throw new Error("unreachable");
    const a = careerOpsMemoryScope(config, "user-a");
    const b = careerOpsMemoryScope(config, "user-b");
    expect(a).not.toBe(b);
    expect(a).not.toContain("user-a");
    expect(a).not.toContain("@");
  });

  it("stays within the Hermes header limits", () => {
    enable();
    const config = readCareerOpsConfig();
    if (!config.enabled) throw new Error("unreachable");
    const scope = careerOpsMemoryScope(config, "u".repeat(500));
    expect(scope.length).toBeLessThanOrEqual(256);
    expect(/[\r\n\0]/.test(scope)).toBe(false);
  });
});

describe("redactUpstreamError", () => {
  it("removes bearer tokens, api keys and long opaque secrets", () => {
    const redacted = redactUpstreamError(
      'upstream said Authorization: Bearer sk-abcdef0123456789abcdef0123456789 and api_key="hermes-test-key-value"',
    );
    expect(redacted).not.toContain("sk-abcdef0123456789abcdef0123456789");
    expect(redacted).not.toContain("hermes-test-key-value");
    expect(redacted).toContain("[redacted]");
  });

  it("bounds the redacted length", () => {
    expect(redactUpstreamError("x".repeat(5000)).length).toBeLessThanOrEqual(300);
  });

  it("handles non-string input", () => {
    expect(redactUpstreamError(undefined)).toBe("");
    expect(redactUpstreamError(new Error("boom"))).toContain("boom");
  });
});

describe("limits", () => {
  it("bounds the user message length", () => {
    expect(CAREER_OPS_MAX_MESSAGE_LENGTH).toBeGreaterThan(0);
    expect(CAREER_OPS_MAX_MESSAGE_LENGTH).toBeLessThanOrEqual(16_000);
  });
});
