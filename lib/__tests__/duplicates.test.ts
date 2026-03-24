import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

import { prisma } from "@/lib/prisma";
import { findDuplicateApplications, DUPLICATE_SIMILARITY_THRESHOLD } from "../duplicates";

const mockQueryRaw = prisma.$queryRaw as ReturnType<typeof vi.fn>;

describe("findDuplicateApplications", () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
  });

  it("returns empty array when no duplicates found", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await findDuplicateApplications("Acme", "Engineer", "user1");
    expect(result).toEqual([]);
    expect(mockQueryRaw).toHaveBeenCalledOnce();
  });

  it("returns mapped duplicates with string ids", async () => {
    mockQueryRaw.mockResolvedValue([
      { id: 42, company: "Acme Corp", role: "Software Engineer", sim: 0.85 },
      { id: 7, company: "Acme", role: "Sr Engineer", sim: 0.55 },
    ]);
    const result = await findDuplicateApplications("Acme Corp", "Software Engineer", "user1");
    expect(result).toEqual([
      { id: "42", company: "Acme Corp", role: "Software Engineer", similarity: 0.85 },
      { id: "7", company: "Acme", role: "Sr Engineer", similarity: 0.55 },
    ]);
  });

  it("passes the query to prisma.$queryRaw", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await findDuplicateApplications("FooCo", "Designer", "user-abc");
    expect(mockQueryRaw).toHaveBeenCalledOnce();
  });

  it("exports a tunable threshold constant", () => {
    expect(typeof DUPLICATE_SIMILARITY_THRESHOLD).toBe("number");
    expect(DUPLICATE_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(DUPLICATE_SIMILARITY_THRESHOLD).toBeLessThan(1);
  });
});
