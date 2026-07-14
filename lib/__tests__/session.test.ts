import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getApiTokenByHash: vi.fn(),
  touchApiTokenLastUsed: vi.fn(),
  findUnique: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    getApiTokenByHash: mocks.getApiTokenByHash,
    touchApiTokenLastUsed: mocks.touchApiTokenLastUsed,
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
  },
}));

import { requireSessionAuth } from "../session";

describe("requireSessionAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers({ authorization: "Bearer browser-route-token" }));
    mocks.getApiTokenByHash.mockResolvedValue({ id: "token-1", userId: "user-a" });
    mocks.touchApiTokenLastUsed.mockResolvedValue(undefined);
    mocks.findUnique.mockResolvedValue({
      id: "user-a",
      name: null,
      email: "a@example.com",
      image: null,
      isAdmin: false,
    });
  });

  it("rejects bearer-token authentication", async () => {
    await expect(requireSessionAuth({ allowDevBypass: false })).resolves.toBeNull();
  });

  it("accepts browser-session authentication", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.getSession.mockResolvedValue({
      user: { id: "user-a", name: null, email: "a@example.com", image: null },
    });
    mocks.findUnique.mockResolvedValue({ isAdmin: false });

    await expect(requireSessionAuth({ allowDevBypass: false })).resolves.toMatchObject({
      userId: "user-a",
      authType: "session",
    });
  });
});
