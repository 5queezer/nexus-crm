import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getShareLinkByCode: vi.fn(),
  listApplications: vi.fn(),
  getUser: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not_found"); }),
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/share-portal", () => ({ SharePortal: () => null }));

import SharePage from "../page";

describe("public share demo boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getShareLinkByCode.mockResolvedValue({
      code: "public-code",
      userId: "owner-1",
      targetType: "share_page",
    });
    mocks.listApplications.mockResolvedValue([]);
    mocks.getUser.mockResolvedValue({ id: "owner-1", name: "Owner" });
  });

  it("excludes demo applications before public disclosure and statistics", async () => {
    await SharePage({ searchParams: Promise.resolve({ code: "public-code", lang: "en" }) });
    expect(mocks.listApplications).toHaveBeenCalledWith("owner-1", { demoVisibility: "exclude" });
  });
});
