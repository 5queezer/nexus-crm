// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import germanMessages from "../../messages/de.json";
import { AdminUsers } from "../admin-users";
import { ApiToken } from "../api-token";
import { AppSettingsPanel } from "../app-settings";
import { AuditLog } from "../audit-log";
import { EmailIntegration } from "../email-integration";
import { McpClientHelp } from "../mcp-client-help";

function renderSettingsSurface(component: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function expectFlatRoot(element: Element | null) {
  expect(element).not.toBeNull();
  expect(element?.className).not.toMatch(/\b(?:border|rounded-xl|shadow|bg-white)\b/);
}

describe("flat settings surfaces", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders MCP setup instructions and copy controls in German", async () => {
    const user = userEvent.setup();
    render(<NextIntlClientProvider locale="de" messages={germanMessages}><McpClientHelp /></NextIntlClientProvider>);
    expect(screen.getByRole("heading", { name: "MCP-Client einrichten" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "API-Zugriff" }).getAttribute("href")).toBe("/settings#api");
    await user.click(screen.getByText("OAuth-Verbindung einrichten"));
    expect(screen.getByText("Öffne die Konnektor- oder MCP-Server-Einstellungen in Claude oder ChatGPT.")).toBeTruthy();
    await user.click(screen.getByText("API-Token als Alternative"));
    expect(screen.getByText("Erstelle unter API-Zugriff ein API-Token und kopiere es sofort.")).toBeTruthy();
    expect(screen.queryByText("OAuth connector setup")).toBeNull();
    expect(screen.queryByText("Copy")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Kopieren" }).length).toBeGreaterThan(0);
  });

  it("reports preference edits relative to the last saved baseline", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderSettingsSurface(<AppSettingsPanel onDirtyChange={onDirtyChange} />);

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    const title = screen.getByRole("textbox", { name: "Application Title" });
    await user.clear(title);
    await user.type(title, "My Nexus");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("keeps preference edits dirty and reports a local storage failure", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    renderSettingsSurface(<AppSettingsPanel onDirtyChange={onDirtyChange} />);

    const subtitle = screen.getByRole("textbox", { name: "Subtitle" });
    await user.type(subtitle, "Pipeline");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("alert").textContent).toBe("Settings could not be saved.");
  });

  it("renders preferences without a nested card or repeated heading", () => {
    const { container } = renderSettingsSurface(<AppSettingsPanel />);

    expectFlatRoot(container.firstElementChild);
    expect(screen.queryByRole("heading", { name: "Appearance" })).toBeNull();
  });

  it("keeps connected email controls labeled in a flat responsive section", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        integration: {
          provider: "gmail",
          enabled: true,
          scanFrequency: 30,
          autoImport: "review",
          scanDaysBack: 7,
          lastScanAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    }));

    const { container } = renderSettingsSurface(<EmailIntegration />);
    expect(await screen.findByRole("combobox", { name: "Scan frequency" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Import mode" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Scan window" })).toBeTruthy();
    expectFlatRoot(container.firstElementChild);
    expect(screen.queryByRole("heading", { name: "Email Intelligence" })).toBeNull();
  });

  it("shows an email settings error and retries instead of appearing disconnected", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ integration: null }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderSettingsSurface(<EmailIntegration />);

    expect((await screen.findByRole("alert")).textContent).toBe("Email settings could not be loaded.");
    expect(screen.queryByRole("link", { name: "Connect Gmail" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Connect Gmail" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a failed email scan", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/email/scan" && init?.method === "POST") {
        return { ok: false, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({
          integration: {
            provider: "gmail",
            enabled: true,
            scanFrequency: 30,
            autoImport: "review",
            scanDaysBack: 7,
            lastScanAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      };
    }));
    const user = userEvent.setup();
    renderSettingsSurface(<EmailIntegration />);

    await user.click(await screen.findByRole("button", { name: "Scan now" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The email action could not be completed.");
  });

  it("shows API token load and mutation errors without an empty-state action", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: null }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderSettingsSurface(<ApiToken />);

    expect((await screen.findByRole("alert")).textContent).toBe("API token status could not be loaded.");
    expect(screen.queryByRole("button", { name: "Generate Token" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(await screen.findByRole("button", { name: "Generate Token" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The API token action could not be completed.");
  });

  it("flattens API, MCP, users, and audit containers while retaining row separators", async () => {
    const responses = new Map<string, unknown>([
      ["/api/token", { token: null }],
      ["/api/admin/users", [{ id: "owner", name: "Owner", email: "owner@example.com", isAdmin: true }]],
      ["/api/admin/audit-logs", [{ id: "log-1", actorEmail: "owner@example.com", action: "grant_admin", targetEmail: "admin@example.com", createdAt: "2026-01-01T00:00:00.000Z" }]],
    ]);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => responses.get(String(input)),
    })));

    const api = renderSettingsSurface(<ApiToken />);
    await screen.findByText("No API token generated yet.");
    expectFlatRoot(api.container.firstElementChild);
    api.unmount();

    const mcp = renderSettingsSurface(<McpClientHelp />);
    expectFlatRoot(mcp.container.firstElementChild);
    mcp.unmount();

    const users = renderSettingsSurface(<AdminUsers currentUserId="owner" />);
    await screen.findByText("owner@example.com");
    expectFlatRoot(users.container.firstElementChild);
    expect(screen.queryByRole("heading", { name: "User Management" })).toBeNull();
    expect(users.container.querySelector(".divide-y")).not.toBeNull();
    users.unmount();

    const audit = renderSettingsSurface(<AuditLog />);
    await screen.findByText("admin@example.com");
    expectFlatRoot(audit.container.firstElementChild);
    expect(screen.queryByRole("heading", { name: "Audit Log" })).toBeNull();
    expect(audit.container.querySelector(".divide-y")).not.toBeNull();
  });

  it("keeps the MCP endpoint visible and collapses optional setup details", async () => {
    const { container } = renderSettingsSurface(<McpClientHelp />);

    expect(await screen.findByText((content) => content.endsWith("/api/mcp"))).toBeTruthy();
    expect(screen.getByRole("link", { name: "API access" }).getAttribute("href")).toBe("/settings#api");
    expect(container.querySelectorAll("details")).toHaveLength(2);
  });
});
