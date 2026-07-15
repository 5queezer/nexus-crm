import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseLocalCalendarDate } from "../local-calendar";

describe("parseLocalCalendarDate validation", () => {
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

  it("accepts real leap days and calendar boundaries", () => {
    const leapDay = parseLocalCalendarDate("2024-02-29");
    expect(leapDay?.getFullYear()).toBe(2024);
    expect(leapDay?.getMonth()).toBe(1);
    expect(leapDay?.getDate()).toBe(29);
    expect(parseLocalCalendarDate("2026-01-01")).not.toBeNull();
    expect(parseLocalCalendarDate("2026-12-31T00:00:00.000Z")).not.toBeNull();
  });

  it("preserves instant semantics for timestamps and supports native non-ISO dates", () => {
    const utcTimestamp = "2024-03-01T07:30:00.000Z";
    const offsetTimestamp = "2026-01-01T00:30:00-08:00";
    const nonIsoTimestamp = "March 1, 2026 12:00:00";

    expect(parseLocalCalendarDate(utcTimestamp)?.getTime()).toBe(
      new Date(utcTimestamp).getTime(),
    );
    expect(parseLocalCalendarDate(offsetTimestamp)?.getTime()).toBe(
      new Date(offsetTimestamp).getTime(),
    );
    expect(parseLocalCalendarDate(nonIsoTimestamp)?.getTime()).toBe(
      new Date(nonIsoTimestamp).getTime(),
    );
  });

  it.each([
    "2026-02-29",
    "2026-02-31",
    "2026-04-31",
    "2026-00-10",
    "2026-13-10",
    "2026-01-00",
    "2026-02-29T12:00:00.000Z",
    "2026-04-31T08:00:00-07:00",
  ])("rejects impossible calendar date prefix %s", (value) => {
    expect(parseLocalCalendarDate(value)).toBeNull();
  });
});
