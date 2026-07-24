import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetApplication, mockListApplicationEventsFiltered, mockRequireAuth } = vi.hoisted(() => ({
  mockGetApplication: vi.fn(),
  mockListApplicationEventsFiltered: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    getApplication: mockGetApplication,
    listApplicationEventsFiltered: mockListApplicationEventsFiltered,
  }),
}));
vi.mock("@/lib/session", () => ({ requireAuth: mockRequireAuth }));

import { GET } from "../route";

describe("GET /api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: "user-1",
      readScopeUserId: "user-1",
      user: { email: "owner@example.com" },
    });
    mockGetApplication.mockResolvedValue({ id: "app-1", userId: "user-1" });
    mockListApplicationEventsFiltered.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("parses owner-scoped activity filters and pagination", async () => {
    const response = await GET(new NextRequest("http://localhost/api/events?company=Acme&type=stage_changed&type=interview_scheduled&occurredAfter=2026-07-01T00%3A00%3A00Z&source=mcp&limit=25"));
    expect(response.status).toBe(200);
    expect(mockListApplicationEventsFiltered).toHaveBeenCalledWith("user-1", expect.objectContaining({
      company: "Acme",
      types: ["stage_changed", "interview_scheduled"],
      source: "mcp",
      order: "newest",
      limit: 25,
    }));
  });

  it("uses the selected application's owner for admin timeline reads", async () => {
    mockRequireAuth.mockResolvedValue({
      userId: "admin-1",
      readScopeUserId: null,
      user: { email: "admin@example.com", isAdmin: true },
    });
    mockGetApplication.mockResolvedValue({ id: "app-2", userId: "owner-2" });

    const response = await GET(new NextRequest("http://localhost/api/events?applicationId=app-2"));

    expect(response.status).toBe(200);
    expect(mockGetApplication).toHaveBeenCalledWith("app-2", null);
    expect(mockListApplicationEventsFiltered).toHaveBeenCalledWith(
      "owner-2",
      expect.objectContaining({ applicationId: "app-2" }),
    );
  });

  it("does not query events when the application is outside the read scope", async () => {
    mockGetApplication.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/events?applicationId=app-2"));

    expect(response.status).toBe(404);
    expect(mockListApplicationEventsFiltered).not.toHaveBeenCalled();
  });

  it("rejects malformed filters without querying storage", async () => {
    const response = await GET(new NextRequest("http://localhost/api/events?type=not-real"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "event_query_invalid" });
    expect(mockListApplicationEventsFiltered).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected storage failures", async () => {
    mockListApplicationEventsFiltered.mockRejectedValueOnce(new Error("postgres://secret-internal-detail"));
    const response = await GET(new NextRequest("http://localhost/api/events"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "event_query_failed" });
  });

  it("requires authentication", async () => {
    mockRequireAuth.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/events"));
    expect(response.status).toBe(401);
  });
});
