// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

vi.mock("../app-header", () => ({ AppHeader: () => <header>Header</header> }));
vi.mock("../app-settings", () => ({ AppSettingsPanel: ({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) => <button onClick={() => onDirtyChange?.(true)}>Edit preferences</button> }));
vi.mock("../email-integration", () => ({ EmailIntegration: () => <div>Email controls</div> }));
vi.mock("../api-token", () => ({ ApiToken: () => <div>Token controls</div> }));
vi.mock("../mcp-client-help", () => ({ McpClientHelp: () => <div>MCP client instructions</div> }));
vi.mock("../admin-users", () => ({ AdminUsers: () => <div>User controls</div> }));
vi.mock("../audit-log", () => ({ AuditLog: () => <div>Audit records</div> }));
vi.mock("../agent-settings-section", () => ({ AgentSettingsSection: ({ section }: { section: string }) => <div>{section} controls</div> }));
vi.mock("../theme-switcher", () => ({ ThemeSwitcher: () => <button>Appearance</button> }));
vi.mock("../language-switcher", () => ({ LanguageSwitcher: () => <button>Language</button> }));

import { SettingsClient } from "../settings-client";
import { HistoryNavigationGuard } from "../history-navigation-guard";

function renderSettings(isAdmin: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <HistoryNavigationGuard />
        <SettingsClient user={{ id: "owner", email: "owner@example.com", name: "Owner", image: null, isAdmin }} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("SettingsClient", () => {
  beforeEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, "", "/settings"); });

  it("moves focus and selection with arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    renderSettings(false);
    screen.getByRole("tab", { name: "Preferences" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Assistant behavior" }));
    expect(screen.getByRole("tab", { name: "Assistant behavior" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "API access" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Preferences" }));
    expect(screen.getAllByRole("tab").filter(tab => tab.tabIndex === 0)).toHaveLength(1);
  });

  it("follows browser history after a settings selection", async () => {
    const user = userEvent.setup();
    renderSettings(false);
    await user.click(screen.getByRole("tab", { name: "AI models" }));
    act(() => {
      window.history.replaceState(null, "", "/settings#email");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("tab", { name: "Email" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps dirty settings when a section or browser navigation is declined", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSettings(false);
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    await user.click(screen.getByRole("tab", { name: "AI models" }));
    expect(screen.getByRole("tab", { name: "Preferences" }).getAttribute("aria-selected")).toBe("true");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    act(() => {
      window.history.replaceState(null, "", "/settings#email");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.hash).toBe("#preferences");
    expect(screen.getByRole("tab", { name: "Preferences" }).getAttribute("aria-selected")).toBe("true");
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("tab", { name: "AI models" }));
    expect(screen.getByRole("tab", { name: "AI models" }).getAttribute("aria-selected")).toBe("true");
  });

  it("does not silently discard edits through a workspace link", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSettings(false);
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const link = document.createElement("a");
    link.href = "/documents";
    document.body.append(link);
    expect(fireEvent.click(link)).toBe(false);
    link.remove();
  });

  it("keeps focus on the selected tab after keyboard navigation is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSettings(false);
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const preferences = screen.getByRole("tab", { name: "Preferences" });
    preferences.focus();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(preferences);
  });

  it("restores the settings router state rather than the destination state on rejected Back", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const settingsState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["settings"] };
    window.history.replaceState(settingsState, "", "/settings");
    renderSettings(false);
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const routerListener = vi.fn();
    window.addEventListener("popstate", routerListener);
    act(() => {
      window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["documents"] }, "", "/documents");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(window.location.pathname).toBe("/settings");
    expect(window.history.state).toEqual(settingsState);
    expect(routerListener).not.toHaveBeenCalled();
    window.removeEventListener("popstate", routerListener);
  });

  it("asks once for a confirmed settings hash link", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSettings(false);
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const link = document.createElement("a");
    link.href = "/settings#email";
    document.body.append(link);
    fireEvent.click(link);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "Email" }).getAttribute("aria-selected")).toBe("true");
    link.remove();
  });

  it("does not leave unload protection disabled when an approved link is canceled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSettings(false);
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const link = document.createElement("a");
    link.href = "/documents";
    link.addEventListener("click", event => event.preventDefault());
    document.body.append(link);
    fireEvent.click(link);
    await new Promise(resolve => setTimeout(resolve, 0));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    link.remove();
  });

  it("consumes a confirmed full navigation only once", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSettings(false);
    await user.click(screen.getByRole("button", { name: "Edit preferences" }));
    const link = document.createElement("a");
    link.href = "/api-docs";
    link.addEventListener("click", event => event.preventDefault());
    document.body.append(link);
    fireEvent.click(link);
    const firstUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(firstUnload);
    expect(firstUnload.defaultPrevented).toBe(false);
    const laterUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(laterUnload);
    expect(laterUnload.defaultPrevented).toBe(true);
    link.remove();
  });

  it("organizes settings into keyboard-operable task sections", async () => {
    const user = userEvent.setup();
    renderSettings(true);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    const email = screen.getByRole("tab", { name: "Email" });
    email.focus();
    await user.keyboard("{Enter}");
    expect(email.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Email" }).textContent).toContain("Email controls");
    expect(screen.getByRole("link", { name: "Review detected messages in Activity" }).getAttribute("href")).toBe("/activity#email-review");

    await user.click(screen.getByRole("tab", { name: "Assistant behavior" }));
    expect(screen.getByRole("tabpanel", { name: "Assistant behavior" }).textContent).toContain("Every write requires server-side authorization");
  });

  it("does not expose administrative sections to a normal user", () => {
    renderSettings(false);
    expect(screen.queryByRole("tab", { name: "Users" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Audit log" })).toBeNull();
  });
});
