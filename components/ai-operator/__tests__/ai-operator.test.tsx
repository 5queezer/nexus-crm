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
    await user.click(screen.getByRole("button", { name: "Configure model" }));
    expect(await screen.findByText("Bring your own model")).toBeTruthy();
    expect(screen.getByPlaceholderText("Paste API key").getAttribute("type")).toBe("password");
  });

  it("renders persisted messages and review controls for a pending proposal", async () => {
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
              kind: "update_application",
              targetType: "application",
              targetId: "application-1",
              expectedDiff: [{ field: "status", from: "applied", to: "interview" }],
              assumptions: { reason: "Interview invitation received" },
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
    expect(screen.getByRole("button", { name: /Approve change/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeTruthy();
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
