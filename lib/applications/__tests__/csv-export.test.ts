import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const FORMULA_MARKERS = ["=", "+", "-", "@"];
const EXCEL_LEADING_CHARACTERS = [" ", "\t", "\r", "\n"];
const PREFIXED_FORMULAS = EXCEL_LEADING_CHARACTERS.flatMap((prefix) =>
  FORMULA_MARKERS.map((marker) => `${prefix}${marker}payload`),
);

describe("CSV export dates", () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });

  afterAll(() => {
    if (originalTimezone === undefined) {
      Reflect.deleteProperty(process.env, "TZ");
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  it("preserves valid date-only leap days and calendar boundaries in a negative timezone", () => {
    const csv = applicationsToCsv([
      application({
        appliedAt: "2024-02-29",
        lastContact: "2026-01-01",
        followUpAt: "2026-12-31T00:00:00.000Z",
      }),
    ]);

    expect(csv.split("\n")[1]).toContain(
      '"2024-02-29","2026-01-01","2026-12-31"',
    );
  });

  it("formats valid timestamps according to their local calendar day", () => {
    const csv = applicationsToCsv([
      application({
        appliedAt: "2024-03-01T07:30:00.000Z",
        lastContact: "2024-03-01T08:30:00.000Z",
        followUpAt: "2026-01-01T00:30:00-08:00",
      }),
    ]);

    expect(csv.split("\n")[1]).toContain(
      '"2024-02-29","2024-03-01","2026-01-01"',
    );
  });

  it("exports missing, malformed, and impossible dates as empty cells", () => {
    const csv = applicationsToCsv([
      application({
        appliedAt: null,
        lastContact: "not-a-date",
        followUpAt: "2026-02-29",
      }),
    ]);

    expect(csv.split("\n")[1]).toContain('"","","","Normal notes"');
  });

  it("exports impossible timestamp date prefixes as empty cells", () => {
    const csv = applicationsToCsv([
      application({
        appliedAt: "2026-02-29T12:00:00.000Z",
        lastContact: "2026-04-31T08:00:00-07:00",
        followUpAt: "2026-02-31T00:00:00.000Z",
      }),
    ]);

    expect(csv.split("\n")[1]).toContain('"","","","Normal notes"');
  });
});

describe("CSV export safety", () => {
  it.each([...FORMULA_MARKERS.map((marker) => `${marker}payload`), ...PREFIXED_FORMULAS])(
    "neutralizes formula-capable cell %j before quote escaping",
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`);
    },
  );

  it("escapes quotes and preserves separators and normal values", () => {
    expect(escapeCsvCell('Normal, "quoted" value')).toBe(
      '"Normal, ""quoted"" value"',
    );
    expect(escapeCsvCell("plain text")).toBe('"plain text"');
    expect(escapeCsvCell("12345")).toBe('"12345"');
  });

  it("neutralizes exported fields and safely normalizes every notes line ending", () => {
    const csv = applicationsToCsv([
      application({
        company: ' \t=HYPERLINK("https://evil.example")',
        role: "\r+SUM(1,2)",
        source: "\n-1+2",
        notes: "\r\n@IMPORTXML(example)\rnext\nlast, \"quoted\"",
      }),
      application({ id: "normal", company: "Normal Co", role: "Designer" }),
    ]);

    expect(csv).toContain('"\' \t=HYPERLINK(""https://evil.example"")"');
    expect(csv).toContain('"\'\r+SUM(1,2)"');
    expect(csv).toContain('"\'\n-1+2"');
    expect(csv).toContain(
      '"\' @IMPORTXML(example) next last, ""quoted"""',
    );
    expect(csv).toContain('"Normal Co","Designer","applied","Referral"');
  });
});
