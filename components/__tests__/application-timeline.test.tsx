// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { ApplicationTimeline } from "../application-timeline";

// The page owns the record form's visibility, so the harness stands in for it.
function TimelineHost({
  disabled,
  onProjectionUpdated,
  onContactSelect,
}: {
  disabled: boolean;
  onProjectionUpdated: (updatedAt: string) => void;
  onContactSelect: (contactId: string) => void;
}) {
  const [recordOpen, setRecordOpen] = useState(false);
  return (
    <ApplicationTimeline
      applicationId="42"
      expectedUpdatedAt="2026-07-24T08:00:00.000Z"
      disabled={disabled}
      recordOpen={recordOpen}
      onRecordOpenChange={setRecordOpen}
      onContactSelect={onContactSelect}
      onProjectionUpdated={onProjectionUpdated}
    />
  );
}

function renderTimeline(onProjectionUpdated = vi.fn(), disabled = false) {
  const onContactSelect = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = (isDisabled: boolean) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <TimelineHost
          disabled={isDisabled}
          onProjectionUpdated={onProjectionUpdated}
          onContactSelect={onContactSelect}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
  const result = render(view(disabled));
  return {
    onProjectionUpdated,
    onContactSelect,
    rerenderWithDisabled: (isDisabled: boolean) => result.rerender(view(isDisabled)),
  };
}

describe("ApplicationTimeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders immutable history without leaking internal request hashes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "event-1",
        applicationId: "42",
        type: "stage_changed",
        occurredAt: "2026-07-24T09:00:00.000Z",
        source: "mcp",
        actor: "owner@example.com",
        metadata: { fromStage: "screen", toStage: "technical", requestHash: "secret" },
      }],
      nextCursor: null,
    }), { status: 200 }));

    renderTimeline();
    expect(await screen.findByText("Stage changed")).toBeTruthy();
    expect(screen.getByText("Previous stage: screen")).toBeTruthy();
    expect(screen.queryByText(/secret/)).toBeNull();
  });

  it("uses safe fallbacks, an explicit metadata allowlist, and exact entity targets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "event-future",
        applicationId: "42",
        type: "future_private_event",
        occurredAt: "2026-07-24T09:00:00.000Z",
        createdAt: "2026-07-24T09:00:01.000Z",
        source: "rest",
        actor: null,
        contactId: "contact-1",
        outcome: null,
        metadata: {
          note: "Visible note",
          privatePolicyBlob: "must-not-render",
          documentId: "document-1",
          submissionId: "submission-1",
        },
      }],
      nextCursor: null,
    }), { status: 200 }));

    const { onContactSelect } = renderTimeline();
    const user = userEvent.setup();
    expect(await screen.findByText("Unknown event (future_private_event)")).toBeTruthy();
    expect(screen.getByText("Timeline note: Visible note")).toBeTruthy();
    expect(screen.queryByText(/must-not-render/)).toBeNull();
    // The contact lives in another tab, so the page resolves it rather than a
    // fragment link — it still has to receive the exact id, never a fragment.
    await user.click(screen.getByRole("button", { name: "Contact contact-1" }));
    expect(onContactSelect).toHaveBeenCalledWith("contact-1");
    expect(screen.getByRole("link", { name: "Document document-1" }).getAttribute("href")).toBe("/documents#document-document-1");
    expect(screen.queryByRole("link", { name: "Submission submission-1" })).toBeNull();
    expect(screen.getByText("Submission submission-1")).toBeTruthy();
  });

  it("loads more pages and switches deterministic order", async () => {
    const pageEvent = (id: string, type: string) => ({
      id, applicationId: "42", type,
      occurredAt: "2026-07-24T09:00:00.000Z",
      createdAt: "2026-07-24T09:00:01.000Z",
      source: "rest", actor: null, contactId: null, outcome: null, metadata: {},
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [pageEvent("1", "stage_changed")], nextCursor: "next" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [pageEvent("2", "feedback_received")], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [pageEvent("3", "offer_received")], nextCursor: null }), { status: 200 }));
    const user = userEvent.setup();
    renderTimeline();
    await screen.findByText("Stage changed");
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Feedback received")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Timeline order"), "oldest");
    expect(await screen.findByText("Offer received")).toBeTruthy();
    expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=next");
    expect(String(fetchMock.mock.calls[2][0])).toContain("order=oldest");
  });

  it("shows a promoted outcome once, not again inside the details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "event-outcome",
        applicationId: "42",
        type: "feedback_received",
        occurredAt: "2026-07-24T09:00:00.000Z",
        createdAt: "2026-07-24T09:05:00.000Z",
        source: "mcp",
        actor: null,
        contactId: null,
        outcome: null,
        metadata: { outcome: "Awaiting client feedback", nextAction: "Wait for Connect Group" },
      }],
      nextCursor: null,
    }), { status: 200 }));

    const user = userEvent.setup();
    renderTimeline();
    await screen.findByText("Feedback received");

    // Promoted into the event body, so the details must not repeat it. The
    // duplicate would render label-prefixed, so match the value loosely.
    expect(screen.getAllByText(/Awaiting client feedback/)).toHaveLength(1);
    await user.click(screen.getByText("Event details"));
    expect(screen.getAllByText(/Awaiting client feedback/)).toHaveLength(1);
    expect(screen.queryByText(/Outcome: Awaiting client feedback/)).toBeNull();
    // Other metadata still shows up down there.
    expect(screen.getByText("Next action: Wait for Connect Group")).toBeTruthy();
  });

  it("records a typed event with an optimistic precondition", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ application: { updatedAt: "2026-07-24T09:01:00.000Z" } }), { status: 201 }))
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    const { onProjectionUpdated } = renderTimeline();
    const user = userEvent.setup();

    await screen.findByText(/No timeline events yet/);
    await user.click(screen.getByRole("button", { name: "Add a note…" }));
    await user.type(screen.getByLabelText("New stage"), "technical_interview");
    fireEvent.submit(screen.getByRole("button", { name: "Record event" }).closest("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [, request] = fetchMock.mock.calls[1];
    const body = JSON.parse(String((request as RequestInit).body));
    expect(body).toMatchObject({
      type: "stage_changed",
      expectedUpdatedAt: "2026-07-24T08:00:00.000Z",
      metadata: { toStage: "technical_interview" },
    });
    expect(body.idempotencyKey).toMatch(/^ui-/);
    expect(onProjectionUpdated).toHaveBeenCalledWith("2026-07-24T09:01:00.000Z");
  });

  it("does not submit an open event editor after parent edits become dirty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
    );
    const user = userEvent.setup();
    const { rerenderWithDisabled } = renderTimeline();
    await screen.findByText(/No timeline events yet/);
    await user.click(screen.getByRole("button", { name: "Add a note…" }));
    await user.type(screen.getByLabelText("New stage"), "technical_interview");

    rerenderWithDisabled(true);
    fireEvent.submit(screen.getByRole("button", { name: "Record event" }).closest("form")!);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });
});
