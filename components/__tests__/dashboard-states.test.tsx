// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	Dashboard,
	DashboardErrorState,
	DashboardLoadingState,
} from "../dashboard";

vi.mock("next-intl", () => ({
	useLocale: () => "en",
	useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: { signOut: vi.fn() },
}));

describe("Dashboard data states", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		localStorage.clear();
		vi.stubGlobal(
			"matchMedia",
			vi.fn().mockImplementation(() => ({
				matches: true,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		);
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await act(async () => root.unmount());
		document.body.replaceChildren();
	});

	it("announces loading without workspace chrome", async () => {
		await act(async () => {
			root.render(<DashboardLoadingState message="Loading opportunities" />);
		});

		const state = container.querySelector('[role="status"]');
		expect(state?.textContent).toContain("Loading opportunities");
		expect(state?.getAttribute("aria-live")).toBe("polite");
		expect(container.textContent).not.toContain("All filters");
	});

	it("shows a retryable request error instead of incomplete onboarding", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: false });
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		await act(async () => {
			root.render(
				<QueryClientProvider client={queryClient}>
					<Dashboard
						user={{
							id: "user-1",
							name: "Chris",
							email: "chris@example.com",
							isAdmin: false,
						}}
						shareUrl="https://example.com/share"
					/>
				</QueryClientProvider>,
			);
		});
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

		const alert = container.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain("loading_error");
		expect(container.textContent).not.toContain("welcome_title");

		await act(async () =>
			alert?.querySelector<HTMLButtonElement>("button")?.click(),
		);
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("announces an error and exposes retry recovery", async () => {
		const onRetry = vi.fn();
		await act(async () => {
			root.render(
				<DashboardErrorState
					message="Could not load"
					retryLabel="Try again"
					onRetry={onRetry}
				/>,
			);
		});

		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Could not load",
		);
		await act(async () =>
			container.querySelector<HTMLButtonElement>("button")?.click(),
		);
		expect(onRetry).toHaveBeenCalledOnce();
	});
});
