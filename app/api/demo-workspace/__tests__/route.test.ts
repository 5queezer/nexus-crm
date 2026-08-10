import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionAuth: vi.fn(),
  ensureDemoWorkspace: vi.fn(),
  deleteDemoWorkspace: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireSessionAuth: mocks.requireSessionAuth }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    ensureDemoWorkspace: mocks.ensureDemoWorkspace,
    deleteDemoWorkspace: mocks.deleteDemoWorkspace,
  }),
}));

import { DELETE, POST } from "../route";

beforeEach(() => vi.clearAllMocks());

describe("/api/demo-workspace", () => {
  it("requires a browser session without development bypass", async () => {
    mocks.requireSessionAuth.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
    expect(mocks.requireSessionAuth).toHaveBeenCalledWith({ allowDevBypass: false });
    expect(mocks.ensureDemoWorkspace).not.toHaveBeenCalled();
  });

  it("creates and replays only for auth.userId with cache-safe responses", async () => {
    mocks.requireSessionAuth.mockResolvedValue({ userId: "owner-1" });
    mocks.ensureDemoWorkspace.mockResolvedValue({ workspace: { id: "ws-1" }, applications: [{ id: "demo-1" }], replayed: true });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.ensureDemoWorkspace).toHaveBeenCalledWith("owner-1", expect.objectContaining({ seedVersion: 1 }));
    await expect(response.json()).resolves.toMatchObject({ replayed: true });
  });

  it("returns conflict without leaking persistence errors when real data exists", async () => {
    mocks.requireSessionAuth.mockResolvedValue({ userId: "owner-1" });
    mocks.ensureDemoWorkspace.mockRejectedValue(new Error("real_applications_exist"));
    const response = await POST();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "real_applications_exist" });
  });

  it("deletes using only auth.userId and treats replay as success", async () => {
    mocks.requireSessionAuth.mockResolvedValue({ userId: "owner-1" });
    mocks.deleteDemoWorkspace.mockResolvedValue({ deletedApplications: 0, deletedEvents: 0 });
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(mocks.deleteDemoWorkspace).toHaveBeenCalledWith("owner-1");
  });
});
