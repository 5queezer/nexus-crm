// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/types";
import { NowBanner } from "../application-detail/now-banner";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

function fixture(overrides: Partial<Application> = {}): Application {
  return {
    id: "application-1",
    company: "Acme",
    role: "Engineer",
    status: "applied",
    appliedAt: null,
    lastContact: null,
    followUpAt: null,
    notes: null,
    jobDescription: null,
    source: null,
    remote: false,
    salaryMin: null,
    salaryMax: null,
    rating: null,
    jobUrl: null,
    resumeId: null,
    companySize: null,
    salaryBandMentioned: false,
    triageQuality: null,
    triageReason: null,
    incomingSource: null,
    autoRejected: false,
    autoRejectReason: null,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    contacts: [],
    ...overrides,
  };
}

/** Date-only fields are persisted as UTC midnight by the application API. */
function calendarDay(offsetDays: number): string {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, "0")}T00:00:00.000Z`;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NowBanner", () => {
  it("does not call a reminder due today overdue", async () => {
    render(<NowBanner application={fixture({ followUpAt: calendarDay(0) })} statusLabel="applied" />);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText("follow_up_pending")).toBeTruthy();
    expect(screen.queryByText("follow_up_overdue")).toBeNull();
  });

  it("calls a reminder from a previous day overdue", async () => {
    render(<NowBanner application={fixture({ followUpAt: calendarDay(-1) })} statusLabel="applied" />);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText("follow_up_overdue")).toBeTruthy();
  });

  it("falls back to the status label and says when nothing is scheduled", async () => {
    render(<NowBanner application={fixture()} statusLabel="applied" />);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByRole("heading", { name: "applied" })).toBeTruthy();
    expect(screen.getByText("no_follow_up")).toBeTruthy();
  });

  it("prefers the recorded stage over the status label", async () => {
    render(
      <NowBanner
        application={fixture({ currentStage: "Awaiting client feedback" })}
        statusLabel="applied"
      />,
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByRole("heading", { name: "Awaiting client feedback" })).toBeTruthy();
  });
});
