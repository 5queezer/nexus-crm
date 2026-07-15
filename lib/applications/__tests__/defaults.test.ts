import { describe, expect, it } from "vitest";
import {
	resolveAppliedAtForCreate,
	toDateInputValue,
} from "../defaults";

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

	it("rejects invalid explicit appliedAt values", () => {
		expect(() => resolveAppliedAtForCreate("applied", "not-a-date", now)).toThrow(
			"appliedAt_invalid",
		);
		expect(() =>
			resolveAppliedAtForCreate("applied", new Date("invalid"), now),
		).toThrow("appliedAt_invalid");
	});

	it("formats the user's local calendar day for date inputs", () => {
		const localLateEvening = new Date(2026, 6, 14, 23, 30);
		expect(toDateInputValue(localLateEvening)).toBe("2026-07-14");
	});
});
