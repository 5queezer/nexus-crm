// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { Dashboard } from "../dashboard";

const applications: Application[] = [
  {
    id: "active-1",
    company: "Active Co",
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
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  },
  {
    id: "archived-1",
    company: "Archived Co",
    role: "Designer",
    status: "rejected",
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
    archivedAt: "2026-07-14T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  },
];

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
vi.mock("../keyboard-shortcut-bar", () => ({
  KeyboardShortcutBar: () => null,
}));
vi.mock("../keyboard-shortcut-dialog", () => ({
  KeyboardShortcutDialog: () => null,
}));
vi.mock("../bulk-action-bar", () => ({ BulkActionBar: () => null }));
vi.mock("../onboarding-wizard", () => ({ OnboardingWizard: () => null }));
vi.mock("../opportunity-filter-controls", () => ({
  OpportunityFilterControls: () => null,
}));
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
    onViewModeChange: (view: "focus") => void;
    moreMenu: ReactNode;
  }) => (
    <div>
      <span>toolbar-view-{viewMode}</span>
      {moreMenu}
      <button type="button" onClick={() => onViewModeChange("focus")}>
        select-focus
      </button>
    </div>
  ),
}));
vi.mock("../focus-queue", () => ({
  FocusQueue: () => <div>focus-queue</div>,
}));
vi.mock("../application-table", () => ({
  ApplicationTable: ({ showArchived }: { showArchived?: boolean }) => (
    <div>{showArchived ? "table-unarchive-action" : "active-table"}</div>
  ),
}));
vi.mock("../kanban-view", () => ({
  KanbanView: () => <div>kanban-view</div>,
}));

describe("Dashboard archive view", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("onboarding-complete", "true");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => applications }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders compact archive in Table with unarchive after an explicit Focus selection", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Dashboard
          user={{
            id: "user-1",
            email: "user@example.com",
            isAdmin: false,
          }}
          shareUrl="https://example.com/share"
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("focus-queue")).toBeTruthy();
    expect(screen.getByText("total")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "select-focus" }));
    await user.click(screen.getByRole("button", { name: "toggle-archive" }));

    expect(await screen.findByText("toolbar-view-table")).toBeTruthy();
    expect(screen.getByText("table-unarchive-action")).toBeTruthy();
    expect(screen.queryByText("focus-queue")).toBeNull();
    expect(screen.queryByText("total")).toBeNull();
  });
});
