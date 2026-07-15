import { describe, expect, it } from "vitest";
import type { Application } from "@/types";
import { buildFocusQueue } from "../focus-queue";
import { formatLocalCalendarDate } from "../local-calendar";

function app(id: string, overrides: Partial<Application> = {}): Application {
	return {
		id,
		company: id,
		role: "Role",
		status: "inbound",
		appliedAt: null,
		lastContact: null,
		followUpAt: null,
		notes: null,
		jobDescription: null,
		source: null,
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
		createdAt: "2026-06-01T12:00:00.000Z",
		updatedAt: "2026-06-01T12:00:00.000Z",
		...overrides,
	};
}

describe("buildFocusQueue", () => {
	it("applies precedence once and deterministic ordering", () => {
		const now = new Date(2026, 6, 14, 12);
		const queue = buildFocusQueue(
			[
				app("recent-b", { updatedAt: "2026-06-10T12:00:00.000Z" }),
				app("priority", {
					triageQuality: 5,
					followUpAt: "2026-07-16T12:00:00.000Z",
				}),
				app("overdue", {
					triageQuality: 5,
					followUpAt: "2026-07-12T12:00:00.000Z",
				}),
				app("soon", { followUpAt: "2026-07-15T12:00:00.000Z" }),
				app("new", { createdAt: "2026-07-13T12:00:00.000Z" }),
				app("recent-a", { updatedAt: "2026-06-10T12:00:00.000Z" }),
			],
			now,
		);

		expect(queue.map((group) => group.id)).toEqual([
			"overdue",
			"highPriority",
			"dueSoon",
			"newThisWeek",
			"recent",
		]);
		const ids = queue.flatMap((group) =>
			group.applications.map((item) => item.id),
		);
		expect(ids).toEqual([
			"overdue",
			"priority",
			"soon",
			"new",
			"recent-a",
			"recent-b",
		]);
		expect(new Set(ids).size).toBe(6);
	});

	it("keeps UTC-midnight API serialization on the intended local day in negative offsets", () => {
		const now = new Date(2026, 6, 14, 12);
		const serializedDateOnly = "2026-07-14T00:00:00.000Z";
		const queue = buildFocusQueue(
			[app("today", { followUpAt: serializedDateOnly })],
			now,
		);

		expect(queue[0]?.id).toBe("dueSoon");
		expect(formatLocalCalendarDate(serializedDateOnly, "en-US")).toContain(
			"Jul 14, 2026",
		);
	});

	it("treats today and seven days ahead as due soon in the local calendar", () => {
		const now = new Date(2026, 6, 14, 18);
		const queue = buildFocusQueue(
			[
				app("today", { followUpAt: new Date(2026, 6, 14, 1).toISOString() }),
				app("seventh", { followUpAt: new Date(2026, 6, 21, 23).toISOString() }),
				app("eighth", { followUpAt: new Date(2026, 6, 22, 0).toISOString() }),
			],
			now,
		);
		expect(
			queue
				.find((group) => group.id === "dueSoon")
				?.applications.map((item) => item.id),
		).toEqual(["today", "seventh"]);
		expect(
			queue
				.find((group) => group.id === "recent")
				?.applications.map((item) => item.id),
		).toEqual(["eighth"]);
	});
});
