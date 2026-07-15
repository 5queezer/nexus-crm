import { describe, expect, it } from "vitest";
import type { Application } from "@/types";
import {
  filterOpportunities,
  type OpportunityFilters,
} from "../opportunity-filters";

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: "1",
    company: "Acme",
    role: "Platform",
    status: "interview",
    appliedAt: null,
    lastContact: null,
    followUpAt: null,
    notes: "Migration",
    jobDescription: null,
    source: "referral",
    remote: true,
    salaryMin: null,
    salaryMax: null,
    rating: null,
    jobUrl: null,
    resumeId: null,
    companySize: null,
    salaryBandMentioned: false,
    triageQuality: 4,
    triageReason: null,
    incomingSource: null,
    autoRejected: false,
    autoRejectReason: null,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    contacts: [
      {
        id: "c",
        name: "Jordan",
        email: null,
        phone: null,
        role: null,
        linkedIn: null,
        applicationId: "1",
        createdAt: "2026-07-01T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

const base: OpportunityFilters = {
  search: "",
  status: "",
  source: "",
  remoteOnly: false,
  highPriorityOnly: false,
};

describe("filterOpportunities", () => {
  it("preserves full-record search semantics", () => {
    const item = app();
    for (const search of [
      "acme",
      "platform",
      "referr",
      "migration",
      "jordan",
    ]) {
      expect(filterOpportunities([item], { ...base, search })).toEqual([item]);
    }
  });

  it("combines exact status, normalized source category, remote and Triage 4–5 predicates", () => {
    const item = app();
    expect(
      filterOpportunities([item], {
        ...base,
        status: "interview",
        source: "referral",
        remoteOnly: true,
        highPriorityOnly: true,
      }),
    ).toEqual([item]);
    const imported = app({ source: "LinkedIn Recruiter import" });
    expect(
      filterOpportunities([imported], { ...base, source: "linkedin" }),
    ).toEqual([imported]);
    expect(
      filterOpportunities([imported], {
        ...base,
        source: "LinkedIn Recruiter import",
      }),
    ).toEqual([]);
    expect(
      filterOpportunities([app({ triageQuality: 3 })], {
        ...base,
        highPriorityOnly: true,
      }),
    ).toEqual([]);
  });
});
