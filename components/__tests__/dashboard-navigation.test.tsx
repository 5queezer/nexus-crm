// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
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
  OpportunityFilterControls: () => null,
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
    pushMock.mockClear();
    localStorage.clear();
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

    expect(pushMock).toHaveBeenCalledWith("/applications/application-1");
  });

  it("pushes the detail route when the command palette selects an application", async () => {
    const user = await renderDashboard();

    await user.keyboard("/");
    await waitFor(() =>
      expect(captured.palette.onSelect).toBeTypeOf("function"),
    );
    act(() => captured.palette.onSelect?.(application));

    expect(pushMock).toHaveBeenCalledWith("/applications/application-1");
  });

  it("pushes the new detail route once the quick-create modal reports success", async () => {
    const user = await renderDashboard();

    await user.keyboard("n");
    await waitFor(() =>
      expect(captured.modal.onCreated).toBeTypeOf("function"),
    );
    act(() => captured.modal.onCreated?.({ ...application, id: "new-id" }));

    expect(pushMock).toHaveBeenCalledWith("/applications/new-id");
  });
});
