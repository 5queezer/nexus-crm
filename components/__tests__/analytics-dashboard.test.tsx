// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import deMessages from "../../messages/de.json";

vi.mock("../app-header", () => ({ AppHeader: () => <header>Header</header> }));

import { AnalyticsDashboard } from "../analytics-dashboard";

const snapshot = {
  filters: {
    start: "2026-06-22",
    end: "2026-09-19",
    cutoff: "2026-09-19T12:00:00.000Z",
    source: null,
    includeArchived: true,
    timeZone: "America/Los_Angeles",
  },
  cohort: { total: 4, archived: 2, active: 2, contacted: 3 },
  replyRate: { numerator: 1, denominator: 3, percentage: 33, recordIds: ["1"] },
  progressionRate: { numerator: 1, denominator: 3, percentage: 33, recordIds: ["1"] },
  medianFirstReplyDays: { value: 4, sampleCount: 1, recordIds: ["1"] },
  stages: [
    { key: "added", label: "Added to pipeline", count: 4, denominator: 4, percentage: 100, recordIds: ["1", "2", "3", "4"] },
    { key: "contacted", label: "Contacted", count: 3, denominator: 4, percentage: 75, recordIds: ["1", "2", "3"] },
    { key: "negotiation", label: "Negotiation", count: 1, denominator: 4, percentage: 25, recordIds: ["1"] },
    { key: "closing", label: "Closing", count: 0, denominator: 4, percentage: 0, recordIds: [] },
  ],
  replyTimeDistribution: [
    { key: "0-3", label: "0–3 days", count: 0, denominator: 1, percentage: 0, recordIds: [] },
    { key: "4-7", label: "4–7 days", count: 1, denominator: 1, percentage: 100, recordIds: ["1"] },
    { key: "8-14", label: "8–14 days", count: 0, denominator: 1, percentage: 0, recordIds: [] },
    { key: "15+", label: "15+ days", count: 0, denominator: 1, percentage: 0, recordIds: [] },
  ],
  sources: [{
    source: "linkedin",
    cohort: 4,
    contacted: 3,
    replied: 1,
    negotiation: 1,
    progressionPercentage: 33,
    recordIds: { all: ["1", "2", "3", "4"], contacted: ["1", "2", "3"], replied: ["1"], negotiation: ["1"] },
  }],
  coverage: { confirmedReplies: 1, datedReplies: 1, undatedReplies: 0, pendingReplies: 2, invalidDatePairs: 0, stageHistoryGaps: 1 },
  records: [{
    id: "1",
    company: "Acme",
    role: "Engineer",
    status: "interview",
    source: "linkedin",
    archived: true,
    addedAt: "2026-08-10T12:00:00.000Z",
    firstContactAt: "2026-08-11T12:00:00.000Z",
    confirmedHumanReply: true,
    firstHumanReplyAt: "2026-08-15T12:00:00.000Z",
    replyDateKnown: true,
    reachedNegotiationAt: "2026-08-16T12:00:00.000Z",
    reachedClosingAt: null,
    replyDurationDays: 4,
    stageHistoryGap: false,
  }],
};

const user = { email: "owner@example.com", name: "Owner", image: null, isAdmin: false };

function renderDashboard(locale = "en") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "de" ? deMessages : messages}>
      <QueryClientProvider client={queryClient}>
        <AnalyticsDashboard user={user} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("AnalyticsDashboard", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("shows one explicit cohort and evidence-based headline metrics", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(snapshot), { status: 200 }),
    );
    renderDashboard();

    expect(await screen.findByText("4 opportunities · 2 archived · 3 contacted")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reply rate/ }).textContent).toContain("1 of 3 contacted");
    expect(screen.getByRole("button", { name: /Median first reply/ }).textContent).toContain("4 days");
    expect(String(fetchMock.mock.calls[0][0])).toContain("includeArchived=true");
    expect(new URL(String(fetchMock.mock.calls[0][0]), "http://localhost").searchParams.get("timeZone"))
      .toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(screen.getByText(/America\/Los_Angeles/)).toBeTruthy();
  });

  it("renders selected calendar dates without shifting them to the preceding day", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(snapshot), { status: 200 }),
    );

    renderDashboard();

    expect(await screen.findByText(/Added Jun 22, 2026 – Sep 19, 2026/)).toBeTruthy();
  });

  it("excludes archived records only when the user turns the default off", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(snapshot), { status: 200 }),
    );
    const ui = userEvent.setup();
    renderDashboard();
    const checkbox = await screen.findByRole("checkbox", { name: "Include archived" });

    await ui.click(checkbox);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain("includeArchived=false");
  });

  it("opens the exact records behind a metric", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    const ui = userEvent.setup();
    renderDashboard();

    await ui.click(await screen.findByRole("button", { name: /Reply rate/ }));

    expect(screen.getByRole("heading", { name: "Confirmed human replies" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Acme — Engineer" }).getAttribute("href")).toBe("/applications/1");
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  it("shows no data for a zero denominator instead of inventing a percentage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ...snapshot,
      cohort: { total: 1, archived: 0, active: 1, contacted: 0 },
      replyRate: { numerator: 0, denominator: 0, percentage: null, recordIds: [] },
      progressionRate: { numerator: 0, denominator: 0, percentage: null, recordIds: [] },
      medianFirstReplyDays: { value: null, sampleCount: 0, recordIds: [] },
    }), { status: 200 }));
    renderDashboard();

    const replyRate = await screen.findByRole("button", { name: /Reply rate/ });
    expect(replyRate.textContent).toContain("No data");
    expect(replyRate.textContent).not.toContain("0%");
  });

  it("renders the redesigned analytics copy in German", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    renderDashboard("de");

    expect(await screen.findByRole("heading", { name: "Auswertungen" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Archivierte einbeziehen" })).toBeTruthy();
    expect((await screen.findByRole("button", { name: /Antwortquote/ })).textContent).toContain("1 von 3 kontaktiert");
  });
});
