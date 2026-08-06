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
vi.mock("@/components/application-detail", () => ({
  ApplicationDetail: (props: unknown) => ({ type: "ApplicationDetail", props }),
}));

import ApplicationDetailPage, { generateMetadata } from "../page";

const ownerSession = {
  userId: "owner-1",
  readScopeUserId: null,
  user: { id: "owner-1", name: "Chris", email: "chris@example.com", image: null, isAdmin: true },
};

const application = {
  id: "106",
  userId: "owner-1",
  company: "Hygraph",
  role: "Senior Fullstack Engineer",
  status: "interview",
  appliedAt: null,
  lastContact: null,
  followUpAt: null,
  notes: null,
  jobDescription: null,
  source: null,
  remote: true,
  salaryMin: null,
  salaryMax: null,
  rating: 5,
  jobUrl: null,
  canonicalJobUrl: null,
  resumeId: null,
  companySize: null,
  salaryBandMentioned: false,
  triageQuality: null,
  triageReason: null,
  incomingSource: null,
  autoRejected: false,
  autoRejectReason: null,
  archivedAt: null,
  workMode: "remote",
  eligibleCountries: [],
  primaryLocations: [],
  officeDaysMin: null,
  travelPercent: null,
  visaSponsorship: null,
  rightToWorkRequired: null,
  timezoneOverlap: null,
  salaryCurrency: null,
  salaryPeriod: null,
  salaryType: null,
  jobSummary: null,
  currentStage: "technical interview",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  contacts: [],
};

function props(slug: string, id = "106") {
  return { params: Promise.resolve({ id, slug }) };
}

const canonicalPath = "/applications/106/hygraph-senior-fullstack-engineer";

describe("/applications/[id]/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(ownerSession);
    mocks.getApplication.mockResolvedValue(application);
  });

  it("preserves the full requested deep link for anonymous login", async () => {
    mocks.requireAuth.mockResolvedValue(null);
    await expect(ApplicationDetailPage(props("hygraph-senior-fullstack-engineer")))
      .rejects.toThrow(`REDIRECT:/login?callbackURL=${encodeURIComponent(canonicalPath)}`);
    expect(mocks.getApplication).not.toHaveBeenCalled();
  });

  it("looks up exclusively by owner and ID, then renders the canonical route", async () => {
    const result = await ApplicationDetailPage(props("hygraph-senior-fullstack-engineer"));
    expect(mocks.getApplication).toHaveBeenCalledWith("106", "owner-1");
    expect(result).toMatchObject({ props: { canonicalPath } });
  });

  it("redirects a missing or stale presentation slug after loading by ID", async () => {
    await expect(ApplicationDetailPage(props("alter-name")))
      .rejects.toThrow(`REDIRECT:${canonicalPath}`);
    expect(mocks.getApplication).toHaveBeenCalledWith("106", "owner-1");
  });

  it("returns 404 without querying for a malformed ID", async () => {
    await expect(ApplicationDetailPage(props("anything", "../secret"))).rejects.toThrow("NOT_FOUND");
    expect(mocks.getApplication).not.toHaveBeenCalled();
  });

  it("returns the identical 404 for unknown and foreign IDs", async () => {
    mocks.getApplication.mockResolvedValue(null);
    await expect(ApplicationDetailPage(props("anything"))).rejects.toThrow("NOT_FOUND");
    expect(mocks.getApplication).toHaveBeenCalledWith("106", "owner-1");
  });

  it("sets private canonical metadata", async () => {
    const metadata = await generateMetadata(props("stale"));
    expect(metadata).toMatchObject({
      title: "Hygraph — Senior Fullstack Engineer | Nexus CRM",
      alternates: { canonical: canonicalPath },
      robots: { index: false, follow: false },
    });
  });
});
