import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  redactSensitiveText,
  secretHint,
} from "../secrets";

const KEY = "11".repeat(32);
const ORIGINAL_KEY = process.env.AGENT_SECRET_ENCRYPTION_KEY;

describe("agent secret encryption", () => {
  beforeEach(() => {
    process.env.AGENT_SECRET_ENCRYPTION_KEY = KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.AGENT_SECRET_ENCRYPTION_KEY;
    else process.env.AGENT_SECRET_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it("round-trips a secret only with the same purpose", () => {
    const encrypted = encryptSecret("sk-live-example", "llm:openai");

    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain("sk-live-example");
    expect(decryptSecret(encrypted, "llm:openai")).toBe("sk-live-example");
    expect(() => decryptSecret(encrypted, "mcp:authorization")).toThrow(
      "Unable to decrypt stored secret",
    );
  });

  it("uses a fresh IV for each encryption", () => {
    expect(encryptSecret("same", "llm:openai")).not.toBe(
      encryptSecret("same", "llm:openai"),
    );
  });

  it("fails closed when the encryption key is missing or malformed", () => {
    delete process.env.AGENT_SECRET_ENCRYPTION_KEY;
    expect(() => encryptSecret("secret", "llm:openai")).toThrow(
      "AGENT_SECRET_ENCRYPTION_KEY must be set",
    );

    process.env.AGENT_SECRET_ENCRYPTION_KEY = "too-short";
    expect(() => encryptSecret("secret", "llm:openai")).toThrow(
      "AGENT_SECRET_ENCRYPTION_KEY must be set",
    );
  });

  it("rejects malformed ciphertext without echoing it", () => {
    expect(() => decryptSecret("v1.bad.payload", "llm:openai")).toThrow(
      "Unable to decrypt stored secret",
    );
  });

  it("creates a non-sensitive last-four hint", () => {
    expect(secretHint("sk-project-1234567890")).toBe("••••7890");
    expect(secretHint("abc")).toBe("••••");
  });

  it("redacts bearer values and explicit secrets from errors", () => {
    const text = "Authorization: Bearer sk-live-secret; api_key=sk-live-secret";
    const redacted = redactSensitiveText(text, ["sk-live-secret"]);

    expect(redacted).not.toContain("sk-live-secret");
    expect(redacted).toContain("[REDACTED]");
  });
});
