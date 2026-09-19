export const BULK_ACTION_TYPES = [
  "reschedule_follow_up",
  "archive",
  "restore",
] as const;

export type BulkActionType = (typeof BULK_ACTION_TYPES)[number];

export type BulkMatchFilters = {
  query?: string;
  statuses?: string[];
  sources?: string[];
  remote?: boolean;
  workModes?: string[];
  triageQualityMin?: number;
  followUpBefore?: string;
  archived?: "active" | "archived" | "all";
};

export type BulkScope =
  | { mode: "selected"; applicationIds: string[] }
  | { mode: "all_matching"; filters: BulkMatchFilters };

export type BulkApplicationCandidate = {
  id: string;
  company: string;
  role: string;
  status: string;
  source: string | null;
  remote: boolean;
  workMode: string | null;
  followUpAt: Date | null;
  archivedAt: Date | null;
  notes: string | null;
  jobSummary?: string | null;
  nextAction?: string | null;
  triageQuality?: number | null;
  contacts?: Array<{ name: string }>;
  eventVersion: number;
};

export type BulkFieldSnapshot = {
  followUpAt?: string | null;
  archivedAt?: string | null;
};

export type BulkExclusion = {
  applicationId: string;
  company: string;
  role: string;
  code: string;
  reason: string;
};

export type BulkItemStatus =
  | "pending"
  | "running"
  | "applied"
  | "skipped"
  | "failed"
  | "stale"
  | "cancelled"
  | "outcome_unknown";

export type BulkUndoStatus =
  | "pending"
  | "running"
  | "applied"
  | "stale"
  | "failed"
  | "cancelled"
  | "outcome_unknown";

export type BulkCommandStatus =
  | "preview"
  | "superseded"
  | "approved"
  | "queued"
  | "running"
  | "pause_requested"
  | "paused"
  | "cancel_requested"
  | "cancelled"
  | "completed"
  | "completed_with_errors"
  | "undo_queued"
  | "undo_running"
  | "undo_completed"
  | "undo_completed_with_errors";

export type BulkCommandItemCreate = {
  applicationId: string;
  company: string;
  role: string;
  ordinal: number;
  expectedVersion: number;
  before: BulkFieldSnapshot;
  after: BulkFieldSnapshot;
  reason: string | null;
  evidence: unknown;
  idempotencyKey: string;
};

export type BulkCommandItemRecord = BulkCommandItemCreate & {
  id: string;
  commandId: string;
  status: BulkItemStatus;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  appliedVersion: number | null;
  appliedBefore: BulkFieldSnapshot | null;
  appliedAfter: BulkFieldSnapshot | null;
  appliedAt: Date | null;
  verifiedAt: Date | null;
  undoStatus: BulkUndoStatus | null;
  undoExpectedVersion: number | null;
  undoAppliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BulkCommandCreate = {
  id: string;
  userId: string;
  threadId: string | null;
  runId: string | null;
  actionType: BulkActionType;
  scope: BulkScope;
  reason: string | null;
  exclusions: BulkExclusion[];
  requestHash: string;
  digest: string;
  idempotencyKey: string;
  status: BulkCommandStatus;
  expiresAt: Date;
  supersedesId: string | null;
  items: BulkCommandItemCreate[];
};

export type BulkCommandRecord = Omit<BulkCommandCreate, "items"> & {
  approvedDigest: string | null;
  approvedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  pauseRequestedAt: Date | null;
  cancelRequestedAt: Date | null;
  undoRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: BulkCommandItemRecord[];
};

export type BulkCommandTransition = {
  from: BulkCommandStatus[];
  digest?: string;
  notExpiredAt?: Date;
  patch: Partial<Omit<BulkCommandRecord, "id" | "userId" | "items" | "createdAt" | "updatedAt">>;
};

export interface BulkCommandRepository {
  resolveApplications(
    userId: string,
    scope: BulkScope,
    actionType: BulkActionType,
  ): Promise<BulkApplicationCandidate[]>;
  findByIdempotencyKey(userId: string, key: string): Promise<BulkCommandRecord | null>;
  createCommand(input: BulkCommandCreate): Promise<BulkCommandRecord>;
  findCommand(userId: string, id: string): Promise<BulkCommandRecord | null>;
  createRevision(
    userId: string,
    sourceId: string,
    sourceDigest: string,
    input: BulkCommandCreate,
  ): Promise<BulkCommandRecord | null>;
  transitionCommand(
    userId: string,
    id: string,
    transition: BulkCommandTransition,
  ): Promise<BulkCommandRecord | null>;
  queueUndo(userId: string, id: string, digest: string, now: Date): Promise<BulkCommandRecord | null>;
}

export type BulkCommandCounts = Record<BulkItemStatus, number> & {
  total: number;
  undoPending: number;
  undoApplied: number;
  undoStale: number;
  undoFailed: number;
  undoOutcomeUnknown: number;
};

export type BulkCommandItemSnapshot = Omit<
  BulkCommandItemRecord,
  "createdAt" | "updatedAt" | "appliedAt" | "verifiedAt" | "undoAppliedAt"
> & {
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  verifiedAt: string | null;
  undoAppliedAt: string | null;
};

export type BulkCommandSnapshot = Omit<
  BulkCommandRecord,
  | "userId"
  | "createdAt"
  | "updatedAt"
  | "expiresAt"
  | "approvedAt"
  | "startedAt"
  | "completedAt"
  | "pauseRequestedAt"
  | "cancelRequestedAt"
  | "undoRequestedAt"
  | "items"
> & {
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pauseRequestedAt: string | null;
  cancelRequestedAt: string | null;
  undoRequestedAt: string | null;
  targetCount: number;
  reversible: boolean;
  counts: BulkCommandCounts;
  items: BulkCommandItemSnapshot[];
};

export type BulkPreviewRequest = {
  repository: BulkCommandRepository;
  userId: string;
  actionType: BulkActionType;
  scope: BulkScope;
  changes?: { followUpAt?: string };
  reason?: string;
  threadId?: string;
  runId?: string;
  idempotencyKey?: string;
  now?: Date;
  idFactory?: () => string;
};
