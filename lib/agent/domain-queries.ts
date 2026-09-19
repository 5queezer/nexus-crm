import { decodeEventCursor } from "@/lib/applications/events";
import { buildAnalyticsSnapshot } from "@/lib/analytics/metrics";
import { getDb } from "@/lib/db";
import type { DatabaseAdapter } from "@/lib/db/adapter";
import type { ApplicationEventRecord } from "@/lib/db/types";
import { prisma } from "@/lib/prisma";

const DEFAULT_LIMIT = 20;
export const DOMAIN_QUERY_MAX_LIMIT = 50;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REVIEW_STATUSES = ["pending", "imported", "dismissed"] as const;
const ANALYTICS_EVENT_TYPES = [
  "application_submitted",
  "recruiter_contacted",
  "outbound_contact_recorded",
  "reply_received",
  "stage_changed",
  "interview_invited",
  "interview_scheduled",
  "interview_completed",
  "offer_received",
] as const;

export type EmailReviewStatus = (typeof EMAIL_REVIEW_STATUSES)[number];

interface EmailReviewRow {
  id: number;
  subject: string;
  sender: string;
  receivedAt: Date;
  classification: string | null;
  confidence: string;
  status: string;
  applicationId: number | null;
  createdAt: Date;
}

interface EmailReviewStore {
  count(args: { where: { userId: string; status?: EmailReviewStatus } }): Promise<number>;
  findMany(args: {
    where: { userId: string; status?: EmailReviewStatus };
    orderBy: { receivedAt: "desc" };
    take: number;
    select: {
      id: true;
      subject: true;
      sender: true;
      receivedAt: true;
      classification: true;
      confidence: true;
      status: true;
      applicationId: true;
      createdAt: true;
    };
  }): Promise<EmailReviewRow[]>;
}

type DomainQueryDb = Pick<
  DatabaseAdapter,
  "listApplications" | "listApplicationEventsFiltered" | "listDocuments"
>;

export interface DomainQueryDependencies {
  db: DomainQueryDb;
  emailReview: EmailReviewStore;
}

const defaultEmailReview: EmailReviewStore = {
  count: (args) => prisma.scannedEmail.count(args),
  findMany: (args) => prisma.scannedEmail.findMany(args),
};

function ownerId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("owner_user_id_required");
  return normalized;
}

function boundedLimit(value?: number): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value <= 0) throw new Error("domain_query_limit_invalid");
  return Math.min(value, DOMAIN_QUERY_MAX_LIMIT);
}

function dateOnly(value: string, endOfDay = false): Date {
  if (!DATE_PATTERN.test(value)) throw new Error("analytics_filter_invalid");
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("analytics_filter_invalid");
  }
  return date;
}

async function listAnalyticsEvents(
  db: DomainQueryDb,
  userId: string,
  cutoff: Date,
): Promise<ApplicationEventRecord[]> {
  const items: ApplicationEventRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: ReturnType<typeof decodeEventCursor> | undefined;
  do {
    const page = await db.listApplicationEventsFiltered(userId, {
      types: [...ANALYTICS_EVENT_TYPES],
      occurredBefore: cutoff,
      order: "oldest",
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    if (!page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) throw new Error("analytics_event_cursor_repeated");
    seenCursors.add(page.nextCursor);
    cursor = decodeEventCursor(page.nextCursor);
  } while (cursor);
  return items;
}

export interface OwnerAnalyticsQuery {
  start: string;
  end: string;
  cutoff: Date;
  source?: string | null;
  includeArchived?: boolean;
}

export async function queryOwnerAnalytics(
  userId: string,
  input: OwnerAnalyticsQuery,
  overrides?: Partial<DomainQueryDependencies>,
) {
  const owner = ownerId(userId);
  const start = dateOnly(input.start);
  const end = dateOnly(input.end, true);
  const cutoff = new Date(input.cutoff);
  if (start > end || Number.isNaN(cutoff.getTime())) throw new Error("analytics_filter_invalid");
  const source = input.source?.trim() || null;
  if (source && source.length > 255) throw new Error("analytics_filter_invalid");
  const includeArchived = input.includeArchived !== false;
  const db = overrides?.db ?? getDb();
  const [applications, events] = await Promise.all([
    db.listApplications(owner),
    listAnalyticsEvents(db, owner, cutoff),
  ]);
  const snapshot = buildAnalyticsSnapshot(applications, events, {
    start,
    end,
    cutoff,
    source,
    includeArchived,
  });
  return {
    filters: {
      start: input.start,
      end: input.end,
      cutoff: cutoff.toISOString(),
      source,
      includeArchived,
    },
    cohort: snapshot.cohort,
    replyRate: {
      numerator: snapshot.replyRate.numerator,
      denominator: snapshot.replyRate.denominator,
      percentage: snapshot.replyRate.percentage,
    },
    progressionRate: {
      numerator: snapshot.progressionRate.numerator,
      denominator: snapshot.progressionRate.denominator,
      percentage: snapshot.progressionRate.percentage,
    },
    medianFirstReplyDays: {
      value: snapshot.medianFirstReplyDays.value,
      sampleCount: snapshot.medianFirstReplyDays.sampleCount,
    },
    stages: snapshot.stages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      count: stage.count,
      denominator: stage.denominator,
      percentage: stage.percentage,
    })),
    replyTimeDistribution: snapshot.replyTimeDistribution.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      count: bucket.count,
      denominator: bucket.denominator,
      percentage: bucket.percentage,
    })),
    sources: snapshot.sources.map((sourceRow) => ({
      source: sourceRow.source,
      cohort: sourceRow.cohort,
      contacted: sourceRow.contacted,
      replied: sourceRow.replied,
      negotiation: sourceRow.negotiation,
      progressionPercentage: sourceRow.progressionPercentage,
    })),
    coverage: snapshot.coverage,
    evidencePolicy: {
      contact: "application_submitted or explicit outbound contact event",
      reply: "reply_received with responseKind=human; automatic acknowledgments and status-only changes excluded",
      duration: "first dated outbound contact to first dated human reply; unknown and invalid dates excluded",
      progression: "unique contacted opportunities with Negotiation event evidence",
    },
  };
}

export interface OwnerDocumentsQuery {
  limit?: number;
  search?: string;
  documentType?: string;
  state?: string;
  unlinked?: boolean;
}

export async function queryOwnerDocuments(
  userId: string,
  input: OwnerDocumentsQuery,
  overrides?: Partial<DomainQueryDependencies>,
) {
  const owner = ownerId(userId);
  const limit = boundedLimit(input.limit);
  const db = overrides?.db ?? getDb();
  const search = input.search?.trim().toLocaleLowerCase() ?? "";
  const documents = (await db.listDocuments(owner))
    .filter((document) => !input.documentType || document.documentType === input.documentType)
    .filter((document) => !input.state || document.state === input.state)
    .filter((document) => input.unlinked === undefined
      || (input.unlinked ? !(document.applicationIds?.length || document.applications?.length) : Boolean(document.applicationIds?.length || document.applications?.length)))
    .filter((document) => !search || document.originalName.toLocaleLowerCase().includes(search))
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  const items = documents.slice(0, limit).map((document) => ({
    id: document.id,
    originalName: document.originalName,
    size: document.size,
    mimeType: document.mimeType,
    documentType: document.documentType,
    state: document.state,
    version: document.version,
    source: document.source,
    uploadedAt: document.uploadedAt.toISOString(),
    linkedApplicationIds: document.applicationIds ?? document.applications?.map((application) => application.id) ?? [],
  }));
  return {
    items,
    totalCount: documents.length,
    returnedCount: items.length,
    limit,
    truncated: documents.length > items.length,
    contentTrust: "untrusted_user_metadata" as const,
  };
}

export interface OwnerEmailReviewQuery {
  limit?: number;
  status?: EmailReviewStatus;
}

export async function queryOwnerEmailReview(
  userId: string,
  input: OwnerEmailReviewQuery,
  overrides?: Partial<DomainQueryDependencies>,
) {
  const owner = ownerId(userId);
  const limit = boundedLimit(input.limit);
  if (input.status && !EMAIL_REVIEW_STATUSES.includes(input.status)) {
    throw new Error("email_review_status_invalid");
  }
  const emailReview = overrides?.emailReview ?? defaultEmailReview;
  const where = { userId: owner, ...(input.status ? { status: input.status } : {}) };
  const [totalCount, rows] = await Promise.all([
    emailReview.count({ where }),
    emailReview.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit,
      select: {
        id: true,
        subject: true,
        sender: true,
        receivedAt: true,
        classification: true,
        confidence: true,
        status: true,
        applicationId: true,
        createdAt: true,
      },
    }),
  ]);
  const items = rows.map((row) => ({
    id: String(row.id),
    subject: row.subject,
    sender: row.sender,
    receivedAt: row.receivedAt.toISOString(),
    classification: row.classification,
    confidence: row.confidence,
    status: row.status,
    applicationId: row.applicationId === null ? null : String(row.applicationId),
    createdAt: row.createdAt.toISOString(),
  }));
  return {
    items,
    totalCount,
    returnedCount: items.length,
    limit,
    truncated: totalCount > items.length,
    contentTrust: "untrusted_external_metadata" as const,
  };
}
