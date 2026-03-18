import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

// Generate a valid 32-byte key (64 hex chars) for testing
const TEST_KEY = randomBytes(32).toString("hex");

describe("encryption", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_TOKEN_ENCRYPTION_KEY", TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encrypts and decrypts back to original plaintext", async () => {
    const { encryptToken, decryptToken } = await import("../encryption");
    const plaintext = "oauth2-refresh-token-abc123";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const { encryptToken } = await import("../encryption");
    const plaintext = "same-input";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
  });

  it("returns a hex string", async () => {
    const { encryptToken } = await import("../encryption");
    const encrypted = encryptToken("test");
    expect(encrypted).toMatch(/^[0-9a-f]+$/);
  });

  it("handles empty string", async () => {
    const { encryptToken, decryptToken } = await import("../encryption");
    const encrypted = encryptToken("");
    expect(decryptToken(encrypted)).toBe("");
  });

  it("handles unicode content", async () => {
    const { encryptToken, decryptToken } = await import("../encryption");
    const plaintext = "Ünîcödé tëxt 🔑";
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });

  it("throws on tampered ciphertext", async () => {
    const { encryptToken, decryptToken } = await import("../encryption");
    const encrypted = encryptToken("secret");
    // flip a byte in the middle
    const tampered =
      encrypted.slice(0, 30) +
      (encrypted[30] === "a" ? "b" : "a") +
      encrypted.slice(31);
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws when encryption key is missing", async () => {
    vi.stubEnv("EMAIL_TOKEN_ENCRYPTION_KEY", "");
    // Re-import to get fresh module with cleared env
    const mod = await import("../encryption");
    expect(() => mod.encryptToken("test")).toThrow(
      "EMAIL_TOKEN_ENCRYPTION_KEY must be set"
    );
  });

  it("throws when encryption key has wrong length", async () => {
    vi.stubEnv("EMAIL_TOKEN_ENCRYPTION_KEY", "tooshort");
    const mod = await import("../encryption");
    expect(() => mod.encryptToken("test")).toThrow(
      "EMAIL_TOKEN_ENCRYPTION_KEY must be set"
    );
  });
});
