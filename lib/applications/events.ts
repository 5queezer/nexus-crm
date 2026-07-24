import type { ApplicationStatus } from "@/types";

export const APPLICATION_EVENT_TYPES = [
  "opportunity_discovered",
  "application_submitted",
  "recruiter_contacted",
  "stage_changed",
  "interview_invited",
  "interview_scheduled",
  "interview_completed",
  "feedback_received",
  "follow_up_scheduled",
  "offer_received",
  "application_rejected",
  "document_attached",
  "note_added",
] as const;

export const RECORDABLE_APPLICATION_EVENT_TYPES = [
  "opportunity_discovered",
  "recruiter_contacted",
  "stage_changed",
  "interview_invited",
  "interview_scheduled",
  "interview_completed",
  "feedback_received",
  "follow_up_scheduled",
  "offer_received",
  "application_rejected",
  "document_attached",
  "note_added",
] as const;

export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number];
export type EventOrder = "newest" | "oldest";

const EVENT_TYPE_SET = new Set<string>(APPLICATION_EVENT_TYPES);
const STATUS_SET = new Set<ApplicationStatus>([
  "inbound",
  "applied",
  "interview",
  "offer",
  "rejected",
]);

const COMMON_KEYS = ["contactId", "outcome", "nextAction"] as const;
const EVENT_KEYS: Record<ApplicationEventType, readonly string[]> = {
  opportunity_discovered: ["channel", "nextAction"],
  application_submitted: [
    "submissionId",
    "documentIds",
    "answerCount",
    "policy",
    "followUpAt",
  ],
  recruiter_contacted: [
    ...COMMON_KEYS,
    "channel",
    "followUpAt",
    "toStage",
  ],
  stage_changed: ["fromStage", "toStage", "fromStatus", "toStatus"],
  interview_invited: [
    ...COMMON_KEYS,
    "interviewType",
    "scheduledAt",
    "durationMinutes",
    "followUpAt",
    "toStage",
  ],
  interview_scheduled: [
    ...COMMON_KEYS,
    "interviewType",
    "scheduledAt",
    "durationMinutes",
    "toStage",
  ],
  interview_completed: [
    ...COMMON_KEYS,
    "interviewType",
    "followUpAt",
    "toStage",
  ],
  feedback_received: [...COMMON_KEYS, "followUpAt", "toStage"],
  follow_up_scheduled: ["contactId", "followUpAt", "nextAction"],
  offer_received: [...COMMON_KEYS, "followUpAt"],
  application_rejected: ["contactId", "outcome", "reason", "fromStage"],
  document_attached: ["documentId", "documentType"],
  note_added: ["note"],
};

const ISO_KEYS = new Set(["scheduledAt", "followUpAt"]);
const ARRAY_KEYS = new Set(["documentIds"]);
const INTEGER_KEYS = new Set(["durationMinutes", "answerCount"]);
const OBJECT_KEYS = new Set(["policy"]);

export interface ApplicationEventCommandInput {
  type: unknown;
  occurredAt?: unknown;
  idempotencyKey?: unknown;
  expectedUpdatedAt?: unknown;
  source?: unknown;
  actor?: unknown;
  metadata?: unknown;
}

export interface ParsedApplicationEventCommand {
  type: ApplicationEventType;
  occurredAt: Date;
  idempotencyKey?: string;
  expectedUpdatedAt?: Date;
  source: string | null;
  actor: string | null;
  metadata: Record<string, unknown>;
  contactId: string | null;
  outcome: string | null;
}

export interface EventProjectionApplication {
  status: string;
  currentStage: string | null;
  followUpAt: Date | null;
}

export interface EventProjectionPatch {
  status?: ApplicationStatus;
  currentStage?: string | null;
  appliedAt?: Date | null;
  lastContact?: Date | null;
  followUpAt?: Date | null;
}

export interface EventCursor {
  version: 1;
  occurredAt: string;
  id: string;
}

export interface ParsedEventQuery {
  applicationId?: string;
  company?: string;
  types?: ApplicationEventType[];
  occurredAfter?: Date;
  occurredBefore?: Date;
  source?: string;
  actor?: string;
  contactId?: string;
  outcome?: string;
  cursor?: EventCursor;
  order: EventOrder;
  limit: number;
}

function invalidMetadata(): never {
  throw new Error("event_metadata_invalid");
}

function parseDate(value: unknown, errorCode: string): Date {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new Error(errorCode);
  }
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(errorCode);
  return date;
}

function optionalString(
  value: unknown,
  maxLength = 255,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") invalidMetadata();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) invalidMetadata();
  return normalized;
}

function parseMetadata(
  type: ApplicationEventType,
  value: unknown,
): Record<string, unknown> {
  if (value === undefined || value === null) value = {};
  if (typeof value !== "object" || Array.isArray(value)) invalidMetadata();
  const raw = value as Record<string, unknown>;
  const entries = Object.entries(raw);
  if (entries.length > 100 || entries.some(([key]) => !key || key.length > 100)) {
    invalidMetadata();
  }
  const allowed = new Set(EVENT_KEYS[type]);
  if (entries.some(([key]) => !allowed.has(key))) invalidMetadata();

  const metadata: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    if (item === undefined || item === null || item === "") continue;
    if (ISO_KEYS.has(key)) {
      metadata[key] = parseDate(item, "event_metadata_invalid").toISOString();
      continue;
    }
    if (ARRAY_KEYS.has(key)) {
      if (!Array.isArray(item) || item.length > 20) invalidMetadata();
      const values = item.map((entry) => optionalString(entry));
      if (values.some((entry) => entry === null)) invalidMetadata();
      metadata[key] = values;
      continue;
    }
    if (INTEGER_KEYS.has(key)) {
      if (!Number.isInteger(item)) invalidMetadata();
      const number = item as number;
      const max = key === "durationMinutes" ? 1_440 : 50;
      const min = key === "durationMinutes" ? 1 : 0;
      if (number < min || number > max) invalidMetadata();
      metadata[key] = number;
      continue;
    }
    if (OBJECT_KEYS.has(key)) {
      if (typeof item !== "object" || Array.isArray(item)) invalidMetadata();
      metadata[key] = item;
      continue;
    }
    if (key === "toStatus" || key === "fromStatus") {
      const status = optionalString(item) as ApplicationStatus | null;
      if (!status || !STATUS_SET.has(status)) invalidMetadata();
      metadata[key] = status;
      continue;
    }
    const maxLength = key === "note" ? 5_000 : key === "reason" || key === "nextAction" ? 2_000 : 255;
    const normalized = optionalString(item, maxLength);
    if (normalized !== null) metadata[key] = normalized;
  }

  const required: Partial<Record<ApplicationEventType, readonly string[]>> = {
    stage_changed: ["toStage"],
    interview_scheduled: ["interviewType", "scheduledAt"],
    follow_up_scheduled: ["followUpAt"],
    document_attached: ["documentId"],
    note_added: ["note"],
  };
  if (required[type]?.some((key) => metadata[key] === undefined)) {
    invalidMetadata();
  }
  if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > 32_000) {
    throw new Error("event_metadata_too_large");
  }
  return metadata;
}

export function parseApplicationEventCommand(
  input: ApplicationEventCommandInput,
): ParsedApplicationEventCommand {
  const rawType = typeof input.type === "string" ? input.type.trim() : "";
  if (!EVENT_TYPE_SET.has(rawType)) throw new Error("event_type_invalid");
  const type = rawType as ApplicationEventType;

  const idempotencyKey = input.idempotencyKey == null
    ? undefined
    : typeof input.idempotencyKey === "string"
      ? input.idempotencyKey.trim()
      : "";
  if (idempotencyKey !== undefined && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
    throw new Error("idempotency_key_invalid");
  }
  if (idempotencyKey && input.occurredAt == null) {
    throw new Error("occurred_at_required_for_idempotency");
  }

  const occurredAt = input.occurredAt == null
    ? new Date()
    : parseDate(input.occurredAt, "event_occurred_at_invalid");
  const expectedUpdatedAt = input.expectedUpdatedAt == null
    ? undefined
    : parseDate(input.expectedUpdatedAt, "invalid_expected_updated_at");
  const source = optionalString(input.source);
  const actor = optionalString(input.actor);
  const metadata = parseMetadata(type, input.metadata);

  return {
    type,
    occurredAt,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    source,
    actor,
    metadata,
    contactId: typeof metadata.contactId === "string" ? metadata.contactId : null,
    outcome: typeof metadata.outcome === "string" ? metadata.outcome : null,
  };
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof metadata[key] === "string" ? metadata[key] as string : undefined;
}

export function deriveEventProjection(
  command: Pick<ParsedApplicationEventCommand, "type" | "occurredAt" | "metadata">,
  application: EventProjectionApplication,
): { patch: EventProjectionPatch; metadata: Record<string, unknown> } {
  const patch: EventProjectionPatch = {};
  const metadata = { ...command.metadata };
  const currentStatus = STATUS_SET.has(application.status as ApplicationStatus)
    ? application.status as ApplicationStatus
    : undefined;
  const setTransition = (status: ApplicationStatus, stage: string) => {
    patch.status = status;
    patch.currentStage = stage;
    patch.lastContact = command.occurredAt;
    metadata.fromStage = application.currentStage;
    metadata.toStage = stage;
    if (currentStatus) metadata.fromStatus = currentStatus;
    metadata.toStatus = status;
  };

  switch (command.type) {
    case "stage_changed": {
      const toStage = metadataString(metadata, "toStage")!;
      patch.currentStage = toStage;
      metadata.fromStage = application.currentStage;
      const toStatus = metadataString(metadata, "toStatus") as ApplicationStatus | undefined;
      if (toStatus) {
        patch.status = toStatus;
        if (currentStatus) metadata.fromStatus = currentStatus;
      }
      break;
    }
    case "interview_invited": {
      const stage = metadataString(metadata, "toStage") ?? "interview_invited";
      setTransition("interview", stage);
      const followUpAt = metadataString(metadata, "followUpAt");
      if (followUpAt) patch.followUpAt = new Date(followUpAt);
      break;
    }
    case "interview_scheduled": {
      const stage = metadataString(metadata, "toStage") ?? "interview_scheduled";
      setTransition("interview", stage);
      patch.followUpAt = new Date(metadataString(metadata, "scheduledAt")!);
      break;
    }
    case "interview_completed": {
      const stage = metadataString(metadata, "toStage") ?? "interview_completed";
      setTransition("interview", stage);
      const followUpAt = metadataString(metadata, "followUpAt");
      if (followUpAt) patch.followUpAt = new Date(followUpAt);
      break;
    }
    case "recruiter_contacted":
    case "feedback_received": {
      patch.lastContact = command.occurredAt;
      const toStage = metadataString(metadata, "toStage");
      const followUpAt = metadataString(metadata, "followUpAt");
      if (toStage) {
        patch.currentStage = toStage;
        metadata.fromStage = application.currentStage;
      }
      if (followUpAt) patch.followUpAt = new Date(followUpAt);
      break;
    }
    case "follow_up_scheduled":
      patch.followUpAt = new Date(metadataString(metadata, "followUpAt")!);
      break;
    case "offer_received": {
      setTransition("offer", "offer_received");
      const followUpAt = metadataString(metadata, "followUpAt");
      if (followUpAt) patch.followUpAt = new Date(followUpAt);
      break;
    }
    case "application_rejected":
      setTransition("rejected", "rejected");
      patch.followUpAt = null;
      break;
    case "application_submitted": {
      patch.status = "applied";
      patch.appliedAt = command.occurredAt;
      const followUpAt = metadataString(metadata, "followUpAt");
      if (followUpAt) patch.followUpAt = new Date(followUpAt);
      if (currentStatus) metadata.fromStatus = currentStatus;
      metadata.toStatus = "applied";
      break;
    }
    default:
      break;
  }
  return { patch, metadata };
}

export function encodeEventCursor(cursor: EventCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeEventCursor(value: string): EventCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EventCursor>;
    if (
      parsed.version !== 1
      || typeof parsed.id !== "string"
      || !parsed.id
      || typeof parsed.occurredAt !== "string"
    ) throw new Error("invalid");
    const occurredAt = parseDate(parsed.occurredAt, "event_query_invalid").toISOString();
    return { version: 1, id: parsed.id, occurredAt };
  } catch {
    throw new Error("event_query_invalid");
  }
}

function queryString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("event_query_invalid");
  const normalized = value.trim();
  if (!normalized || normalized.length > 255) throw new Error("event_query_invalid");
  return normalized;
}

export function parseEventQuery(input: Record<string, unknown>): ParsedEventQuery {
  let types: ApplicationEventType[] | undefined;
  if (input.types !== undefined) {
    const raw = Array.isArray(input.types)
      ? input.types
      : typeof input.types === "string"
        ? input.types.split(",")
        : [];
    const normalized = raw.map((type) => typeof type === "string" ? type.trim() : "");
    if (!normalized.length || normalized.some((type) => !EVENT_TYPE_SET.has(type))) {
      throw new Error("event_query_invalid");
    }
    types = [...new Set(normalized)] as ApplicationEventType[];
  }
  const rawLimit = input.limit == null ? 50 : Number(input.limit);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) throw new Error("event_query_invalid");
  const order = input.order == null ? "newest" : input.order;
  if (order !== "newest" && order !== "oldest") throw new Error("event_query_invalid");
  const occurredAfter = input.occurredAfter == null
    ? undefined
    : parseDate(input.occurredAfter, "event_query_invalid");
  const occurredBefore = input.occurredBefore == null
    ? undefined
    : parseDate(input.occurredBefore, "event_query_invalid");
  if (occurredAfter && occurredBefore && occurredAfter > occurredBefore) {
    throw new Error("event_query_invalid");
  }
  return {
    ...(queryString(input.applicationId) ? { applicationId: queryString(input.applicationId) } : {}),
    ...(queryString(input.company) ? { company: queryString(input.company) } : {}),
    ...(types ? { types } : {}),
    ...(occurredAfter ? { occurredAfter } : {}),
    ...(occurredBefore ? { occurredBefore } : {}),
    ...(queryString(input.source) ? { source: queryString(input.source) } : {}),
    ...(queryString(input.actor) ? { actor: queryString(input.actor) } : {}),
    ...(queryString(input.contactId) ? { contactId: queryString(input.contactId) } : {}),
    ...(queryString(input.outcome) ? { outcome: queryString(input.outcome) } : {}),
    ...(input.cursor ? { cursor: decodeEventCursor(String(input.cursor)) } : {}),
    order,
    limit: Math.min(100, Math.floor(rawLimit)),
  };
}

export function validateApplicationSummary(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("notes_invalid");
  if (value.length > 10_000) throw new Error("notes_too_long");
  return value;
}
