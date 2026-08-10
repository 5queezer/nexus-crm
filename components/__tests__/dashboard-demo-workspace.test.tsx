// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { Dashboard } from "../dashboard";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("../ai-operator/ai-operator", () => ({ AiOperator: () => null }));

function application(id: string, isDemo: boolean, status: Application["status"]): Application {
  return {
    id,
    company: isDemo ? "Demo Company" : "Real Company",
    role: "Engineer",
    status,
    appliedAt: null,
    lastContact: null,
    followUpAt: null,
    notes: null,
    jobDescription: null,
    source: "linkedin",
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
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    isDemo,
  };
}

function renderDashboard(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  isAdmin = false,
) {
  return render(
    <QueryClientProvider client={client}>
      <Dashboard
        user={{ id: "user-1", email: "user@example.com", isAdmin }}
        shareUrl="https://example.com/share"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  const values = new Map<string, string>([["onboarding-complete", "true"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Dashboard demo workspace ownership", () => {
  it("creates a demo from the true-empty state and refreshes applications", async () => {
    let applications: Application[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        applications = [application("demo", true, "interview")];
        return { ok: true, json: async () => ({ created: true }) } as Response;
      }
      if (_input === "/api/demo-workspace") {
        const hasDemoWorkspace = applications.some((item) => item.isDemo);
        return { ok: true, json: async () => ({
          hasDemoWorkspace,
          canCreateDemoWorkspace: applications.length === 0,
        }) } as Response;
      }
      return { ok: true, json: async () => applications } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole("button", { name: "focus.create_demo" }));

    await waitFor(() => expect(screen.getByText("dashboard.demo_banner_title")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/demo-workspace", { method: "POST" });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/applications")).toHaveLength(2);
  });

  it("shows zero regular metrics for demo-only rows and removes demos after confirmation", async () => {
    const demo = application("demo", true, "offer");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return { ok: true, json: async () => ({ deleted: 1 }) } as Response;
      if (input === "/api/demo-workspace") {
        return { ok: true, json: async () => ({ hasDemoWorkspace: true, canCreateDemoWorkspace: false }) } as Response;
      }
      return { ok: true, json: async () => [demo] } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderDashboard();

    const banner = await screen.findByRole("status", { name: "dashboard.demo_banner_title" });
    const totalMetric = screen.getByText("stats.total").parentElement;
    expect(totalMetric?.textContent).toContain("0");
    expect(screen.getByText("Demo Company")).toBeTruthy();

    await user.click(within(banner).getByRole("button", { name: "dashboard.remove_demo" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/demo-workspace", { method: "DELETE" }),
    );
    expect(confirm).toHaveBeenCalledWith("confirm.remove_demo");
  });

  it("does not allow ordinary deletion of a demo row or hide its workspace banner", async () => {
    const demo = application("demo", true, "interview");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => input === "/api/demo-workspace"
      ? { ok: true, json: async () => ({ hasDemoWorkspace: true, canCreateDemoWorkspace: false }) } as Response
      : { ok: true, json: async () => [demo] } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderDashboard();

    const banner = await screen.findByRole("status", { name: "dashboard.demo_banner_title" });
    await user.click(screen.getByRole("button", {
      name: "actions.opportunity_actions",
    }));
    await user.click(await screen.findByRole("menuitem", { name: "actions.delete" }));

    expect(confirm).not.toHaveBeenCalledWith("confirm.delete");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/applications/demo", { method: "DELETE" });
    expect(banner.isConnected).toBe(true);
    expect(within(banner).getByRole("button", { name: "dashboard.remove_demo" })).toBeTruthy();
  });

  it("does not bulk-delete a selected demo row or hide its workspace banner", async () => {
    const demo = application("demo", true, "interview");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => input === "/api/demo-workspace"
      ? { ok: true, json: async () => ({ hasDemoWorkspace: true, canCreateDemoWorkspace: false }) } as Response
      : { ok: true, json: async () => [demo] } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderDashboard();

    const banner = await screen.findByRole("status", { name: "dashboard.demo_banner_title" });
    await user.click(screen.getByRole("button", {
      name: "actions.opportunity_actions",
    }));
    await user.click(await screen.findByRole("menuitem", { name: "focus.select_action" }));
    await user.click(await screen.findByRole("button", { name: "bulk_actions.delete_selected" }));

    expect(confirm).not.toHaveBeenCalledWith("confirm.bulk_delete_confirm");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/applications/demo", { method: "DELETE" });
    expect(banner.isConnected).toBe(true);
    expect(within(banner).getByRole("button", { name: "dashboard.remove_demo" })).toBeTruthy();
  });

  it("does not offer demo creation when the owner has only archived real applications", async () => {
    const archived = {
      ...application("archived", false, "rejected"),
      archivedAt: "2026-08-09T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => input === "/api/demo-workspace"
      ? { ok: true, json: async () => ({ hasDemoWorkspace: false, canCreateDemoWorkspace: false }) } as Response
      : { ok: true, json: async () => [archived] } as Response));

    renderDashboard();

    await screen.findByText("focus.true_empty_title");
    expect(screen.queryByRole("button", { name: "focus.create_demo" })).toBeNull();
  });

  it("does not show another tenant's demo-removal banner to an administrator", async () => {
    const otherTenantDemo = application("other-demo", true, "interview");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => input === "/api/demo-workspace"
      ? { ok: true, json: async () => ({ hasDemoWorkspace: false, canCreateDemoWorkspace: true }) } as Response
      : { ok: true, json: async () => [otherTenantDemo] } as Response));

    renderDashboard(undefined, true);

    await screen.findByText("Demo Company");
    expect(screen.queryByRole("status", { name: "dashboard.demo_banner_title" })).toBeNull();
  });

  it("refreshes demo eligibility after deleting the final real application", async () => {
    let applications = [application("real", false, "interview")];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/applications/real" && init?.method === "DELETE") {
        applications = [];
        return { ok: true } as Response;
      }
      if (input === "/api/demo-workspace") {
        return { ok: true, json: async () => ({
          hasDemoWorkspace: false,
          canCreateDemoWorkspace: applications.length === 0,
        }) } as Response;
      }
      return { ok: true, json: async () => applications } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByRole("button", { name: "actions.opportunity_actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "actions.delete" }));

    expect(await screen.findByRole("button", { name: "focus.create_demo" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/demo-workspace")).toHaveLength(2);
  });
});
