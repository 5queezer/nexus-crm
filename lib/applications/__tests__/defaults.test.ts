import { describe, expect, it } from "vitest";
import { resolveCreatedAtForCreate, toDateInputValue } from "../defaults";

describe("opportunity creation defaults", () => {
	it("auto-fills the created-at/applied-at date when creation omits it", () => {
		const now = new Date("2026-06-30T08:00:00.000Z");

		expect(resolveCreatedAtForCreate(undefined, now)).toEqual(now);
		expect(resolveCreatedAtForCreate(null, now)).toEqual(now);
		expect(resolveCreatedAtForCreate("", now)).toEqual(now);
	});

	it("preserves an explicit created-at/applied-at value", () => {
		expect(
			resolveCreatedAtForCreate("2026-05-04", new Date("2026-06-30")),
		).toEqual(new Date("2026-05-04"));
	});

	it("formats the user's local calendar day for date inputs", () => {
		const localLateEvening = new Date(2026, 6, 14, 23, 30);
		expect(toDateInputValue(localLateEvening)).toBe("2026-07-14");
	});
});
