// @vitest-environment happy-dom

import type { Application, ApplicationStatus } from "@/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationTable } from "../application-table";

vi.mock("next-intl", () => ({
	useLocale: () => "en",
	useTranslations: () => (key: string) => key,
}));

function application(id: string, status: ApplicationStatus): Application {
	return {
		id,
		company: `Company ${id}`,
		role: "Engineer",
		status,
		appliedAt: "2026-07-01T00:00:00.000Z",
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
		createdAt: "2026-07-01T00:00:00.000Z",
		updatedAt: "2026-07-01T00:00:00.000Z",
	};
}

describe("ApplicationTable bulk selection and compact targets", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		document.body.replaceChildren();
	});

	it("uses 48px pagination targets", async () => {
		await act(async () => {
			root.render(
				<ApplicationTable
					applications={Array.from({ length: 11 }, (_, index) =>
						application(String(index), "interview"),
					)}
					onEdit={vi.fn()}
					onDelete={vi.fn()}
				/>,
			);
		});

		const paginationButtons = Array.from(
			container.querySelectorAll("button"),
		).filter((button) =>
			["«", "‹", "1", "2", "›", "»"].includes(button.textContent ?? ""),
		);
		expect(paginationButtons.length).toBeGreaterThan(0);
		for (const button of paginationButtons) {
			expect(button.className).toContain("min-h-12");
			expect(button.className).toContain("min-w-12");
		}
	});

	it("selects only applications matching the active status filter", async () => {
		const lost = application("lost", "rejected");
		const active = application("active", "interview");
		const onSelectAll = vi.fn();

		await act(async () => {
			root.render(
				<ApplicationTable
					applications={[lost, active]}
					onEdit={vi.fn()}
					onDelete={vi.fn()}
					initialStatusFilter="rejected"
					selectedIds={new Set()}
					onToggleSelect={vi.fn()}
					onSelectAll={onSelectAll}
					onClearSelection={vi.fn()}
				/>,
			);
		});

		const selectAll = container.querySelector<HTMLInputElement>(
			'thead input[type="checkbox"]',
		);
		if (!selectAll) throw new Error("Select-all checkbox was not rendered");

		await act(async () => selectAll.click());

		expect(onSelectAll).toHaveBeenCalledOnce();
		expect(onSelectAll).toHaveBeenCalledWith([lost]);
	});
});
