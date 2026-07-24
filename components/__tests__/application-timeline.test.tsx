// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { ApplicationTimeline } from "../application-timeline";

function renderTimeline(onProjectionUpdated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <ApplicationTimeline
          applicationId="42"
          expectedUpdatedAt="2026-07-24T08:00:00.000Z"
          onProjectionUpdated={onProjectionUpdated}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return onProjectionUpdated;
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

  it("records a typed event with an optimistic precondition", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ application: { updatedAt: "2026-07-24T09:01:00.000Z" } }), { status: 201 }))
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    const onProjectionUpdated = renderTimeline();
    const user = userEvent.setup();

    await screen.findByText(/No timeline events yet/);
    await user.click(screen.getByRole("button", { name: "Record activity" }));
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
});
