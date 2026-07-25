import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimitsForTests } from "@/lib/rate-limit";

const mocks = vi.hoisted(() => ({
  exchangeAuthCode: vi.fn(),
  exchangeRefreshToken: vi.fn(),
  verifyClient: vi.fn(),
}));

vi.mock("@/lib/mcp-oauth", () => mocks);

import { POST } from "../route";

function tokenRequest(spoofedIp: string) {
  return new NextRequest("https://nexus.example/api/mcp/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": spoofedIp,
      "x-real-ip": spoofedIp,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "client-1",
      client_secret: "secret",
      code: "code-1",
      redirect_uri: "https://client.example/callback",
      code_verifier: "verifier",
    }),
  });
}

describe("POST /api/mcp/token rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetRateLimitsForTests();
    mocks.verifyClient.mockResolvedValue({ valid: true, redirectUris: ["https://client.example/callback"] });
    mocks.exchangeAuthCode.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp:tools",
    });
  });

  it("does not let untrusted forwarding headers rotate the limiter key", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await POST(tokenRequest(`198.51.100.${attempt}`));
      expect(response.status).toBe(200);
    }

    const blocked = await POST(tokenRequest("203.0.113.250"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });
});
