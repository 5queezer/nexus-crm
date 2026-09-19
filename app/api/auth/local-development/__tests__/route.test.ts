import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
}));

vi.mock("@/lib/auth/local-development", () => ({
  isLocalDevelopmentAuthEnabled: mocks.enabled,
}));

import { GET } from "../route";

describe("GET /api/auth/local-development", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes only whether local credential login is enabled", async () => {
    mocks.enabled.mockReturnValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
  });
});
