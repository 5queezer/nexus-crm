import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit } from "../rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first request and returns correct remaining count", () => {
    const result = checkRateLimit("1.2.3.4", "general");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(29); // general max is 30
  });

  it("decrements remaining on successive requests", () => {
    const ip = "10.0.0.1";
    checkRateLimit(ip, "general");
    const second = checkRateLimit(ip, "general");
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(28);
  });

  it("blocks after exceeding the limit", () => {
    const ip = "10.0.0.2";
    // auth limit is 10
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(ip, "auth").allowed).toBe(true);
    }
    const blocked = checkRateLimit(ip, "auth");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    const ip = "10.0.0.3";
    // exhaust auth limit
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, "auth");
    }
    expect(checkRateLimit(ip, "auth").allowed).toBe(false);

    // advance past the 60s window
    vi.advanceTimersByTime(60_001);

    const afterReset = checkRateLimit(ip, "auth");
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(9);
  });

  it("tracks different IPs independently", () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit("ip-a", "auth");
    }
    expect(checkRateLimit("ip-a", "auth").allowed).toBe(false);
    expect(checkRateLimit("ip-b", "auth").allowed).toBe(true);
  });

  it("tracks different route groups independently", () => {
    const ip = "10.0.0.4";
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, "auth");
    }
    expect(checkRateLimit(ip, "auth").allowed).toBe(false);
    // same IP, different group — should still be allowed
    expect(checkRateLimit(ip, "applications").allowed).toBe(true);
  });

  it("returns a resetAt timestamp in the future", () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const result = checkRateLimit("10.0.0.5", "general");
    expect(result.resetAt).toBe(Date.now() + 60_000);
  });
});
