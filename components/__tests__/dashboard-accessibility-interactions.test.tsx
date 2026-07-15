// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { Dashboard } from "../dashboard";

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

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("../app-header", () => ({ AppHeader: () => null }));
vi.mock("../app-settings", () => ({
  loadAppSettings: () => ({ appTitle: "" }),
}));
vi.mock("../application-modal", () => ({
  ApplicationModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-modal="true" aria-label="application modal">
      <button type="button" onClick={onClose}>
        close modal
      </button>
    </div>
  ),
}));
vi.mock("../application-table", () => ({ ApplicationTable: () => null }));
vi.mock("../kanban-view", () => ({ KanbanView: () => null }));
vi.mock("../command-palette", () => ({
  CommandPalette: () => <div>command palette open</div>,
}));
vi.mock("../keyboard-shortcut-bar", () => ({ KeyboardShortcutBar: () => null }));
vi.mock("../keyboard-shortcut-dialog", () => ({
  KeyboardShortcutDialog: () => null,
}));
vi.mock("../bulk-action-bar", () => ({ BulkActionBar: () => null }));
vi.mock("../onboarding-wizard", () => ({ OnboardingWizard: () => null }));
vi.mock("../action-menu", () => ({ ActionMenu: () => null }));
vi.mock("../ai-operator/ai-operator", () => ({ AiOperator: () => null }));
vi.mock("../focus-queue", () => ({ FocusQueue: () => <div>focus queue</div> }));
vi.mock("../workspace-toolbar", () => ({
  WorkspaceToolbar: ({ onCreate }: { onCreate: () => void }) => (
    <button type="button" data-dashboard-create-control onClick={onCreate}>
      toolbar create
    </button>
  ),
}));
vi.mock("../opportunity-filter-controls", async () => {
  const React = await import("react");
  return {
    OpportunityFilterControls: () => {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            open filters
          </button>
          {open && (
            <div role="dialog" aria-modal="true" aria-label="filter sheet">
              <button type="button" onClick={() => setOpen(false)}>
                close filters
              </button>
            </div>
          )}
        </div>
      );
    },
  };
});

function renderDashboard() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <Dashboard
        user={{ id: "user-1", email: "user@example.com", isAdmin: false }}
        shareUrl="https://example.com/share"
      />
    </QueryClientProvider>,
  );
}

describe("Dashboard modal ownership", () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [application] }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("restores focus to a connected create control when the mobile FAB opener unmounts", async () => {
    const user = userEvent.setup();
    renderDashboard();
    const fab = await screen.findByRole("button", { name: "new_application" });

    await user.click(fab);
    expect(fab.isConnected).toBe(false);
    await user.click(screen.getByRole("button", { name: "close modal" }));

    const liveCreate = screen.getByRole("button", { name: "toolbar create" });
    await waitFor(() => expect(document.activeElement).toBe(liveCreate));
  });

  it("blocks Cmd/Ctrl+K while a document modal filter sheet is open", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("focus queue");

    await user.click(screen.getByRole("button", { name: "open filters" }));
    expect(screen.getByRole("dialog", { name: "filter sheet" })).toBeTruthy();
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByText("command palette open")).toBeNull();

    await user.click(screen.getByRole("button", { name: "close filters" }));
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByText("command palette open")).toBeTruthy();
  });
});
