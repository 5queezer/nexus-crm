import { describe, expect, it } from "vitest";
import { buildAnalyticsSnapshot } from "../metrics";

type AppInput = Parameters<typeof buildAnalyticsSnapshot>[0][number];
type EventInput = Parameters<typeof buildAnalyticsSnapshot>[1][number];

function application(
  id: string,
  overrides: Partial<AppInput> = {},
): AppInput {
  return {
    id,
    company: `Company ${id}`,
    role: "Engineer",
    status: "rejected",
    source: "linkedin",
    archivedAt: null,
    createdAt: new Date("2026-08-10T12:00:00Z"),
    ...overrides,
  };
}

function event(
  applicationId: string,
  type: string,
  occurredAt: string,
  metadata: Record<string, unknown> = {},
): EventInput {
  return {
    id: `${applicationId}-${type}-${occurredAt}`,
    applicationId,
    type,
    occurredAt: new Date(occurredAt),
    metadata,
  };
}

const filter = {
  start: new Date("2026-08-01T00:00:00Z"),
  end: new Date("2026-08-31T23:59:59.999Z"),
  cutoff: new Date("2026-09-19T12:00:00Z"),
  includeArchived: true,
  source: null,
  timeZone: "UTC",
};

describe("buildAnalyticsSnapshot", () => {
  it("uses event evidence and never treats Lost status as a reply", () => {
    const apps = [
      application("lost-without-reply"),
      application("automatic"),
      application("human", { archivedAt: new Date("2026-09-01T00:00:00Z") }),
      application("new", { status: "inbound" }),
    ];
    const events = [
      event("lost-without-reply", "application_submitted", "2026-08-11T12:00:00Z"),
      event("automatic", "outbound_contact_recorded", "2026-08-12T12:00:00Z"),
      event("automatic", "reply_received", "2026-08-12T13:00:00Z", { responseKind: "automatic" }),
      event("human", "outbound_contact_recorded", "2026-08-13T12:00:00Z"),
      event("human", "reply_received", "2026-08-15T12:00:00Z", { responseKind: "human" }),
    ];

    const result = buildAnalyticsSnapshot(apps, events, filter);

    expect(result.cohort).toMatchObject({ total: 4, archived: 1, contacted: 3 });
    expect(result.replyRate).toMatchObject({ numerator: 1, denominator: 3, percentage: 33 });
    expect(result.replyRate.recordIds).toEqual(["human"]);
    expect(result.medianFirstReplyDays).toMatchObject({ value: 2, sampleCount: 1 });
  });

  it("does not guess the direction of legacy recruiter contact events", () => {
    const apps = [application("ambiguous"), application("outbound")];
    const events = [
      event("ambiguous", "recruiter_contacted", "2026-08-11T12:00:00Z"),
      event("outbound", "recruiter_contacted", "2026-08-11T12:00:00Z", { direction: "outbound" }),
    ];

    const result = buildAnalyticsSnapshot(apps, events, filter);

    expect(result.cohort.contacted).toBe(1);
    expect(result.stages.find((stage) => stage.key === "contacted")?.recordIds).toEqual(["outbound"]);
  });

  it("uses cumulative unique stage evidence without inferring missing history", () => {
    const apps = [
      application("negotiated", { status: "rejected" }),
      application("closing-only", { status: "rejected" }),
      application("status-only", { status: "interview" }),
    ];
    const events = [
      event("negotiated", "application_submitted", "2026-08-11T12:00:00Z"),
      event("negotiated", "stage_changed", "2026-08-14T12:00:00Z", { toStatus: "interview", toStage: "technical" }),
      event("negotiated", "stage_changed", "2026-08-15T12:00:00Z", { toStatus: "interview", toStage: "onsite" }),
      event("closing-only", "application_submitted", "2026-08-11T12:00:00Z"),
      event("closing-only", "offer_received", "2026-08-16T12:00:00Z"),
      event("status-only", "application_submitted", "2026-08-11T12:00:00Z"),
    ];

    const result = buildAnalyticsSnapshot(apps, events, filter);

    expect(result.progressionRate).toMatchObject({ numerator: 1, denominator: 3, percentage: 33 });
    expect(result.stages.map((stage) => [stage.key, stage.count])).toEqual([
      ["added", 3],
      ["contacted", 3],
      ["negotiation", 1],
      ["closing", 1],
    ]);
    expect(result.coverage.stageHistoryGaps).toBe(2);
  });

  it("discloses duration coverage and keeps undated human replies in reply rate", () => {
    const apps = [application("dated"), application("undated"), application("pending")];
    const events = [
      event("dated", "outbound_contact_recorded", "2026-08-10T12:00:00Z"),
      event("dated", "reply_received", "2026-08-14T12:00:00Z", { responseKind: "human" }),
      event("undated", "outbound_contact_recorded", "2026-08-10T12:00:00Z"),
      event("undated", "reply_received", "2026-08-18T12:00:00Z", { responseKind: "human", replyDateKnown: false }),
      event("pending", "outbound_contact_recorded", "2026-08-10T12:00:00Z"),
    ];

    const result = buildAnalyticsSnapshot(apps, events, filter);

    expect(result.replyRate).toMatchObject({ numerator: 2, denominator: 3, percentage: 67 });
    expect(result.medianFirstReplyDays).toMatchObject({ value: 4, sampleCount: 1 });
    expect(result.coverage).toMatchObject({ confirmedReplies: 2, datedReplies: 1, undatedReplies: 1, pendingReplies: 1 });
    expect(result.records.find((record) => record.id === "undated")).toMatchObject({
      confirmedHumanReply: true,
      firstHumanReplyAt: null,
      replyDateKnown: false,
    });
    expect(result.replyTimeDistribution.find((bucket) => bucket.key === "4-7")).toMatchObject({ count: 1, denominator: 1 });
  });

  it("measures reply duration by calendar dates in the selected timezone", () => {
    const apps = [application("same-day"), application("cross-midnight"), application("bucket-boundary")];
    const events = [
      // The DST fallback makes this local day 25 hours long. Both events are still November 1 in Los Angeles.
      event("same-day", "outbound_contact_recorded", "2026-11-01T07:30:00Z"),
      event("same-day", "reply_received", "2026-11-02T07:00:00Z", { responseKind: "human" }),
      // Forty-five elapsed minutes cross a local midnight and therefore count as one calendar day.
      event("cross-midnight", "outbound_contact_recorded", "2026-08-02T06:30:00Z"),
      event("cross-midnight", "reply_received", "2026-08-02T07:15:00Z", { responseKind: "human" }),
      // Just over 72 elapsed hours span four local date boundaries, placing the record in 4–7 days.
      event("bucket-boundary", "outbound_contact_recorded", "2026-08-02T06:30:00Z"),
      event("bucket-boundary", "reply_received", "2026-08-05T07:15:00Z", { responseKind: "human" }),
    ];

    const result = buildAnalyticsSnapshot(apps, events, {
      ...filter,
      start: new Date("2026-01-01T00:00:00Z"),
      end: new Date("2026-12-31T23:59:59.999Z"),
      cutoff: new Date("2026-12-31T23:59:59.999Z"),
      timeZone: "America/Los_Angeles",
    });

    expect(Object.fromEntries(result.records.map((record) => [record.id, record.replyDurationDays]))).toEqual({
      "bucket-boundary": 4,
      "cross-midnight": 1,
      "same-day": 0,
    });
    expect(result.medianFirstReplyDays).toMatchObject({ value: 1, sampleCount: 3 });
    expect(result.replyTimeDistribution.map((bucket) => [bucket.key, bucket.count])).toEqual([
      ["0-3", 2],
      ["4-7", 1],
      ["8-14", 0],
      ["15+", 0],
    ]);
  });

  it("counts one calendar day across 23-hour and 25-hour DST transitions", () => {
    const apps = [application("spring"), application("fall")];
    const events = [
      event("spring", "outbound_contact_recorded", "2026-03-08T08:00:00Z"),
      event("spring", "reply_received", "2026-03-09T07:00:00Z", { responseKind: "human" }),
      event("fall", "outbound_contact_recorded", "2026-11-01T07:00:00Z"),
      event("fall", "reply_received", "2026-11-02T08:00:00Z", { responseKind: "human" }),
    ];

    const result = buildAnalyticsSnapshot(apps, events, {
      ...filter,
      start: new Date("2026-01-01T00:00:00Z"),
      end: new Date("2026-12-31T23:59:59.999Z"),
      cutoff: new Date("2026-12-31T23:59:59.999Z"),
      timeZone: "America/Los_Angeles",
    });

    expect(Object.fromEntries(result.records.map((record) => [record.id, record.replyDurationDays]))).toEqual({
      fall: 1,
      spring: 1,
    });
  });

  it("filters one created-at cohort, archived records, source, and cutoff consistently", () => {
    const apps = [
      application("included", { source: "LinkedIn recruiter" }),
      application("archived", { source: "linkedin", archivedAt: new Date("2026-08-20T00:00:00Z") }),
      application("other-source", { source: "referral" }),
      application("too-old", { createdAt: new Date("2026-07-31T23:59:59Z") }),
    ];
    const events = [
      event("included", "outbound_contact_recorded", "2026-08-11T12:00:00Z"),
      event("included", "reply_received", "2026-09-20T12:00:00Z", { responseKind: "human" }),
      event("archived", "outbound_contact_recorded", "2026-08-11T12:00:00Z"),
      event("other-source", "outbound_contact_recorded", "2026-08-11T12:00:00Z"),
    ];

    const result = buildAnalyticsSnapshot(apps, events, {
      ...filter,
      includeArchived: false,
      source: "linkedin",
    });

    expect(result.cohort).toMatchObject({ total: 1, archived: 0, contacted: 1 });
    expect(result.replyRate).toMatchObject({ numerator: 0, denominator: 1, percentage: 0 });
    expect(result.records.map((record) => record.id)).toEqual(["included"]);
  });

  it("returns no percentage when the contacted denominator is zero", () => {
    const result = buildAnalyticsSnapshot([application("new", { status: "rejected" })], [], filter);

    expect(result.replyRate).toMatchObject({ numerator: 0, denominator: 0, percentage: null });
    expect(result.progressionRate).toMatchObject({ numerator: 0, denominator: 0, percentage: null });
    expect(result.medianFirstReplyDays.value).toBeNull();
  });
});
