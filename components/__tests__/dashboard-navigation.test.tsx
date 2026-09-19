// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import type { OpportunityFilters } from "@/lib/applications/opportunity-filters";
import { Dashboard } from "../dashboard";

const { pushMock, captured } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  captured: {
    table: {} as { onEdit?: (app: Application) => void },
    palette: {} as { onSelect?: (app: Application) => void },
    modal: {} as { onCreated?: (app: Application) => void },
  },
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

vi.mock("../app-header", () => ({ AppHeader: () => null }));
vi.mock("../app-settings", () => ({
  loadAppSettings: () => ({ appTitle: "" }),
}));
vi.mock("../application-table", () => ({
  ApplicationTable: (props: { onEdit?: (app: Application) => void }) => {
    captured.table = props;
    return <div>table-view</div>;
  },
}));
vi.mock("../command-palette", () => ({
  CommandPalette: (props: { onSelect?: (app: Application) => void }) => {
    captured.palette = props;
    return <div>command-palette</div>;
  },
}));
vi.mock("../application-modal", () => ({
  ApplicationModal: (props: { onCreated?: (app: Application) => void }) => {
    captured.modal = props;
    return null;
  },
}));
vi.mock("../kanban-view", () => ({ KanbanView: () => null }));
vi.mock("../focus-queue", () => ({ FocusQueue: () => null }));
vi.mock("../keyboard-shortcut-bar", () => ({
  KeyboardShortcutBar: () => null,
}));
vi.mock("../keyboard-shortcut-dialog", () => ({
  KeyboardShortcutDialog: () => null,
}));
vi.mock("../bulk-action-bar", () => ({ BulkActionBar: () => null }));
vi.mock("../onboarding-wizard", () => ({ OnboardingWizard: () => null }));
vi.mock("../action-menu", () => ({ ActionMenu: () => null }));
vi.mock("../workspace-toolbar", () => ({ WorkspaceToolbar: () => null }));
vi.mock("../opportunity-filter-controls", () => ({
  OpportunityFilterControls: ({ filters, onChange }: { filters: OpportunityFilters; onChange: (filters: OpportunityFilters) => void }) => (
    <input aria-label="Search opportunities" value={filters.search} onChange={event => onChange({ ...filters, search: event.target.value })} />
  ),
}));
vi.mock("../ai-operator/ai-operator", () => ({ AiOperator: () => null }));

const application: Application = {
  id: "application-1",
  company: "Acme",
  role: "Engineer",
  status: "applied",
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
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

async function renderDashboard() {
  window.history.replaceState(null, "", "/?view=table");
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
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
  await waitFor(() => expect(captured.table.onEdit).toBeTypeOf("function"));
  return user;
}

describe("Dashboard detail navigation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    pushMock.mockClear();
    captured.table = {};
    captured.palette = {};
    captured.modal = {};
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    localStorage.setItem("onboarding-complete", "true");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/applications")) {
          return { ok: true, json: async () => [application] } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pushes the detail route when the table asks to edit an application", async () => {
    await renderDashboard();

    act(() => captured.table.onEdit?.(application));

    expect(pushMock).toHaveBeenCalledWith("/applications/application-1/acme-engineer");
  });

  it("replaces live search changes instead of adding a history entry per character", async () => {
    const user = await renderDashboard();
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");

    await user.type(await screen.findByRole("textbox", { name: "Search opportunities" }), "Acme");

    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(4);
    expect(new URLSearchParams(window.location.search).get("search")).toBe("Acme");
    expect(new URLSearchParams(window.location.search).get("view")).toBe("table");
  });

  it("pushes the detail route when the command palette selects an application", async () => {
    const user = await renderDashboard();

    await user.keyboard("/");
    await waitFor(() =>
      expect(captured.palette.onSelect).toBeTypeOf("function"),
    );
    act(() => captured.palette.onSelect?.(application));

    expect(pushMock).toHaveBeenCalledWith("/applications/application-1/acme-engineer");
  });

  it("pushes the new detail route once the quick-create modal reports success", async () => {
    const user = await renderDashboard();

    await user.keyboard("n");
    await waitFor(() =>
      expect(captured.modal.onCreated).toBeTypeOf("function"),
    );
    act(() => captured.modal.onCreated?.({
      ...application,
      id: "new-id",
      company: "Newco",
    }));

    expect(pushMock).toHaveBeenCalledWith("/applications/new-id/newco-engineer");
  });
});
