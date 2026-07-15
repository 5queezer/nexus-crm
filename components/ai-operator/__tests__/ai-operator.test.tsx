/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "@/messages/en.json";
import { AiOperator } from "../ai-operator";

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function renderOperator() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <AiOperator />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AiOperator", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.restoreAllMocks();
  });

  it("opens as an accessible dialog and guides a user without credentials through BYOK setup", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/agent/credentials")) {
        return json({
          providers: [
            {
              id: "openai",
              label: "OpenAI",
              models: [{ id: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "Fast" }],
            },
          ],
          credentials: [],
        });
      }
      if (url.endsWith("/api/agent/threads")) return json({ threads: [] });
      return json({ error: "not found" }, 404);
    });
    const user = userEvent.setup();
    renderOperator();

    await user.click(screen.getByRole("button", { name: "Open AI operator" }));

    expect(await screen.findByRole("dialog", { name: "Nexus Operator" })).toBeTruthy();
    expect(await screen.findByText("Connect a model to begin")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open conversation history" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close conversation history" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Configure model" }));
    expect(await screen.findByText("Bring your own model")).toBeTruthy();
    expect(screen.getByPlaceholderText("Paste API key").getAttribute("type")).toBe("password");
  });

  it("traps focus in the dialog and restores it to the launcher on close", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/agent/credentials")) return json({ providers: [], credentials: [] });
      if (url.endsWith("/api/agent/threads")) return json({ threads: [] });
      return json({ error: "not found" }, 404);
    });
    const user = userEvent.setup();
    renderOperator();
    const launcher = screen.getByRole("button", { name: "Open AI operator" });

    await user.click(launcher);
    const dialog = await screen.findByRole("dialog", { name: "Nexus Operator" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Nexus Operator" })).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("renders the exact sanitized MCP tool arguments before approval", async () => {
    const providerPayload = {
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          models: [{ id: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "Fast" }],
        },
      ],
      credentials: [
        {
          id: "credential-1",
          provider: "openai",
          keyHint: "••••1234",
          defaultModel: "gpt-5.4-mini",
          status: "configured",
        },
      ],
    };
    const thread = {
      id: "thread-1",
      title: "Pipeline review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "message-1",
          role: "assistant",
          content: "I found one follow-up that needs attention.",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/agent/credentials")) return json(providerPayload);
      if (url.endsWith("/api/agent/threads")) return json({ threads: [thread] });
      if (url.endsWith("/api/agent/threads/thread-1")) return json({ thread });
      if (url.includes("/api/agent/proposals?threadId=")) {
        return json({
          proposals: [
            {
              id: "proposal-1",
              kind: "mcp_tool",
              targetType: "mcp_connector",
              targetId: "connector-1",
              expectedDiff: [{ field: "externalInvocation", from: null, to: "Research tools:create_task" }],
              sanitizedPayload: {
                toolName: "create_task",
                arguments: { title: "Follow up", priority: 2, notify: true },
                connectorName: "Research tools",
                connectorUrl: "https://mcp.example.com/v1",
                connectorVersion: "2026-07-14T00:00:00.000Z",
              },
              assumptions: { reason: "Create the requested follow-up task" },
              status: "pending",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }
      return json({ error: "not found" }, 404);
    });
    const user = userEvent.setup();
    renderOperator();

    await user.click(screen.getByRole("button", { name: "Open AI operator" }));

    expect(await screen.findByText("I found one follow-up that needs attention.")).toBeTruthy();
    expect(await screen.findByText("Approval required")).toBeTruthy();
    expect(screen.getByText("create_task")).toBeTruthy();
    expect(screen.getByText("Research tools")).toBeTruthy();
    expect(screen.getByText("https://mcp.example.com/v1")).toBeTruthy();
    expect(screen.getByText("2026-07-14T00:00:00.000Z")).toBeTruthy();
    expect(screen.getByText(/"title": "Follow up"/)).toBeTruthy();
    expect(screen.getByText(/"priority": 2/)).toBeTruthy();
    expect(screen.getByText(/"notify": true/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve change/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeTruthy();
  });

  it("keeps the current proposal visible and reports a proposal refresh failure", async () => {
    const now = new Date().toISOString();
    const thread = {
      id: "thread-1",
      title: "Review",
      createdAt: now,
      updatedAt: now,
      messages: [{ id: "message-1", role: "assistant", content: "Review this change.", createdAt: now }],
    };
    let proposalRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/agent/credentials")) return json({
        providers: [{ id: "openai", label: "OpenAI", models: [{ id: "gpt", label: "GPT", description: "Fast" }] }],
        credentials: [{ id: "credential-1", provider: "openai", keyHint: "••••1234", defaultModel: "gpt", status: "configured" }],
      });
      if (url.endsWith("/api/agent/threads")) return json({ threads: [thread] });
      if (url.endsWith("/api/agent/threads/thread-1")) return json({ thread });
      if (url.includes("/api/agent/proposals?threadId=")) {
        proposalRequests += 1;
        if (proposalRequests > 1) return json({ error: "Could not refresh approvals" }, 503);
        return json({ proposals: [{
          id: "proposal-1",
          kind: "update_application",
          targetType: "application",
          targetId: "application-1",
          expectedDiff: [{ field: "status", from: "applied", to: "interview" }],
          status: "pending",
          expiresAt: now,
          createdAt: now,
        }] });
      }
      if (url.endsWith("/api/agent/proposals/proposal-1/approve") && init?.method === "POST") return json({});
      return json({ error: "not found" }, 404);
    });
    const user = userEvent.setup();
    renderOperator();

    await user.click(screen.getByRole("button", { name: "Open AI operator" }));
    await user.click(await screen.findByRole("button", { name: "Approve change" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Could not refresh approvals");
    expect(screen.getByText("Approval required")).toBeTruthy();
  });

  it("labels connector settings, exposes expansion state, and refreshes tools after edits", async () => {
    const connector = { id: "connector-1", name: "Research tools", url: "https://mcp.example.com", enabled: true, hasAuthorization: false };
    let toolRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/agent/credentials")) return json({ providers: [], credentials: [] });
      if (url.endsWith("/api/agent/threads")) return json({ threads: [] });
      if (url.endsWith("/api/agent/connectors") && !init?.method) return json({ connectors: [connector] });
      if (url.endsWith("/api/agent/connectors/connector-1/tools")) {
        toolRequests += 1;
        return json({ tools: [{ name: `search-v${toolRequests}` }] });
      }
      if (url.endsWith("/api/agent/connectors/connector-1") && init?.method === "PUT") {
        return json({ connector: { ...connector, name: "Updated tools" } });
      }
      return json({ error: "not found" }, 404);
    });
    const user = userEvent.setup();
    renderOperator();

    await user.click(screen.getByRole("button", { name: "Open AI operator" }));
    await user.click(await screen.findByRole("button", { name: "Configure model" }));
    await user.click(screen.getByRole("button", { name: "Connectors" }));

    expect(await screen.findByRole("textbox", { name: "Connector name" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Connector URL" })).toBeTruthy();
    expect(screen.getByLabelText("Authorization header (optional)")).toBeTruthy();
    let expander = await screen.findByRole("button", { name: "Show tools for Research tools" });
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expect(expander.getAttribute("aria-controls")).toBe("connector-tools-connector-1");

    await user.click(expander);
    expect(await screen.findByText("search-v1")).toBeTruthy();
    expect(expander.getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Edit Research tools" }));
    const nameInput = screen.getByRole("textbox", { name: "Connector name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Updated tools");
    await user.click(screen.getByRole("button", { name: "Save connector" }));

    expander = await screen.findByRole("button", { name: "Hide tools for Updated tools" });
    await user.click(expander);
    await user.click(screen.getByRole("button", { name: "Show tools for Updated tools" }));
    expect(await screen.findByText("search-v2")).toBeTruthy();
  });

  it("shows starter actions when the authenticated user already configured a model", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/api/agent/credentials")) {
        return json({
          providers: [
            {
              id: "anthropic",
              label: "Anthropic",
              models: [
                {
                  id: "claude-sonnet-4-6",
                  label: "Claude Sonnet 4.6",
                  description: "Balanced",
                },
              ],
            },
          ],
          credentials: [
            {
              id: "credential-1",
              provider: "anthropic",
              keyHint: "••••cdef",
              defaultModel: "claude-sonnet-4-6",
              status: "configured",
            },
          ],
        });
      }
      if (url.endsWith("/api/agent/threads")) return json({ threads: [] });
      return json({ error: "not found" }, 404);
    });
    const user = userEvent.setup();
    renderOperator();

    await user.click(screen.getByRole("button", { name: "Open AI operator" }));

    expect(await screen.findByText("What should we work on?")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Summarize my pipeline/ })).toBeTruthy();
    expect(screen.getByText("Private · your model key")).toBeTruthy();
  });
});
