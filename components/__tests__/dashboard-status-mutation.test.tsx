// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application, ApplicationStatus } from "@/types";
import type { ApplicationStatusMutation } from "@/hooks/use-application-status-mutation";
import { Dashboard } from "../dashboard";

function application(status: ApplicationStatus): Application {
  return {
    id: "application-1",
    company: "Acme",
    role: "Engineer",
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
    archivedAt: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
vi.mock("../application-table", () => ({ ApplicationTable: () => null }));
vi.mock("../kanban-view", () => ({ KanbanView: () => null }));
vi.mock("../command-palette", () => ({ CommandPalette: () => null }));
vi.mock("../keyboard-shortcut-bar", () => ({
  KeyboardShortcutBar: () => null,
}));
vi.mock("../keyboard-shortcut-dialog", () => ({
  KeyboardShortcutDialog: () => null,
}));
vi.mock("../onboarding-wizard", () => ({ OnboardingWizard: () => null }));
vi.mock("../action-menu", () => ({ ActionMenu: () => null }));
vi.mock("../workspace-toolbar", () => ({ WorkspaceToolbar: () => null }));
vi.mock("../opportunity-filter-controls", () => ({
  OpportunityFilterControls: () => null,
}));
vi.mock("../ai-operator/ai-operator", () => ({ AiOperator: () => null }));
vi.mock("../focus-queue", () => ({
  FocusQueue: ({
    applications,
    onToggleSelect,
    statusMutation,
  }: {
    applications: Application[];
    onToggleSelect: (id: string) => void;
    statusMutation: ApplicationStatusMutation;
  }) => (
    <div>
      <span>cache-status-{applications[0]?.status}</span>
      <button
        type="button"
        onClick={() =>
          statusMutation.mutate({
            id: "application-1",
            status: "applied",
          })
        }
      >
        per-record status
      </button>
      <button
        type="button"
        onClick={() => onToggleSelect("application-1")}
      >
        select record
      </button>
    </div>
  ),
}));
vi.mock("../bulk-action-bar", () => ({
  BulkActionBar: ({
    selectedCount,
    onChangeStatus,
  }: {
    selectedCount: number;
    onChangeStatus: (status: ApplicationStatus) => void;
  }) =>
    selectedCount > 0 ? (
      <div>
        <span>selected-{selectedCount}</span>
        <button type="button" onClick={() => onChangeStatus("interview")}>
          bulk status
        </button>
      </div>
    ) : null,
}));

describe("Dashboard status mutation coordinator", () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes a newer bulk same-record intent behind an older per-record write and rolls back to the last confirmation", async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    const patchBodies: Array<{ status: ApplicationStatus }> = [];
    let serverStatus: ApplicationStatus = "inbound";

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "PATCH") {
          return new Response(JSON.stringify([application(serverStatus)]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = JSON.parse(init.body as string) as {
          status: ApplicationStatus;
        };
        patchBodies.push(body);
        const response = await (patchBodies.length === 1
          ? firstResponse.promise
          : secondResponse.promise);
        if (response.ok) serverStatus = body.status;
        return response;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
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

    await screen.findByText("cache-status-inbound");
    await user.click(screen.getByRole("button", { name: "per-record status" }));
    await waitFor(() => expect(patchBodies).toEqual([{ status: "applied" }]));

    await user.click(screen.getByRole("button", { name: "select record" }));
    await user.click(screen.getByRole("button", { name: "bulk status" }));

    await screen.findByText("cache-status-interview");
    expect(patchBodies).toEqual([{ status: "applied" }]);
    expect(screen.getByText("selected-1")).toBeTruthy();

    await act(async () => {
      firstResponse.resolve(
        new Response(JSON.stringify(application("applied")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    await waitFor(() =>
      expect(patchBodies).toEqual([
        { status: "applied" },
        { status: "interview" },
      ]),
    );

    await act(async () => {
      secondResponse.resolve(new Response("update failed", { status: 500 }));
    });

    await waitFor(() => {
      expect(screen.queryByText("selected-1")).toBeNull();
      expect(screen.getByText("cache-status-applied")).toBeTruthy();
    });
    expect(screen.getByText("status_rollback")).toBeTruthy();
    expect(serverStatus).toBe("applied");
    expect(
      queryClient
        .getQueryData<Application[]>(["applications"])
        ?.find((item) => item.id === "application-1")?.status,
    ).toBe("applied");
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(2);
  });
});
