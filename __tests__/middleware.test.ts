import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy, config } from "../proxy";

function makeRequest(url: string, ip = "203.0.113.10") {
  return new NextRequest(url, {
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

describe("proxy", () => {
  it("matches and rate-limits the public share page", () => {
    expect(config.matcher).toContain("/share");

    const ip = "203.0.113.77";
    for (let i = 0; i < 30; i++) {
      const res = proxy(makeRequest("http://localhost/share?code=abc123", ip));
      expect(res.status).not.toBe(429);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("30");
    }

    const blocked = proxy(makeRequest("http://localhost/share?code=abc123", ip));
    expect(blocked.status).toBe(429);
  });
});
