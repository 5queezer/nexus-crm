// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpportunityFilterControls } from "../opportunity-filter-controls";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

describe("OpportunityFilterControls compact targets", () => {
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

	it("gives removable filter chips a 48 by 48 control", async () => {
		await act(async () => {
			root.render(
				<OpportunityFilterControls
					filters={{
						search: "",
						status: "interview",
						source: "",
						remoteOnly: false,
						highPriorityOnly: false,
					}}
					sources={[]}
					resultCount={1}
					onChange={vi.fn()}
					onClear={vi.fn()}
				/>,
			);
		});

		const remove = container.querySelector<HTMLButtonElement>(
			'button[aria-label="remove_filter"]',
		);
		expect(remove?.className).toContain("h-12");
		expect(remove?.className).toContain("w-12");
	});
});
