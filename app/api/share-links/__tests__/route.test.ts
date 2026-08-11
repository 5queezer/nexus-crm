import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireSessionAuth: vi.fn(),
  listShareLinks: vi.fn(),
  deleteShareLink: vi.fn(),
  getDocument: vi.fn(),
  getApplication: vi.fn(),
  findShareLink: vi.fn(),
  createShareLink: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSessionAuth: mocks.requireSessionAuth,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    listShareLinks: mocks.listShareLinks,
    deleteShareLink: mocks.deleteShareLink,
    getDocument: mocks.getDocument,
    getApplication: mocks.getApplication,
    findShareLink: mocks.findShareLink,
    createShareLink: mocks.createShareLink,
  }),
}));

import { DELETE, GET, POST } from "../route";

const session = { userId: "user-1", user: { id: "user-1" } };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/share-links", () => {
  it("requires a real browser session and disables development bypass", async () => {
    mocks.requireSessionAuth.mockResolvedValue(null);
    const request = new NextRequest("https://example.test/api/share-links", {
      method: "POST",
      body: JSON.stringify({ targetType: "share_page" }),
      headers: { "content-type": "application/json", authorization: "Bearer valid-api-token" },
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mocks.requireSessionAuth).toHaveBeenCalledWith({ allowDevBypass: false });
  });

  it("does not mint a public link for a demo-only document", async () => {
    mocks.requireSessionAuth.mockResolvedValue(session);
    mocks.getDocument.mockResolvedValue({
      id: "demo-doc",
      userId: "user-1",
      applicationIds: ["demo-app"],
      applications: [{ id: "demo-app" }],
    });
    mocks.getApplication.mockResolvedValue(null);
    const request = new NextRequest("https://example.test/api/share-links", {
      method: "POST",
      body: JSON.stringify({ targetType: "document", targetId: "demo-doc" }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(mocks.getApplication).toHaveBeenCalledWith("demo-app", "user-1", { demoVisibility: "exclude" });
    expect(mocks.createShareLink).not.toHaveBeenCalled();
  });

  it("does not mint a public link for a detached document with demo provenance", async () => {
    mocks.requireSessionAuth.mockResolvedValue(session);
    mocks.getDocument.mockResolvedValue({
      id: "demo-doc", userId: "user-1", demoProvenance: true,
      applicationIds: [], applications: [],
    });
    const request = new NextRequest("https://example.test/api/share-links", {
      method: "POST",
      body: JSON.stringify({ targetType: "document", targetId: "demo-doc" }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(mocks.createShareLink).not.toHaveBeenCalled();
  });
});

describe("share-link lifecycle", () => {
  it("lists only the signed-in user's links", async () => {
    mocks.requireSessionAuth.mockResolvedValue(session);
    mocks.listShareLinks.mockResolvedValue([{ id: "link-1", code: "secret" }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.listShareLinks).toHaveBeenCalledWith("user-1");
    await expect(response.json()).resolves.toEqual({ links: [{ id: "link-1", code: "secret" }] });
  });

  it("revokes a link through an owner-scoped delete", async () => {
    mocks.requireSessionAuth.mockResolvedValue(session);
    const request = new NextRequest("https://example.test/api/share-links", {
      method: "DELETE",
      body: JSON.stringify({ id: "link-1" }),
      headers: { "content-type": "application/json" },
    });

    const response = await DELETE(request);

    expect(response.status).toBe(204);
    expect(mocks.deleteShareLink).toHaveBeenCalledWith("link-1", "user-1");
  });
});
