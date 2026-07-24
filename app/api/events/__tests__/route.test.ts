import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockListApplicationEventsFiltered, mockRequireAuth } = vi.hoisted(() => ({
  mockListApplicationEventsFiltered: vi.fn(),
  mockRequireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ listApplicationEventsFiltered: mockListApplicationEventsFiltered }),
}));
vi.mock("@/lib/session", () => ({ requireAuth: mockRequireAuth }));

import { GET } from "../route";

describe("GET /api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ userId: "user-1", user: { email: "owner@example.com" } });
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

  it("rejects malformed filters without querying storage", async () => {
    const response = await GET(new NextRequest("http://localhost/api/events?type=not-real"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "event_query_invalid" });
    expect(mockListApplicationEventsFiltered).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mockRequireAuth.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/events"));
    expect(response.status).toBe(401);
  });
});
