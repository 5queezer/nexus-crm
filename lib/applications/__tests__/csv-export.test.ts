import { describe, expect, it } from "vitest";
import type { Application } from "@/types";
import { applicationsToCsv, escapeCsvCell } from "../csv-export";

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "application-1",
    company: "Acme",
    role: "Engineer",
    status: "applied",
    appliedAt: null,
    lastContact: null,
    followUpAt: null,
    notes: "Normal notes",
    jobDescription: null,
    source: "Referral",
    remote: false,
    salaryMin: null,
    salaryMax: null,
    rating: null,
    jobUrl: null,
    resumeId: null,
    companySize: null,
    salaryBandMentioned: false,
    triageQuality: null,
    triageReason: null,
    incomingSource: null,
    autoRejected: false,
    autoRejectReason: null,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("CSV export safety", () => {
  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@cmd"]) (
    "neutralizes formula-leading cell %s before quote escaping",
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`);
    },
  );

  it("neutralizes malicious company, role, source, and notes while preserving normal cells", () => {
    const csv = applicationsToCsv([
      application({
        company: '=HYPERLINK("https://evil.example")',
        role: "+SUM(1,2)",
        source: "-1+2",
        notes: "@IMPORTXML(example)",
      }),
      application({ id: "normal", company: "Normal Co", role: "Designer" }),
    ]);

    expect(csv).toContain('"\'=HYPERLINK(""https://evil.example"")"');
    expect(csv).toContain('"\'+SUM(1,2)"');
    expect(csv).toContain('"\'-1+2"');
    expect(csv).toContain('"\'@IMPORTXML(example)"');
    expect(csv).toContain('"Normal Co","Designer","applied","Referral"');
  });
});
