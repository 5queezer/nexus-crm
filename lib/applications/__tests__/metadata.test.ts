import { describe, expect, it } from "vitest";
import { parseStructuredApplicationMetadata } from "../metadata";

describe("parseStructuredApplicationMetadata", () => {
  it("normalizes structured metadata and derives a canonical job URL", () => {
    expect(
      parseStructuredApplicationMetadata({
        jobUrl: "https://Jobs.Example.com/roles/1/?utm_source=mail",
        workMode: "remote",
        eligibleCountries: ["es", "DE", "es"],
        salaryCurrency: "eur",
        salaryPeriod: "year",
        officeDaysMin: 0,
        jobCapturedAt: "2026-07-13T08:00:00.000Z",
      }),
    ).toMatchObject({
      canonicalJobUrl: "https://jobs.example.com/roles/1",
      workMode: "remote",
      eligibleCountries: ["ES", "DE"],
      salaryCurrency: "EUR",
      salaryPeriod: "year",
      officeDaysMin: 0,
      jobCapturedAt: new Date("2026-07-13T08:00:00.000Z"),
    });
  });

  it("rejects invalid enums, ranges, countries, dates, currency, hashes, and URLs", () => {
    expect(() => parseStructuredApplicationMetadata({ workMode: "sometimes" })).toThrow(/workMode/);
    expect(() => parseStructuredApplicationMetadata({ travelPercent: 101 })).toThrow(/travelPercent/);
    expect(() => parseStructuredApplicationMetadata({ eligibleCountries: ["Spain"] })).toThrow(/eligibleCountries/);
    expect(() => parseStructuredApplicationMetadata({ jobCapturedAt: "not-a-date" })).toThrow(/jobCapturedAt/);
    expect(() => parseStructuredApplicationMetadata({ salaryCurrency: "EU" })).toThrow(/salaryCurrency/);
    expect(() => parseStructuredApplicationMetadata({ jobContentHash: "not-a-sha256" })).toThrow(/jobContentHash/);
    expect(() => parseStructuredApplicationMetadata({ jobUrl: "javascript:alert(1)" })).toThrow(/http or https/);
  });
});
