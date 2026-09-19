import type { ApplicationRecord, ApplicationEventRecord } from "@/lib/db/types";
import { getSourceCategory } from "@/types";

const DAY_MS = 86_400_000;

/**
 * Analytics evidence migration policy:
 * - Existing application_submitted events are valid outbound-contact evidence.
 * - Legacy recruiter_contacted events remain unknown unless metadata.direction is outbound.
 * - Status, appliedAt, and lastContact never backfill human replies or reply dates.
 * New evidence is recorded through outbound_contact_recorded and reply_received; the
 * existing string/JSON event store accepts both without a destructive data migration.
 */

export type AnalyticsApplication = Pick<
  ApplicationRecord,
  "id" | "company" | "role" | "status" | "source" | "archivedAt" | "createdAt"
>;

export type AnalyticsEvent = Pick<
  ApplicationEventRecord,
  "id" | "applicationId" | "type" | "occurredAt" | "metadata"
>;

export interface AnalyticsFilter {
  start: Date;
  end: Date;
  cutoff: Date;
  includeArchived: boolean;
  source: string | null;
}

export interface AnalyticsMetric {
  numerator: number;
  denominator: number;
  percentage: number | null;
  recordIds: string[];
}

export interface AnalyticsStage {
  key: "added" | "contacted" | "negotiation" | "closing";
  label: string;
  count: number;
  denominator: number;
  percentage: number | null;
  recordIds: string[];
}

export interface AnalyticsRecord {
  id: string;
  company: string;
  role: string;
  status: string;
  source: string;
  archived: boolean;
  addedAt: string;
  firstContactAt: string | null;
  confirmedHumanReply: boolean;
  firstHumanReplyAt: string | null;
  replyDateKnown: boolean;
  reachedNegotiationAt: string | null;
  reachedClosingAt: string | null;
  replyDurationDays: number | null;
  stageHistoryGap: boolean;
}

export interface AnalyticsSourceComparison {
  source: string;
  cohort: number;
  contacted: number;
  replied: number;
  negotiation: number;
  progressionPercentage: number | null;
  recordIds: {
    all: string[];
    contacted: string[];
    replied: string[];
    negotiation: string[];
  };
}

export interface AnalyticsSnapshot {
  cohort: { total: number; archived: number; active: number; contacted: number };
  replyRate: AnalyticsMetric;
  progressionRate: AnalyticsMetric;
  medianFirstReplyDays: { value: number | null; sampleCount: number; recordIds: string[] };
  stages: AnalyticsStage[];
  replyTimeDistribution: Array<{
    key: "0-3" | "4-7" | "8-14" | "15+";
    label: string;
    count: number;
    denominator: number;
    percentage: number | null;
    recordIds: string[];
  }>;
  sources: AnalyticsSourceComparison[];
  coverage: {
    confirmedReplies: number;
    datedReplies: number;
    undatedReplies: number;
    pendingReplies: number;
    invalidDatePairs: number;
    stageHistoryGaps: number;
  };
  records: AnalyticsRecord[];
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100);
}

function metadataString(event: AnalyticsEvent, key: string): string | null {
  const value = event.metadata?.[key];
  return typeof value === "string" ? value : null;
}

function isOutboundContact(event: AnalyticsEvent): boolean {
  if (event.type === "application_submitted" || event.type === "outbound_contact_recorded") {
    return true;
  }
  return event.type === "recruiter_contacted" && metadataString(event, "direction") === "outbound";
}

function isHumanReply(event: AnalyticsEvent): boolean {
  return event.type === "reply_received" && metadataString(event, "responseKind") === "human";
}

function isNegotiation(event: AnalyticsEvent): boolean {
  if (["interview_invited", "interview_scheduled", "interview_completed"].includes(event.type)) {
    return true;
  }
  if (event.type !== "stage_changed") return false;
  if (metadataString(event, "toStatus") === "interview") return true;
  const stage = metadataString(event, "toStage")?.toLowerCase() ?? "";
  return /interview|screen|technical|onsite|negotiat/.test(stage);
}

function isClosing(event: AnalyticsEvent): boolean {
  return event.type === "offer_received"
    || (event.type === "stage_changed" && metadataString(event, "toStatus") === "offer");
}

function first(events: AnalyticsEvent[], predicate: (event: AnalyticsEvent) => boolean) {
  return events.find(predicate) ?? null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function metric(recordIds: string[], denominator: number): AnalyticsMetric {
  return {
    numerator: recordIds.length,
    denominator,
    percentage: percentage(recordIds.length, denominator),
    recordIds,
  };
}

export function buildAnalyticsSnapshot(
  applications: readonly AnalyticsApplication[],
  events: readonly AnalyticsEvent[],
  filter: AnalyticsFilter,
): AnalyticsSnapshot {
  const cohort = applications
    .filter((application) => application.createdAt >= filter.start && application.createdAt <= filter.end)
    .filter((application) => filter.includeArchived || application.archivedAt === null)
    .filter((application) => filter.source === null || getSourceCategory(application.source) === filter.source);
  const cohortIds = new Set(cohort.map((application) => application.id));
  const evidence = events
    .filter((event) => cohortIds.has(event.applicationId) && event.occurredAt <= filter.cutoff)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const eventsByApplication = new Map<string, AnalyticsEvent[]>();
  for (const event of evidence) {
    const group = eventsByApplication.get(event.applicationId) ?? [];
    group.push(event);
    eventsByApplication.set(event.applicationId, group);
  }

  const records: AnalyticsRecord[] = cohort.map((application) => {
    const recordEvents = eventsByApplication.get(application.id) ?? [];
    const contact = first(recordEvents, isOutboundContact);
    const reply = first(recordEvents, isHumanReply);
    const negotiation = first(recordEvents, isNegotiation);
    const closing = first(recordEvents, isClosing);
    const replyDateKnown = reply ? reply.metadata?.replyDateKnown !== false : false;
    const duration = contact && reply && replyDateKnown && reply.occurredAt >= contact.occurredAt
      ? Math.round((reply.occurredAt.getTime() - contact.occurredAt.getTime()) / DAY_MS)
      : null;
    const statusSuggestsProgress = application.status === "interview" || application.status === "offer";
    const stageHistoryGap = !negotiation && (statusSuggestsProgress || closing !== null);
    return {
      id: application.id,
      company: application.company,
      role: application.role,
      status: application.status,
      source: getSourceCategory(application.source),
      archived: application.archivedAt !== null,
      addedAt: application.createdAt.toISOString(),
      firstContactAt: contact?.occurredAt.toISOString() ?? null,
      confirmedHumanReply: reply !== null,
      firstHumanReplyAt: reply && replyDateKnown ? reply.occurredAt.toISOString() : null,
      replyDateKnown,
      reachedNegotiationAt: negotiation?.occurredAt.toISOString() ?? null,
      reachedClosingAt: closing?.occurredAt.toISOString() ?? null,
      replyDurationDays: duration,
      stageHistoryGap,
    };
  }).sort((a, b) => b.addedAt.localeCompare(a.addedAt));

  const contacted = records.filter((record) => record.firstContactAt !== null);
  const replied = contacted.filter((record) => record.confirmedHumanReply);
  const progressed = contacted.filter((record) => record.reachedNegotiationAt !== null);
  const timed = replied.filter((record) => record.replyDurationDays !== null);
  const repliedIds = new Set(replied.map((record) => record.id));
  const invalidDatePairs = replied.filter((record) => {
    if (!record.replyDateKnown || !record.firstContactAt) return false;
    const reply = first(eventsByApplication.get(record.id) ?? [], isHumanReply);
    return Boolean(reply && reply.occurredAt < new Date(record.firstContactAt));
  }).length;

  const stageInputs: Array<[AnalyticsStage["key"], string, AnalyticsRecord[]]> = [
    ["added", "Added to pipeline", records],
    ["contacted", "Contacted", contacted],
    ["negotiation", "Negotiation", records.filter((record) => record.reachedNegotiationAt !== null)],
    ["closing", "Closing", records.filter((record) => record.reachedClosingAt !== null)],
  ];
  const stages = stageInputs.map(([key, label, stageRecords]) => ({
    key,
    label,
    count: stageRecords.length,
    denominator: records.length,
    percentage: percentage(stageRecords.length, records.length),
    recordIds: stageRecords.map((record) => record.id),
  }));

  const bucketDefinitions = [
    { key: "0-3" as const, label: "0–3 days", matches: (days: number) => days <= 3 },
    { key: "4-7" as const, label: "4–7 days", matches: (days: number) => days >= 4 && days <= 7 },
    { key: "8-14" as const, label: "8–14 days", matches: (days: number) => days >= 8 && days <= 14 },
    { key: "15+" as const, label: "15+ days", matches: (days: number) => days >= 15 },
  ];
  const replyTimeDistribution = bucketDefinitions.map((bucket) => {
    const bucketRecords = timed.filter((record) => bucket.matches(record.replyDurationDays!));
    return {
      key: bucket.key,
      label: bucket.label,
      count: bucketRecords.length,
      denominator: timed.length,
      percentage: percentage(bucketRecords.length, timed.length),
      recordIds: bucketRecords.map((record) => record.id),
    };
  });

  const sourceNames = [...new Set(records.map((record) => record.source))];
  const sources = sourceNames.map((source): AnalyticsSourceComparison => {
    const sourceRecords = records.filter((record) => record.source === source);
    const sourceContacted = sourceRecords.filter((record) => record.firstContactAt !== null);
    const sourceReplied = sourceContacted.filter((record) => repliedIds.has(record.id));
    const sourceProgressed = sourceContacted.filter((record) => record.reachedNegotiationAt !== null);
    return {
      source,
      cohort: sourceRecords.length,
      contacted: sourceContacted.length,
      replied: sourceReplied.length,
      negotiation: sourceProgressed.length,
      progressionPercentage: percentage(sourceProgressed.length, sourceContacted.length),
      recordIds: {
        all: sourceRecords.map((record) => record.id),
        contacted: sourceContacted.map((record) => record.id),
        replied: sourceReplied.map((record) => record.id),
        negotiation: sourceProgressed.map((record) => record.id),
      },
    };
  }).sort((a, b) => b.contacted - a.contacted || a.source.localeCompare(b.source));

  return {
    cohort: {
      total: records.length,
      archived: records.filter((record) => record.archived).length,
      active: records.filter((record) => !record.archived).length,
      contacted: contacted.length,
    },
    replyRate: metric(replied.map((record) => record.id), contacted.length),
    progressionRate: metric(progressed.map((record) => record.id), contacted.length),
    medianFirstReplyDays: {
      value: median(timed.map((record) => record.replyDurationDays!)),
      sampleCount: timed.length,
      recordIds: timed.map((record) => record.id),
    },
    stages,
    replyTimeDistribution,
    sources,
    coverage: {
      confirmedReplies: replied.length,
      datedReplies: timed.length,
      undatedReplies: replied.filter((record) => !record.replyDateKnown).length,
      pendingReplies: contacted.length - replied.length,
      invalidDatePairs,
      stageHistoryGaps: records.filter((record) => record.stageHistoryGap).length,
    },
    records,
  };
}
