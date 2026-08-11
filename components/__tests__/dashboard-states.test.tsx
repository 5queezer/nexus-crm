// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
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

vi.mock("../ai-operator/ai-operator", () => ({
  AiOperator: () => null,
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

  function overdueApplication(id: string, company: string): Application {
    return {
      id,
      company,
      role: "Engineer",
      status: "interview",
      appliedAt: null,
      lastContact: null,
      followUpAt: "2020-01-01",
      notes: null,
      jobDescription: null,
      source: "linkedin",
      remote: true,
      salaryMin: null,
      salaryMax: null,
      rating: 5,
      jobUrl: null,
      resumeId: null,
      companySize: null,
      salaryBandMentioned: false,
      triageQuality: 5,
      triageReason: null,
      incomingSource: null,
      autoRejected: false,
      autoRejectReason: null,
      archivedAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
  }

  async function renderDashboardWith(applications: Application[]) {
    localStorage.setItem("onboarding-complete", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => applications }),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
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
  }

  it("gives dismiss-all an accessible 48px target", async () => {
    await renderDashboardWith([overdueApplication("overdue-1", "Nexus")]);

    const dismissAll = container.querySelector<HTMLButtonElement>(
      'button[aria-label="dismiss_all_overdue"]',
    );
    expect(dismissAll?.className).toContain("nexus-target");
  });

  it("gives each expanded dismiss button an accessible 48px target", async () => {
    await renderDashboardWith([
      overdueApplication("overdue-1", "Bending Spoons"),
      overdueApplication("overdue-2", "Quadrivia"),
    ]);

    const banner = container
      .querySelector<HTMLButtonElement>('button[aria-label="dismiss_all_overdue"]')
      ?.parentElement?.parentElement;
    await act(async () =>
      banner?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click(),
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    const dismissButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="dismiss_overdue"]',
    );
    expect(dismissButtons.length).toBe(2);
    dismissButtons.forEach((button) =>
      expect(button.className).toContain("nexus-target"),
    );
  });

  it("renders one summary banner instead of one banner per follow-up", async () => {
    await renderDashboardWith([
      overdueApplication("overdue-1", "Bending Spoons"),
      overdueApplication("overdue-2", "Quadrivia"),
      overdueApplication("overdue-3", "Pearson"),
    ]);

    expect(
      container.querySelectorAll('button[aria-label="dismiss_all_overdue"]')
        .length,
    ).toBe(1);
    const detailsId = container
      .querySelector<HTMLButtonElement>('button[aria-label="dismiss_all_overdue"]')
      ?.parentElement?.parentElement
      ?.querySelector<HTMLButtonElement>("button[aria-expanded]")
      ?.getAttribute("aria-controls");
    expect(detailsId).toBeTruthy();
    expect(document.getElementById(detailsId!)?.hasAttribute("hidden")).toBe(true);
  });

  it("dismisses every overdue follow-up at once", async () => {
    await renderDashboardWith([
      overdueApplication("overdue-1", "Bending Spoons"),
      overdueApplication("overdue-2", "Quadrivia"),
    ]);

    const dismissAll = container.querySelector<HTMLButtonElement>(
      'button[aria-label="dismiss_all_overdue"]',
    );
    await act(async () => dismissAll?.click());

    expect(
      container.querySelector('button[aria-label="dismiss_all_overdue"]'),
    ).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("dismissed-overdue") ?? "[]"),
    ).toEqual(["overdue-1:2020-01-01", "overdue-2:2020-01-01"]);
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
