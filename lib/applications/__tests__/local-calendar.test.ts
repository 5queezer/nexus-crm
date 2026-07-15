import { describe, expect, it } from "vitest";
import { parseLocalCalendarDate } from "../local-calendar";

describe("parseLocalCalendarDate validation", () => {
  it("accepts real leap days and calendar boundaries", () => {
    const leapDay = parseLocalCalendarDate("2024-02-29");
    expect(leapDay?.getFullYear()).toBe(2024);
    expect(leapDay?.getMonth()).toBe(1);
    expect(leapDay?.getDate()).toBe(29);
    expect(parseLocalCalendarDate("2026-01-01")).not.toBeNull();
    expect(parseLocalCalendarDate("2026-12-31T00:00:00.000Z")).not.toBeNull();
  });

  it.each([
    "2026-02-29",
    "2026-02-31",
    "2026-04-31",
    "2026-00-10",
    "2026-13-10",
    "2026-01-00",
  ])("rejects impossible calendar date %s", (value) => {
    expect(parseLocalCalendarDate(value)).toBeNull();
  });
});
