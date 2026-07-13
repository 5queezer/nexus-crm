import { describe, expect, it } from "vitest";
import { resolveAppliedAtForCreate, toDateInputValue } from "../defaults";

describe("opportunity creation defaults", () => {
  const now = new Date("2026-06-30T08:00:00.000Z");

  it("keeps appliedAt empty for a new inbound lead", () => {
    expect(resolveAppliedAtForCreate("inbound", undefined, now)).toBeNull();
    expect(resolveAppliedAtForCreate("inbound", null, now)).toBeNull();
    expect(resolveAppliedAtForCreate("inbound", "", now)).toBeNull();
  });

  it("auto-fills appliedAt only for an explicitly applied-or-later status", () => {
    expect(resolveAppliedAtForCreate("applied", undefined, now)).toEqual(now);
    expect(resolveAppliedAtForCreate("interview", undefined, now)).toEqual(now);
    expect(resolveAppliedAtForCreate("offer", undefined, now)).toEqual(now);
    expect(resolveAppliedAtForCreate("rejected", undefined, now)).toEqual(now);
  });

  it("preserves an explicit appliedAt value", () => {
    expect(resolveAppliedAtForCreate("inbound", "2026-05-04", now)).toEqual(
      new Date("2026-05-04"),
    );
  });

  it("formats a date for date inputs", () => {
    expect(toDateInputValue(new Date("2026-06-30T12:34:56.000Z"))).toBe("2026-06-30");
  });
});
