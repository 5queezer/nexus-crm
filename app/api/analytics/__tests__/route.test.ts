import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listApplications: vi.fn(),
  listApplicationEventsFiltered: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    listApplications: mocks.listApplications,
    listApplicationEventsFiltered: mocks.listApplicationEventsFiltered,
  }),
}));
vi.mock("@/lib/session", () => ({ requireAuth: mocks.requireAuth }));

import { GET } from "../route";

describe("GET /api/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ userId: "owner-1", readScopeUserId: null, user: { isAdmin: true } });
    mocks.listApplications.mockResolvedValue([]);
    mocks.listApplicationEventsFiltered.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("queries the complete authenticated owner's cohort including archived records by default", async () => {
    const response = await GET(new NextRequest("http://localhost/api/analytics?start=2026-08-01&end=2026-08-31"));

    expect(response.status).toBe(200);
    expect(mocks.listApplications).toHaveBeenCalledWith("owner-1");
    expect(mocks.listApplicationEventsFiltered).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ order: "oldest", limit: 100 }),
    );
    await expect(response.json()).resolves.toMatchObject({
      filters: { start: "2026-08-01", end: "2026-08-31", includeArchived: true },
      cohort: { total: 0, contacted: 0 },
      replyRate: { percentage: null },
    });
  });

  it("paginates through every relevant event page", async () => {
    mocks.listApplicationEventsFiltered
      .mockResolvedValueOnce({ items: [], nextCursor: "eyJ2ZXJzaW9uIjoxLCJvY2N1cnJlZEF0IjoiMjAyNi0wOC0xMVQxMjowMDowMC4wMDBaIiwiaWQiOiIxIn0" })
      .mockResolvedValueOnce({ items: [], nextCursor: null });

    const response = await GET(new NextRequest("http://localhost/api/analytics?start=2026-08-01&end=2026-08-31"));

    expect(response.status).toBe(200);
    expect(mocks.listApplicationEventsFiltered).toHaveBeenCalledTimes(2);
    expect(mocks.listApplicationEventsFiltered.mock.calls[1][1]).toMatchObject({
      cursor: { version: 1, id: "1", occurredAt: "2026-08-11T12:00:00.000Z" },
    });
  });

  it("rejects malformed filters before reading storage", async () => {
    const response = await GET(new NextRequest("http://localhost/api/analytics?start=31-08-2026&end=2026-08-01"));

    expect(response.status).toBe(400);
    expect(mocks.listApplications).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.requireAuth.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/analytics?start=2026-08-01&end=2026-08-31"));
    expect(response.status).toBe(401);
  });
});
