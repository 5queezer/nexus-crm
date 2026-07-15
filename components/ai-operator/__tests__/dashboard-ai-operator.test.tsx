/** @vitest-environment jsdom */

import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "../../dashboard";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("../../app-header", () => ({ AppHeader: () => <header>Header</header> }));
vi.mock("../../onboarding-wizard", () => ({
  OnboardingWizard: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>Complete onboarding</button>,
}));
vi.mock("../ai-operator", () => ({
  AiOperator: () => {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount((value) => value + 1)}>operator-count-{count}</button>;
  },
}));
vi.mock("../../application-table", () => ({ ApplicationTable: () => <div>Table</div> }));
vi.mock("../../application-modal", () => ({ ApplicationModal: () => null }));
vi.mock("../../kanban-view", () => ({ KanbanView: () => <div>Kanban</div> }));
vi.mock("../../command-palette", () => ({ CommandPalette: () => null }));
vi.mock("../../keyboard-shortcut-bar", () => ({ KeyboardShortcutBar: () => null }));
vi.mock("../../keyboard-shortcut-dialog", () => ({ KeyboardShortcutDialog: () => null }));
vi.mock("../../bulk-action-bar", () => ({ BulkActionBar: () => null }));
vi.mock("../../action-menu", () => ({ ActionMenu: () => null }));
vi.mock("../../workspace-toolbar", () => ({ WorkspaceToolbar: () => null }));
vi.mock("../../app-settings", () => ({ loadAppSettings: () => ({ appTitle: "" }) }));

describe("Dashboard AI operator lifetime", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("preserves the operator instance when onboarding completes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <Dashboard user={{ id: "user-1", email: "user@example.com", isAdmin: false }} shareUrl="https://example.com/share" />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Complete onboarding" });
    const operator = screen.getByRole("button", { name: "operator-count-0" });
    await user.click(operator);
    expect(screen.getByRole("button", { name: "operator-count-1" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Complete onboarding" }));
    expect(await screen.findByRole("button", { name: "operator-count-1" })).toBeTruthy();
  });
});
