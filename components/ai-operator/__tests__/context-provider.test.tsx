// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	AssistantContextProvider,
	ASSISTANT_CONTEXT_EVENT,
	useAssistantContext,
} from "../context";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

function Probe() {
	const context = useAssistantContext();
	return <output>{JSON.stringify(context)}</output>;
}

describe("AssistantContextProvider", () => {
	it("merges validated page context events and preserves omitted selection", () => {
		render(
			<AssistantContextProvider>
				<Probe />
			</AssistantContextProvider>,
		);
		act(() => {
			window.dispatchEvent(
				new CustomEvent(ASSISTANT_CONTEXT_EVENT, {
					detail: { selectedIds: ["application-1"], route: "/" },
				}),
			);
			window.dispatchEvent(
				new CustomEvent(ASSISTANT_CONTEXT_EVENT, {
					detail: { filters: { query: "platform" }, visibleCount: 7 },
				}),
			);
		});

		expect(screen.getByRole("status").textContent).toContain("application-1");
		expect(screen.getByRole("status").textContent).toContain("platform");
	});

	it("ignores unbounded or secret-shaped context updates", () => {
		render(
			<AssistantContextProvider>
				<Probe />
			</AssistantContextProvider>,
		);
		act(() => {
			window.dispatchEvent(
				new CustomEvent(ASSISTANT_CONTEXT_EVENT, {
					detail: { credentials: { apiKey: "secret" } },
				}),
			);
		});
		expect(screen.getByRole("status").textContent).not.toContain("secret");
	});
});
