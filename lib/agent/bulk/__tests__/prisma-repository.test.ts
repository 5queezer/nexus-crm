import { describe, expect, it } from "vitest";
import { buildBulkApplicationWhere, collectSourceFilteredRows } from "../prisma-repository";

describe("bulk application resolution", () => {
  it("builds an uncapped owner and real-data scoped all-matching query", () => {
    expect(buildBulkApplicationWhere("user-a", {
      mode: "all_matching",
      filters: {
        query: "platform",
        statuses: ["applied", "interview"],
        sources: ["linkedin"],
        remote: true,
        workModes: ["remote"],
        triageQualityMin: 4,
        followUpBefore: "2026-09-19T22:00:00.000Z",
      },
    }, "reschedule_follow_up")).toEqual({
      userId: "user-a",
      isDemo: false,
      archivedAt: null,
      status: { in: ["applied", "interview"] },
      remote: true,
      triageQuality: { gte: 4 },
      followUpAt: { lt: new Date("2026-09-19T22:00:00.000Z") },
      OR: [
        { company: { contains: "platform", mode: "insensitive" } },
        { role: { contains: "platform", mode: "insensitive" } },
        { source: { contains: "platform", mode: "insensitive" } },
        { notes: { contains: "platform", mode: "insensitive" } },
        { contacts: { some: { name: { contains: "platform", mode: "insensitive" } } } },
      ],
      AND: [{
        OR: [
          { workMode: { in: ["remote"] } },
          { workMode: null, remote: true },
        ],
      }],
    });
  });

  it("treats legacy remote rows with no workMode as remote", () => {
    expect(buildBulkApplicationWhere("user-a", {
      mode: "all_matching",
      filters: { workModes: ["remote", "hybrid"] },
    }, "archive")).toMatchObject({
      AND: [{
        OR: [
          { workMode: { in: ["remote", "hybrid"] } },
          { workMode: null, remote: true },
        ],
      }],
    });
  });

  it("paginates past unrelated source categories before applying the matching cap", async () => {
    const rows = [
      { id: 1, source: "LinkedIn" },
      { id: 2, source: "LinkedIn recruiter" },
      { id: 3, source: "Referral" },
    ];
    const fetched = await collectSourceFilteredRows({
      sourceCategories: ["referral"],
      pageSize: 2,
      maxMatches: 10,
      maxScanned: 10,
      fetchPage: async (cursor, take) => rows.filter((row) => cursor === undefined || row.id > cursor).slice(0, take),
    });
    expect(fetched).toEqual([{ id: 3, source: "Referral" }]);
  });

  it("fails explicitly when source filtering exceeds the scan budget", async () => {
    const rows = [
      { id: 1, source: "LinkedIn" },
      { id: 2, source: "LinkedIn" },
      { id: 3, source: "Referral" },
    ];
    await expect(collectSourceFilteredRows({
      sourceCategories: ["referral"],
      pageSize: 2,
      maxMatches: 10,
      maxScanned: 2,
      fetchPage: async (cursor, take) => rows.filter((row) => cursor === undefined || row.id > cursor).slice(0, take),
    })).rejects.toThrow("Bulk scope exceeds the 2 row scan budget");
  });

  it("forces archive and restore to their valid membership regardless of browser filters", () => {
    expect(buildBulkApplicationWhere("user-a", {
      mode: "all_matching",
      filters: { archived: "all" },
    }, "archive")).toMatchObject({ archivedAt: null });
    expect(buildBulkApplicationWhere("user-a", {
      mode: "all_matching",
      filters: { archived: "active" },
    }, "restore")).toMatchObject({ archivedAt: { not: null } });
  });

  it("rejects malformed selected ids before querying Prisma", () => {
    expect(() => buildBulkApplicationWhere("user-a", {
      mode: "selected",
      applicationIds: ["1", "not-an-id"],
    }, "archive")).toThrow("Invalid application id");
  });
});
