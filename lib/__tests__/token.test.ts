import { describe, it, expect } from "vitest";
import {
  generateApiToken,
  hashApiToken,
  generateShortCode,
  safeCompare,
} from "../token";

describe("generateApiToken", () => {
  it("returns a raw token starting with 'jt_'", () => {
    const { raw } = generateApiToken();
    expect(raw).toMatch(/^jt_[0-9a-f]{64}$/);
  });

  it("returns a SHA-256 hex hash", () => {
    const { hash } = generateApiToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash matches hashApiToken(raw)", () => {
    const { raw, hash } = generateApiToken();
    expect(hashApiToken(raw)).toBe(hash);
  });

  it("generates unique tokens each call", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("hashApiToken", () => {
  it("returns deterministic hash for same input", () => {
    const input = "jt_test123";
    expect(hashApiToken(input)).toBe(hashApiToken(input));
  });

  it("returns different hashes for different inputs", () => {
    expect(hashApiToken("a")).not.toBe(hashApiToken("b"));
  });
});

describe("generateShortCode", () => {
  it("returns a base64url string of 8 characters", () => {
    const code = generateShortCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it("generates unique codes", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateShortCode()));
    expect(codes.size).toBe(100);
  });
});

describe("safeCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(safeCompare("hello", "world")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(safeCompare("short", "longer")).toBe(false);
  });

  it("returns false for empty first argument", () => {
    expect(safeCompare("", "notempty")).toBe(false);
  });

  it("returns false for empty second argument", () => {
    expect(safeCompare("notempty", "")).toBe(false);
  });

  it("returns false for both empty", () => {
    expect(safeCompare("", "")).toBe(false);
  });
});
