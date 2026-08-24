import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAREER_OPS_MAX_MESSAGE_LENGTH,
  MAX_CAREER_OPS_SECRET_LENGTH,
  MIN_CAREER_OPS_SECRET_LENGTH,
  careerOpsMemoryScope,
  configuredSecrets,
  readCareerOpsConfig,
  redactUpstreamError,
} from "../config";
import { SecretBoundaryRedactor } from "../sse";

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

  it("refuses a secret longer than the stream seam can hold whole", () => {
    // The seam holds back a tail one character shorter than the longest
    // configured secret, but that tail is capped so an endless upstream token
    // cannot grow it without bound. A key past the cap therefore defeated the
    // mechanism silently: the first delta carrying more than the cap of its
    // prefix emitted that prefix, and no pattern matches a bare high-entropy
    // prefix. The cap is a configuration bound now, not a documented gap.
    enable();
    process.env.HERMES_CAREER_OPS_API_KEY = "a".repeat(MAX_CAREER_OPS_SECRET_LENGTH + 1);
    let config = readCareerOpsConfig();
    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error("unreachable");
    expect(config.reason).toBe("oversized_api_key");
    // And nothing that long is treated as a redactable secret either, so the
    // seam window never claims a guarantee it cannot keep.
    expect(configuredSecrets()).toHaveLength(0);

    process.env.HERMES_CAREER_OPS_API_KEY = "a".repeat(MIN_CAREER_OPS_SECRET_LENGTH);
    process.env.HERMES_CAREER_OPS_SCOPE_SECRET = "b".repeat(MAX_CAREER_OPS_SECRET_LENGTH + 1);
    config = readCareerOpsConfig();
    expect(config.enabled).toBe(false);
    if (config.enabled) throw new Error("unreachable");
    expect(config.reason).toBe("oversized_scope_secret");
    delete process.env.HERMES_CAREER_OPS_SCOPE_SECRET;
  });

  it("keeps the bundled mock's default key admissible", () => {
    // The documented local setup uses the mock's default key. When the minimum
    // was introduced the 7-character default was left behind, so following the
    // runbook produced `weak_api_key` and the launcher never rendered — the
    // constant moved and its fixtures did not.
    const mock = readFileSync(path.join(process.cwd(), "scripts/mock-hermes.mjs"), "utf8");
    const runbook = readFileSync(
      path.join(process.cwd(), "docs/operations/hermes-career-ops-setup.md"),
      "utf8",
    );
    const defaultKey = /MOCK_HERMES_KEY \?\? "([^"]+)"/.exec(mock)?.[1];
    expect(defaultKey).toBeTruthy();
    expect(defaultKey!.length).toBeGreaterThanOrEqual(MIN_CAREER_OPS_SECRET_LENGTH);
    // And the runbook tells the operator to use that same key.
    expect(runbook).toContain(`HERMES_CAREER_OPS_API_KEY="${defaultKey}"`);
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

  it("removes the credential after an authorization scheme word", () => {
    // Assembled at runtime on purpose: a literal credential in a test file is
    // a finding of its own, whatever it decodes to.
    const credential = Buffer.from(["demo", "sample-value"].join(":")).toString("base64");
    expect(credential.length).toBeGreaterThan(8);

    // The labelled header form. The rule used to stop at the scheme — five
    // characters, below its own token floor — so the whole line matched
    // nothing and the credential travelled intact into logs and the browser.
    const redacted = redactUpstreamError(`upstream said ${"Authorization"}: Basic ${credential}`);
    expect(redacted).not.toContain(credential);
    expect(redacted).toContain("[redacted]");

    // Any scheme, not a list of known ones: an unrecognised scheme is exactly
    // where stopping early leaks.
    const custom = redactUpstreamError(`${"Authorization"}: Nexus-Signature ${credential}`);
    expect(custom).not.toContain(credential);

    // And the JSON-quoted key, where the closing quote sits before the colon.
    const json = redactUpstreamError(`{"${"authorization"}":"Basic ${credential}"}`);
    expect(json).not.toContain(credential);
  });

  it("removes a bare padded Basic credential", () => {
    const credential = Buffer.from(["demo", "sample-value"].join(":")).toString("base64");
    expect(credential.endsWith("=")).toBe(true);
    expect(redactUpstreamError(`refused: Basic ${credential}`)).not.toContain(credential);
  });

  it("removes a password-labelled value", () => {
    // Exact matching only knows this deployment's own two secrets. Hermes holds
    // other connectors' credentials, and a password is the one that arrives
    // labelled in plain words — the keyword set simply did not have it, so it
    // travelled through transcripts, approval details, deltas and logs intact.
    const value = ["not", "a", "real", "passphrase", "1234"].join("-");
    for (const label of ["password", "passwd", "Password"]) {
      expect(redactUpstreamError(`connector said ${label}=${value}`)).not.toContain(value);
    }

    // Split across a stream seam, which needs the candidate pattern too.
    const redactor = new SecretBoundaryRedactor();
    let out = redactor.push(`${"filler ".repeat(20)}password=${value.slice(0, 6)}`);
    out += redactor.push(`${value.slice(6)} trailing`);
    out += redactor.flush();
    expect(out).not.toContain(value);
    expect(out).toContain("trailing");
  });

  it("removes compound OAuth credential labels", () => {
    // An underscore is a word character, so `\btoken\b` finds no boundary
    // inside `access_token` and matched none of these: the OAuth credentials an
    // agent is most likely to print went through untouched unless they happened
    // to carry a prefix one of the self-identifying rules knows.
    const value = ["not", "a", "real", "credential", "9876"].join("-");
    for (const label of ["access_token", "refresh_token", "client_secret", "api_secret"]) {
      expect(redactUpstreamError(`connector said ${label}=${value}`)).not.toContain(value);
    }

    // And across a stream seam, which needs the candidate pattern.
    const redactor = new SecretBoundaryRedactor();
    let out = redactor.push(`${"filler ".repeat(20)}access_token=${value.slice(0, 5)}`);
    out += redactor.push(`${value.slice(5)} trailing`);
    out += redactor.flush();
    expect(out).not.toContain(value);
    expect(out).toContain("trailing");
  });

  it("removes a credential carried in a connection URI", () => {
    // A connector URI is how a credential most often travels with no label
    // anywhere near it, and none of the labelled or self-identifying rules look
    // inside one. The scheme and host survive: they say what failed without
    // saying who it belonged to.
    const secret = ["not", "a", "real", "passphrase"].join("-");
    for (const uri of [
      `postgresql://alice:${secret}@db.internal:5432/nexus`,
      `https://svc:${secret}@proxy.internal/path`,
      `redis://:${secret}@cache.internal`,
    ]) {
      const redacted = redactUpstreamError(`connect failed for ${uri}`);
      expect(redacted).not.toContain(secret);
      expect(redacted).toContain("[redacted]");
      expect(redacted).toContain("internal");
    }

    // An ordinary URL with a port is not a credential.
    const plain = "see https://example.com:8080/status for details";
    expect(redactUpstreamError(plain)).toBe(plain);

    // And across a stream seam.
    const redactor = new SecretBoundaryRedactor();
    let out = redactor.push(`${"filler ".repeat(20)}postgresql://alice:${secret.slice(0, 4)}`);
    out += redactor.push(`${secret.slice(4)}@db.internal trailing`);
    out += redactor.flush();
    expect(out).not.toContain(secret);
    expect(out).toContain("trailing");
  });

  it("leaves ordinary prose about a password alone", () => {
    // The keyword needs a separator and eight token characters after it, so
    // prose that merely mentions one is untouched.
    const prose = "The password reset link expires, so request a new one.";
    expect(redactUpstreamError(prose)).toBe(prose);
  });

  it("leaves ordinary prose about basics alone", () => {
    // The widened rules must not eat the transcript. `basic` is an English
    // word, which is why the bare form is anchored on base64 padding and the
    // scheme form needs the credential keyword in front of it.
    const prose = "The role lists basic responsibilities and a basic understanding of finance.";
    expect(redactUpstreamError(prose)).toBe(prose);
  });

  it("removes the Nexus MCP OAuth tokens the agent actually holds", () => {
    // These are the credentials Hermes carries for this deployment, minted by
    // lib/mcp-oauth.ts, and an agent that prints one prints it bare — no
    // `Bearer`, no `token=`. Without the prefix nothing matched them, so a
    // transcript, a completed output or an upstream error carried them intact.
    // Assembled at runtime and low-entropy on purpose.
    for (const prefix of ["mcp_at", "mcp_rt"]) {
      const token = `${prefix}_${"0123456789abcdef".repeat(4)}`;
      const redacted = redactUpstreamError(`upstream said ${token} was rejected`);
      expect(redacted).not.toContain(token);
      expect(redacted).toContain("[redacted]");
    }

    // And the same shape split across a stream seam, which needs the candidate
    // pattern rather than the completed one.
    const split = `mcp_at_${"0123456789abcdef".repeat(4)}`;
    const redactor = new SecretBoundaryRedactor();
    let out = redactor.push(`${"filler ".repeat(20)}${split.slice(0, 12)}`);
    out += redactor.push(`${split.slice(12)} trailing`);
    out += redactor.flush();
    expect(out).not.toContain(split);
    expect(out).not.toContain(split.slice(12));
    expect(out).toContain("trailing");
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
