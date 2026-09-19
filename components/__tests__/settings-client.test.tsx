// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

vi.mock("../app-header", () => ({ AppHeader: () => <header>Header</header> }));
vi.mock("../app-settings", () => ({ AppSettingsPanel: () => <div>Preference controls</div> }));
vi.mock("../email-integration", () => ({ EmailIntegration: () => <div>Email controls</div> }));
vi.mock("../api-token", () => ({ ApiToken: () => <div>Token controls</div> }));
vi.mock("../mcp-client-help", () => ({ McpClientHelp: () => <div>MCP client instructions</div> }));
vi.mock("../admin-users", () => ({ AdminUsers: () => <div>User controls</div> }));
vi.mock("../audit-log", () => ({ AuditLog: () => <div>Audit records</div> }));
vi.mock("../agent-settings-section", () => ({ AgentSettingsSection: ({ section }: { section: string }) => <div>{section} controls</div> }));
vi.mock("../theme-switcher", () => ({ ThemeSwitcher: () => <button>Appearance</button> }));
vi.mock("../language-switcher", () => ({ LanguageSwitcher: () => <button>Language</button> }));

import { SettingsClient } from "../settings-client";

function renderSettings(isAdmin: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <SettingsClient user={{ id: "owner", email: "owner@example.com", name: "Owner", image: null, isAdmin }} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("SettingsClient", () => {
  beforeEach(() => vi.restoreAllMocks());

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
