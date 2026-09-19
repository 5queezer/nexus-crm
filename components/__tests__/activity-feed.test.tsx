// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

vi.mock("../app-header", () => ({ AppHeader: () => <header>Header</header> }));
vi.mock("../bulk-task-history", () => ({ BulkTaskHistory: () => <section>Task history</section> }));

import { ActivityFeed } from "../activity-feed";

const user = { id: "owner", email: "owner@example.com", name: "Owner", image: null, isAdmin: false };

function renderFeed() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}><ActivityFeed user={user} /></QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function event(id: string, company: string) {
  return {
    id,
    applicationId: id,
    type: "stage_changed",
    occurredAt: "2026-07-24T09:00:00.000Z",
    source: "rest",
    actor: "owner@example.com",
    contactId: null,
    outcome: null,
    metadata: { toStage: "technical" },
    application: { id, company, role: "Engineer" },
  };
}

describe("ActivityFeed", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("filters, links, and incrementally loads owner activity", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [event("1", "Acme")], nextCursor: "next" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [event("2", "Beta")], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [event("3", "Filtered Co")], nextCursor: null }), { status: 200 }));
    const userEventApi = userEvent.setup();
    renderFeed();

    const acme = await screen.findByRole("link", { name: /Acme — Engineer/ });
    expect(acme.getAttribute("href")).toBe("/applications/1");
    await userEventApi.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Beta — Engineer")).toBeTruthy();

    await userEventApi.type(screen.getByLabelText("Company"), "Filtered Co");
    await userEventApi.selectOptions(screen.getByLabelText("Order"), "oldest");
    await userEventApi.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("Filtered Co — Engineer")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2][0])).toContain("company=Filtered+Co");
    expect(String(fetchMock.mock.calls[2][0])).toContain("order=oldest");
  });

  it("shows an empty state without implying history was deleted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    renderFeed();
    expect(await screen.findByText("No events match these filters. Your history has not been deleted.")).toBeTruthy();
  });

  it("shows a controlled localized error state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "internal details" }), { status: 500 }));
    renderFeed();
    expect((await screen.findByRole("alert")).textContent).toBe("Could not load activity.");
  });

  it("keeps detected-email review in Activity and preserves real import outcomes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/events")) return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      if (url === "/api/email/scanned?status=pending") return new Response(JSON.stringify({ emails: [{
        id: "email-1", subject: "Interview invitation", sender: "recruiter@example.com",
        receivedAt: "2026-07-24T09:00:00.000Z", classification: "interview", confidence: "high",
        extractedData: { company: "Acme", role: "Engineer" }, status: "pending", applicationId: null,
      }] }), { status: 200 });
      if (url === "/api/email/scanned" && init?.method === "PATCH") return new Response(JSON.stringify({ success: true, imported: 1 }), { status: 200 });
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    const userEventApi = userEvent.setup();
    renderFeed();

    await userEventApi.click(screen.getByRole("tab", { name: "Email review" }));
    expect(await screen.findByText("Interview invitation")).toBeTruthy();
    await userEventApi.click(screen.getByTitle("Import"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/email/scanned", expect.objectContaining({ method: "PATCH" })));
    expect((await screen.findByRole("status")).textContent).toContain("1 message imported.");
  });
});
