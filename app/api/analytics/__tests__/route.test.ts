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

  it("uses the user's timezone for the selected local calendar-day cohort", async () => {
    mocks.listApplications.mockResolvedValue([
      {
        id: "preceding-day",
        company: "Before",
        role: "Engineer",
        status: "inbound",
        source: "linkedin",
        archivedAt: null,
        createdAt: new Date("2026-08-01T06:59:59.999Z"),
      },
      {
        id: "late-selected-day",
        company: "Late",
        role: "Engineer",
        status: "inbound",
        source: "linkedin",
        archivedAt: null,
        createdAt: new Date("2026-08-02T06:59:59.999Z"),
      },
    ]);

    const response = await GET(new NextRequest(
      "http://localhost/api/analytics?start=2026-08-01&end=2026-08-01&timeZone=America%2FLos_Angeles",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      filters: { start: "2026-08-01", end: "2026-08-01", timeZone: "America/Los_Angeles" },
      cohort: { total: 1 },
      records: [{ id: "late-selected-day" }],
    });
  });

  it("includes a positive-offset local day that begins on the preceding UTC date", async () => {
    mocks.listApplications.mockResolvedValue([
      {
        id: "positive-offset",
        company: "Ahead",
        role: "Engineer",
        status: "inbound",
        source: "linkedin",
        archivedAt: null,
        createdAt: new Date("2026-07-31T20:00:00.000Z"),
      },
    ]);

    const response = await GET(new NextRequest(
      "http://localhost/api/analytics?start=2026-08-01&end=2026-08-01&timeZone=Asia%2FKolkata",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ cohort: { total: 1 } });
  });

  it("rejects an invalid timezone before reading storage", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/analytics?start=2026-08-01&end=2026-08-31&timeZone=not-a-timezone",
    ));

    expect(response.status).toBe(400);
    expect(mocks.listApplications).not.toHaveBeenCalled();
  });

  it("accepts a local calendar day whose midnight is skipped by DST", async () => {
    mocks.listApplications.mockResolvedValue([
      {
        id: "before-gap-day",
        company: "Before",
        role: "Engineer",
        status: "inbound",
        source: "linkedin",
        archivedAt: null,
        createdAt: new Date("2026-09-06T03:59:59.999Z"),
      },
      {
        id: "first-gap-day-instant",
        company: "First",
        role: "Engineer",
        status: "inbound",
        source: "linkedin",
        archivedAt: null,
        createdAt: new Date("2026-09-06T04:00:00.000Z"),
      },
      {
        id: "last-gap-day-instant",
        company: "Last",
        role: "Engineer",
        status: "inbound",
        source: "linkedin",
        archivedAt: null,
        createdAt: new Date("2026-09-07T02:59:59.999Z"),
      },
    ]);

    const response = await GET(new NextRequest(
      "http://localhost/api/analytics?start=2026-09-06&end=2026-09-06&timeZone=America%2FSantiago",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cohort: { total: 2 },
      records: [{ id: "last-gap-day-instant" }, { id: "first-gap-day-instant" }],
    });
  });

  it("requires authentication", async () => {
    mocks.requireAuth.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/analytics?start=2026-08-01&end=2026-08-31"));
    expect(response.status).toBe(401);
  });
});
