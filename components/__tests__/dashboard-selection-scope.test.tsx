// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpportunityFilters } from "@/lib/applications/opportunity-filters";
import type { Application, ApplicationStatus } from "@/types";
import { Dashboard } from "../dashboard";

function application(
  id: string,
  status: ApplicationStatus,
  archived = false,
): Application {
  return {
    id,
    company: `Company ${id}`,
    role: `Role ${id}`,
    status,
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
    archivedAt: archived ? "2026-07-14T00:00:00.000Z" : null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

const activeInterview = application("active-interview", "interview");
const activeApplied = application("active-applied", "applied");
const archivedRejected = application("archived-rejected", "rejected", true);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../app-header", () => ({ AppHeader: () => null }));
vi.mock("../app-settings", () => ({
  loadAppSettings: () => ({ appTitle: "" }),
}));
vi.mock("../application-modal", () => ({ ApplicationModal: () => null }));
vi.mock("../command-palette", () => ({ CommandPalette: () => null }));
vi.mock("../keyboard-shortcut-bar", () => ({ KeyboardShortcutBar: () => null }));
vi.mock("../keyboard-shortcut-dialog", () => ({
  KeyboardShortcutDialog: () => null,
}));
vi.mock("../onboarding-wizard", () => ({ OnboardingWizard: () => null }));
vi.mock("../ai-operator/ai-operator", () => ({ AiOperator: () => null }));
vi.mock("../action-menu", () => ({
  ActionMenu: ({
    items,
  }: {
    items: Array<{ id: string; onSelect?: () => void }>;
  }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={item.onSelect}>
          {item.id}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../workspace-toolbar", () => ({
  WorkspaceToolbar: ({
    viewMode,
    onViewModeChange,
    moreMenu,
  }: {
    viewMode: string;
    onViewModeChange: (view: "focus" | "table" | "kanban") => void;
    moreMenu: ReactNode;
  }) => (
    <div>
      <span>view-{viewMode}</span>
      {moreMenu}
      {(["focus", "table", "kanban"] as const).map((view) => (
        <button key={view} type="button" onClick={() => onViewModeChange(view)}>
          choose-{view}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../opportunity-filter-controls", () => ({
  OpportunityFilterControls: ({
    onChange,
  }: {
    onChange: (filters: OpportunityFilters) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          search: "",
          status: "interview",
          source: "",
          remoteOnly: false,
          highPriorityOnly: false,
        })
      }
    >
      filter-interview
    </button>
  ),
}));
vi.mock("../focus-queue", () => ({
  FocusQueue: ({
    applications,
    selectedIds,
    onToggleSelect,
    onArchive,
    onDelete,
  }: {
    applications: Application[];
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
    onArchive: (id: string, archive: boolean) => void;
    onDelete: (id: string) => void;
  }) => (
    <div>
      <span>focus-selected-{[...selectedIds].sort().join(",")}</span>
      {applications.map((item) => (
        <div key={item.id}>
          <button type="button" onClick={() => onToggleSelect(item.id)}>
            select-{item.id}
          </button>
          <button type="button" onClick={() => onArchive(item.id, true)}>
            archive-{item.id}
          </button>
          <button type="button" onClick={() => onDelete(item.id)}>
            delete-{item.id}
          </button>
        </div>
      ))}
    </div>
  ),
}));
vi.mock("../application-table", () => ({
  ApplicationTable: ({
    applications,
    selectedIds,
    onToggleSelect,
  }: {
    applications: Application[];
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
  }) => (
    <div>
      <span>table-selected-{[...selectedIds].sort().join(",")}</span>
      {applications.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onToggleSelect(item.id)}
        >
          select-{item.id}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../kanban-view", () => ({ KanbanView: () => <div>kanban-view</div> }));
vi.mock("../bulk-action-bar", () => ({
  BulkActionBar: ({
    selectedCount,
    hiddenSelectedCount,
    onChangeStatus,
    onArchive,
    onDelete,
  }: {
    selectedCount: number;
    hiddenSelectedCount: number;
    onChangeStatus: (status: ApplicationStatus) => void;
    onArchive: () => void;
    onDelete: () => void;
  }) =>
    selectedCount > 0 ? (
      <div>
        <span>bulk-count-{selectedCount}</span>
        <span>bulk-hidden-{hiddenSelectedCount}</span>
        <button type="button" onClick={() => onChangeStatus("offer")}>
          bulk-status
        </button>
        <button type="button" onClick={onArchive}>
          bulk-archive
        </button>
        <button type="button" onClick={onDelete}>
          bulk-delete
        </button>
      </div>
    ) : null,
}));

function renderDashboard(initialApplications: Application[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(JSON.stringify(initialApplications), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const id = String(input).split("/").pop() ?? "";
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const current = initialApplications.find((item) => item.id === id);
      return new Response(JSON.stringify({ ...current, ...body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  render(
    <QueryClientProvider client={queryClient}>
      <Dashboard
        user={{ id: "user-1", email: "user@example.com", isAdmin: false }}
        shareUrl="https://example.com/share"
      />
    </QueryClientProvider>,
  );
  return { fetchMock, queryClient };
}

describe("Dashboard dataset-scoped selection", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("onboarding-complete", "true");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("clears selection through the workspace menu in both archive directions", async () => {
    const user = userEvent.setup();
    renderDashboard([activeInterview, archivedRejected]);

    await user.click(
      await screen.findByRole("button", { name: "select-active-interview" }),
    );
    expect(screen.getByText("bulk-count-1")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "toggle-archive" }));
    expect(await screen.findByText("view-table")).toBeTruthy();
    expect(screen.queryByText("bulk-count-1")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "select-archived-rejected" }),
    );
    expect(screen.getByText("bulk-count-1")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "toggle-archive" }));
    expect(await screen.findByText("view-focus")).toBeTruthy();
    expect(screen.queryByText("bulk-count-1")).toBeNull();
  });

  it("returns from an empty archive through the centralized show-active entry point", async () => {
    const user = userEvent.setup();
    renderDashboard([activeInterview]);

    await user.click(
      await screen.findByRole("button", { name: "select-active-interview" }),
    );
    await user.click(screen.getByRole("button", { name: "toggle-archive" }));
    expect(await screen.findByText("archive_empty_title")).toBeTruthy();
    expect(screen.queryByText("bulk-count-1")).toBeNull();

    await user.click(screen.getByRole("button", { name: "show_active" }));
    expect(
      await screen.findByRole("button", { name: "select-active-interview" }),
    ).toBeTruthy();
    expect(screen.queryByText("bulk-count-1")).toBeNull();
  });

  it("preserves selection across Focus, Table, and Kanban presentation changes", async () => {
    const user = userEvent.setup();
    renderDashboard([activeInterview, activeApplied]);

    await user.click(
      await screen.findByRole("button", { name: "select-active-interview" }),
    );
    await user.click(screen.getByRole("button", { name: "choose-table" }));
    expect(
      await screen.findByText("table-selected-active-interview"),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "choose-kanban" }));
    expect(await screen.findByText("kanban-view")).toBeTruthy();
    expect(screen.getByText("bulk-count-1")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "choose-focus" }));
    expect(
      await screen.findByText("focus-selected-active-interview"),
    ).toBeTruthy();
  });

  it.each([
    {
      action: "bulk-status",
      isTargetCall: (init?: RequestInit) =>
        init?.method === "PATCH" &&
        Boolean(init.body) &&
        JSON.parse(String(init.body)).status === "offer",
    },
    {
      action: "bulk-archive",
      isTargetCall: (init?: RequestInit) =>
        init?.method === "PATCH" &&
        Boolean(init.body) &&
        Boolean(JSON.parse(String(init.body)).archivedAt),
    },
    {
      action: "bulk-delete",
      isTargetCall: (init?: RequestInit) => init?.method === "DELETE",
    },
  ])(
    "$action includes filter-hidden records and sends exactly the scoped IDs",
    async ({ action, isTargetCall }) => {
      const user = userEvent.setup();
      const { fetchMock } = renderDashboard([activeInterview, activeApplied]);

      await user.click(
        await screen.findByRole("button", { name: "select-active-interview" }),
      );
      await user.click(
        screen.getByRole("button", { name: "select-active-applied" }),
      );
      await user.click(
        screen.getByRole("button", { name: "filter-interview" }),
      );

      expect(await screen.findByText("bulk-count-2")).toBeTruthy();
      expect(screen.getByText("bulk-hidden-1")).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "select-active-applied" }),
      ).toBeNull();

      await user.click(screen.getByRole("button", { name: action }));
      await waitFor(() => {
        const targetIds = fetchMock.mock.calls
          .filter(([, init]) => isTargetCall(init))
          .map(([input]) => String(input).split("/").pop())
          .sort();
        expect(targetIds).toEqual(["active-applied", "active-interview"]);
      });
    },
  );

  it("immediately removes migrated, deleted, and externally disappeared records from actionable selection", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderDashboard([activeInterview, activeApplied]);

    await user.click(
      await screen.findByRole("button", { name: "select-active-interview" }),
    );
    await user.click(
      screen.getByRole("button", { name: "archive-active-interview" }),
    );
    expect(screen.queryByText("bulk-count-1")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "select-active-applied" }),
    );
    await user.click(
      screen.getByRole("button", { name: "delete-active-applied" }),
    );
    expect(screen.queryByText("bulk-count-1")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "select-active-applied" }),
    );
    expect(screen.getByText("bulk-count-1")).toBeTruthy();
    await act(async () => {
      queryClient.setQueryData<Application[]>(["applications"], [activeInterview]);
    });
    await waitFor(() => expect(screen.queryByText("bulk-count-1")).toBeNull());
  });
});
