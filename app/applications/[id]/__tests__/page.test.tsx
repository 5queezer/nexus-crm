import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getApplication: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("@/lib/session", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ getApplication: mocks.getApplication }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import ApplicationShortRoute from "../page";

const ownerSession = {
  userId: "owner-1",
  readScopeUserId: null,
  user: { id: "owner-1", email: "owner@example.com", isAdmin: true },
};
const application = { id: "106", company: "Hygraph", role: "Senior Fullstack Engineer" };
function props(id = "106") {
  return { params: Promise.resolve({ id }) };
}

describe("/applications/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(ownerSession);
    mocks.getApplication.mockResolvedValue(application);
  });

  it("preserves the short URL through login", async () => {
    mocks.requireAuth.mockResolvedValue(null);
    await expect(ApplicationShortRoute(props()))
      .rejects.toThrow("REDIRECT:/login?callbackURL=%2Fapplications%2F106");
  });

  it("loads by owner and ID and redirects to the current canonical URL", async () => {
    await expect(ApplicationShortRoute(props()))
      .rejects.toThrow("REDIRECT:/applications/106/hygraph-senior-fullstack-engineer");
    expect(mocks.getApplication).toHaveBeenCalledWith("106", "owner-1");
  });

  it("returns 404 without querying for a malformed ID", async () => {
    await expect(ApplicationShortRoute(props("../secret"))).rejects.toThrow("NOT_FOUND");
    expect(mocks.getApplication).not.toHaveBeenCalled();
  });

  it("does not distinguish unknown and foreign IDs", async () => {
    mocks.getApplication.mockResolvedValue(null);
    await expect(ApplicationShortRoute(props())).rejects.toThrow("NOT_FOUND");
  });
});
