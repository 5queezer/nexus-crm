import { describe, it, expect, vi } from "vitest";

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireAuth: mockRequireAuth,
}));

import { GET } from "../route";

describe("GET /api/config/public-token", () => {
  it("requires real auth without the development bypass", async () => {
    mockRequireAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockRequireAuth).toHaveBeenCalledWith({ allowDevBypass: false });
  });

  it("returns gone for authenticated callers because public tokens are disabled", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "user-1",
      readScopeUserId: "user-1",
      user: { id: "user-1", name: null, email: "u@example.com", image: null, isAdmin: false },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toContain("disabled");
  });
});
