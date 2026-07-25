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

import { requireAdmin, requireAuth, requireSessionAuth } from "../session";

describe("requireSessionAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.ALLOWED_EMAIL;
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

  it("rejects bearer-token authentication even when a browser session is valid", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user-a", name: null, email: "a@example.com", image: null },
    });
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

  it("rejects an existing API token after its owner is removed from ALLOWED_EMAIL", async () => {
    process.env.ALLOWED_EMAIL = "allowed@example.com";

    await expect(requireAuth()).resolves.toBeNull();
    expect(mocks.touchApiTokenLastUsed).not.toHaveBeenCalled();
  });

  it("keeps admin API tokens tenant-scoped instead of granting global reads", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-a",
      name: null,
      email: "a@example.com",
      image: null,
      isAdmin: true,
    });

    await expect(requireAuth()).resolves.toMatchObject({
      userId: "user-a",
      readScopeUserId: "user-a",
      authType: "api_token",
    });
  });

  it("does not create an unauthenticated admin when development auth is not explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.headers.mockResolvedValue(new Headers());
    mocks.getSession.mockResolvedValue(null);

    await expect(requireAuth()).resolves.toBeNull();
  });

  it("rejects an admin API token for browser administration routes", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-a",
      name: null,
      email: "a@example.com",
      image: null,
      isAdmin: true,
    });

    await expect(requireAdmin()).resolves.toBeNull();
  });
});
