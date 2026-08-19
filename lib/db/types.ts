import type { ApplicationEventType } from "@/lib/applications/events";

// ── Submission policy contract ───────────────────────────────────────────────

export type ProfileConsistencyStatus = "verified" | "unavailable_reviewed";

export interface SubmissionPolicyInput {
  humanReviewed?: boolean;
  identityConsistent?: boolean;
  factsVerified?: boolean;
  profileConsistencyStatus?: ProfileConsistencyStatus | string;
  confirmedNoAnswers?: boolean;
  sameCompanyOverrideReason?: string;
  resubmissionReason?: string;
}

export interface SubmissionPolicyRecord {
  humanReviewed?: boolean;
  identityConsistent?: boolean;
  factsVerified?: boolean;
  profileConsistencyStatus?: ProfileConsistencyStatus;
  confirmedNoAnswers?: boolean;
  sameCompanyOverrideReason?: string;
  resubmissionReason?: string;
}

export interface ValidatedSubmissionPolicy extends SubmissionPolicyRecord {
  humanReviewed: true;
  identityConsistent: true;
  factsVerified: true;
  profileConsistencyStatus: ProfileConsistencyStatus;
  confirmedNoAnswers: boolean;
}

// ── Record types (returned from adapter) ─────────────────────────────────────

export interface ApplicationRecord {
  id: string;
  userId: string;
  company: string;
  role: string;
  status: string;
  appliedAt: Date | null;
  lastContact: Date | null;
  followUpAt: Date | null;
  notes: string | null;
  jobDescription: string | null;
  source: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  rating: number | null;
  jobUrl: string | null;
  canonicalJobUrl: string | null;
  resumeId: string | null;
  companySize: string | null;
  salaryBandMentioned: boolean;
  triageQuality: number | null;
  triageReason: string | null;
  incomingSource: string | null;
  autoRejected: boolean;
  autoRejectReason: string | null;
  archivedAt: Date | null;
  workMode: string | null;
  eligibleCountries: string[];
  primaryLocations: string[];
  officeDaysMin: number | null;
  travelPercent: number | null;
  visaSponsorship: boolean | null;
  rightToWorkRequired: boolean | null;
  timezoneOverlap: string | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  salaryType: string | null;
  atsName: string | null;
  requisitionId: string | null;
  jobCapturedAt: Date | null;
  jobVerifiedAt: Date | null;
  jobPostedAt: Date | null;
  jobClosedAt: Date | null;
  jobContentHash: string | null;
  jobLiveness: string | null;
  jobSummary: string | null;
  currentStage: string | null;
  createdAt: Date;
  updatedAt: Date;
  isDemo: boolean;
  demoWorkspaceId: string | null;
  demoKey: string | null;
  contacts?: ContactRecord[];
}

export interface ContactRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  linkedIn: string | null;
  applicationId: string;
  createdAt: Date;
}

export interface DocumentRecord {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  documentType: string;
  state: string;
  version: number;
  contentHash: string | null;
  source: string | null;
  generatedAt: Date | null;
  submittedAt: Date | null;
  submissionId: string | null;
  uploadedAt: Date;
  /** Raw parent IDs retained so machine boundaries can detect dangling links. */
  applicationIds?: string[];
  /** Sticky internal marker: this document has been associated with demo data. */
  demoProvenance?: boolean;
  applications?: ApplicationRef[];
}

export interface SubmissionAnswerRecord {
  key?: string;
  question: string;
  answer: string;
  kind?: "text" | "boolean" | "number" | "choice" | "salary" | "other";
  sensitive?: boolean;
}

export interface ApplicationSubmissionRecord {
  id: string;
  userId: string;
  applicationId: string;
  idempotencyKey: string;
  requestHash: string;
  submittedAt: Date;
  applicationUrl: string | null;
  atsName: string | null;
  requisitionId: string | null;
  language: string | null;
  answers: SubmissionAnswerRecord[];
  policy: SubmissionPolicyRecord;
  candidateSalaryMin: number | null;
  candidateSalaryMax: number | null;
  candidateSalaryCurrency: string | null;
  candidateSalaryPeriod: string | null;
  candidateSalaryType: string | null;
  candidateSalaryFlexible: boolean;
  documentIds: string[];
  createdAt: Date;
  documents?: DocumentRecord[];
}

export interface ApplicationEventRecord {
  id: string;
  userId: string;
  applicationId: string;
  type: string;
  idempotencyKey: string | null;
  occurredAt: Date;
  source: string | null;
  actor: string | null;
  contactId: string | null;
  outcome: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  isDemo: boolean;
  demoWorkspaceId: string | null;
  demoKey: string | null;
  application?: ApplicationRef;
}

export interface ApplicationEventCursor {
  version: 1;
  occurredAt: string;
  id: string;
}

export interface ListApplicationEventsFilter {
  applicationId?: string;
  company?: string;
  types?: string[];
  occurredAfter?: Date;
  occurredBefore?: Date;
  source?: string;
  actor?: string;
  contactId?: string;
  outcome?: string;
  cursor?: ApplicationEventCursor;
  order: "newest" | "oldest";
  limit: number;
}

export interface ApplicationEventPage {
  items: ApplicationEventRecord[];
  nextCursor: string | null;
}

export interface RecordApplicationEventInput extends CreateApplicationEventInput {
  type: ApplicationEventType;
  idempotencyKey?: string;
  expectedUpdatedAt?: Date;
  contactId?: string | null;
  outcome?: string | null;
}

export interface RecordApplicationEventResult {
  event: ApplicationEventRecord;
  application: ApplicationRecord;
  replayed: boolean;
}

export interface ApplicationRef {
  id: string;
  company: string;
  role: string;
}

export type DemoVisibility = "include" | "exclude" | "only";

export interface DemoReadOptions {
  demoVisibility?: DemoVisibility;
}

export interface DocumentMutationOptions {
  /**
   * Require current raw application associations, and any replacement
   * associations, to retain owner-scoped non-demo provenance at the same
   * transactional serialization point as the mutation.
   */
  requireNonDemoProvenance?: boolean;
}

export interface DemoWorkspaceRecord {
  id: string;
  userId: string;
  seedVersion: number;
  state: "creating" | "ready" | "deleting";
  createdAt: Date;
  updatedAt: Date;
}

export interface EnsureDemoWorkspaceResult {
  workspace: DemoWorkspaceRecord;
  applications: ApplicationRecord[];
  replayed: boolean;
}

export interface DeleteDemoWorkspaceResult {
  deletedApplications: number;
  /**
   * Best-effort event count captured when deletion is prepared. The count is stable
   * across retries, but may underreport events added concurrently; those events are
   * still removed as part of the workspace deletion.
   */
  deletedEvents: number;
}

export interface UserRecord {
  id: string;
  name: string | null;
  email: string;
  isAdmin: boolean;
}

export interface ApiTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface AuditLogRecord {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId: string;
  targetEmail: string;
  createdAt: Date;
}

// ── Input types (passed into adapter) ────────────────────────────────────────

export interface StructuredApplicationMetadataInput {
  canonicalJobUrl?: string | null;
  workMode?: string | null;
  eligibleCountries?: string[];
  primaryLocations?: string[];
  officeDaysMin?: number | null;
  travelPercent?: number | null;
  visaSponsorship?: boolean | null;
  rightToWorkRequired?: boolean | null;
  timezoneOverlap?: string | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
  salaryType?: string | null;
  atsName?: string | null;
  requisitionId?: string | null;
  jobCapturedAt?: Date | null;
  jobVerifiedAt?: Date | null;
  jobPostedAt?: Date | null;
  jobClosedAt?: Date | null;
  jobContentHash?: string | null;
  jobLiveness?: string | null;
  jobSummary?: string | null;
  currentStage?: string | null;
}

export interface CreateApplicationInput extends StructuredApplicationMetadataInput {
  company: string;
  role: string;
  status: string;
  appliedAt: Date | null;
  lastContact: Date | null;
  followUpAt: Date | null;
  notes: string | null;
  jobDescription: string | null;
  source: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  rating: number | null;
  jobUrl: string | null;
  resumeId?: string | null;
  companySize?: string | null;
  salaryBandMentioned?: boolean;
  triageQuality?: number | null;
  triageReason?: string | null;
  incomingSource?: string | null;
  autoRejected?: boolean;
  autoRejectReason?: string | null;
}

export interface UpdateApplicationInput extends StructuredApplicationMetadataInput {
  company?: string;
  role?: string;
  status?: string;
  appliedAt?: Date | null;
  lastContact?: Date | null;
  followUpAt?: Date | null;
  notes?: string | null;
  jobDescription?: string | null;
  source?: string | null;
  remote?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  rating?: number | null;
  jobUrl?: string | null;
  resumeId?: string | null;
  companySize?: string | null;
  salaryBandMentioned?: boolean;
  triageQuality?: number | null;
  triageReason?: string | null;
  incomingSource?: string | null;
  autoRejected?: boolean;
  autoRejectReason?: string | null;
  archivedAt?: Date | null;
  expectedUpdatedAt?: Date;
}

export interface CreateContactInput {
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  linkedIn: string | null;
}

export interface UpdateContactInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  linkedIn?: string | null;
}

export interface ShareLinkRecord {
  id: string;
  code: string;
  userId: string;
  targetType: string;
  targetId: string | null;
  createdAt: Date;
}

export interface CreateShareLinkInput {
  code: string;
  targetType: string;
  targetId: string | null;
}

export interface CreateDocumentInput {
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  applicationIds: string[];
  documentType?: string;
  state?: string;
  version?: number;
  contentHash?: string | null;
  source?: string | null;
  generatedAt?: Date | null;
  submittedAt?: Date | null;
  submissionId?: string | null;
}

export interface UpdateDocumentMetadataInput {
  documentType?: string;
  state?: string;
  version?: number;
  contentHash?: string | null;
  source?: string | null;
  generatedAt?: Date | null;
  submittedAt?: Date | null;
}

export interface ListDocumentsFilter {
  applicationId?: string;
  documentType?: string;
  state?: string;
  submissionId?: string;
  orphaned?: boolean;
  excludeSubmissionArtifacts?: boolean;
  fields?: string[];
  limit?: number;
  page?: number;
  pageSize?: number;
}

export interface RecordSubmissionInput {
  applicationId: string;
  idempotencyKey: string;
  submittedAt: Date;
  followUpAt?: Date | null;
  applicationUrl?: string | null;
  atsName?: string | null;
  requisitionId?: string | null;
  language?: string | null;
  answers: SubmissionAnswerRecord[];
  policy?: SubmissionPolicyInput | null;
  candidateSalaryMin?: number | null;
  candidateSalaryMax?: number | null;
  candidateSalaryCurrency?: string | null;
  candidateSalaryPeriod?: string | null;
  candidateSalaryType?: string | null;
  candidateSalaryFlexible?: boolean;
  documentIds: unknown;
  source?: string | null;
  actor?: string | null;
  dryRun?: boolean;
  expectedUpdatedAt?: Date;
}

export interface RecordSubmissionResult {
  replayed: boolean;
  dryRun: boolean;
  verified: boolean;
  application: ApplicationRecord;
  submission: ApplicationSubmissionRecord;
  event: ApplicationEventRecord | null;
  documents: DocumentRecord[];
}

export interface CreateApplicationEventInput {
  type: string;
  idempotencyKey?: string | null;
  expectedUpdatedAt?: Date;
  occurredAt: Date;
  source?: string | null;
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ── Pagination types ─────────────────────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Batch & filter types ──────────────────────────────────────────────────────

export interface ListApplicationsFilter {
  status?: string[];
  ratingGte?: number;
  triageQualityGte?: number;
  search?: string;
  remote?: boolean;
  sort?: string;
  fields?: string[];
  limit?: number;
  includeContacts?: boolean;
  page?: number;
  pageSize?: number;
}

export interface BatchUpsertItem extends StructuredApplicationMetadataInput {
  id?: string;
  company?: string;
  role?: string;
  status?: string;
  appliedAt?: Date | null;
  lastContact?: Date | null;
  followUpAt?: Date | null;
  notes?: string | null;
  jobDescription?: string | null;
  source?: string | null;
  remote?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  rating?: number | null;
  jobUrl?: string | null;
  resumeId?: string | null;
  companySize?: string | null;
  salaryBandMentioned?: boolean;
  triageQuality?: number | null;
  triageReason?: string | null;
  incomingSource?: string | null;
  autoRejected?: boolean;
  autoRejectReason?: string | null;
}

export interface BatchUpsertResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    index: number;
    id: string;
    operation: "created" | "updated";
    error?: string;
  }>;
}

export interface BatchDeleteResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    id: string;
    deleted: boolean;
    error?: string;
  }>;
}

// ── CV types ────────────────────────────────────────────────────────────────

export interface CvSkillCategory {
  category: string;
  items: string[];
}

export interface CvExperienceEntry {
  id: string;
  company: string;
  title: string;
  date: string;
  location: string;
  tier: number; // 1 = detailed, 2 = bullets, 3 = compact
  bullets: string[];
}

export interface CvProject {
  name: string;
  url?: string;
  stack: string;
  description: string;
}

export interface CvEducation {
  institution: string;
  degree: string;
  date: string;
  location: string;
  details?: string;
}

export interface CvContact {
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  location?: string;
}

export interface CvProfileRecord {
  id: string;
  userId: string;
  name: string;
  contact: CvContact;
  profile: string;
  skills: CvSkillCategory[];
  experience: CvExperienceEntry[];
  projects: CvProject[];
  education: CvEducation[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCvProfileInput {
  name: string;
  contact: CvContact;
  profile: string;
  skills: CvSkillCategory[];
  experience: CvExperienceEntry[];
  projects?: CvProject[];
  education?: CvEducation[];
}

export interface CvPatchRecord {
  id: string;
  applicationId: string;
  profileOverride: string | null;
  experienceIds: string[];
  skillCategories: string[];
  includeProjects: boolean;
  includeEducation: boolean;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCvPatchInput {
  profileOverride?: string | null;
  experienceIds: string[];
  skillCategories: string[];
  includeProjects?: boolean;
  includeEducation?: boolean;
}

// ── Career Ops (Hermes session bridge) ───────────────────────────────────────

/**
 * Last-known state of a Hermes run, mirrored into Nexus only so the UI can
 * settle without a live stream. Hermes remains the authority.
 */
export type CareerOpsRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Statuses in which a run may still be executing upstream.
 *
 * Single source of truth: the Postgres partial unique index in
 * 20260819170000_career_ops_active_run_invariant lists exactly these values,
 * and the Firestore claim transaction queries on them. Changing this list
 * without changing that index would silently drop the one-active-run
 * invariant on Postgres.
 */
/** Statuses from which a run can no longer change. */
export const CAREER_OPS_TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly CareerOpsRunStatus[];

export const CAREER_OPS_ACTIVE_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_for_approval",
  "stopping",
] as const satisfies readonly CareerOpsRunStatus[];

export interface CareerOpsThreadRecord {
  id: string;
  userId: string;
  hermesSessionId: string;
  title: string;
  /** Optional Nexus application this conversation is scoped to. */
  applicationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCareerOpsThreadInput {
  hermesSessionId: string;
  title: string;
  applicationId?: string | null;
}

export interface CareerOpsRunRecord {
  id: string;
  userId: string;
  threadId: string;
  hermesRunId: string;
  /** Caller-supplied bounded identifier used to make run creation idempotent. */
  clientRequestId: string;
  status: CareerOpsRunStatus;
  /** Last human approval decision on this run. Never the command or arguments. */
  approvalChoice: string | null;
  approvalAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCareerOpsRunInput {
  threadId: string;
  hermesRunId: string;
  clientRequestId: string;
  status: CareerOpsRunStatus;
}

/**
 * Outcome of an atomic attempt to claim the conversation's single active-run
 * slot. The decision belongs to the database, not the caller: two concurrent
 * submissions both pass any read-then-write guard, so the backends express the
 * invariant natively (a partial unique index on Postgres, a transaction on
 * Firestore) and report which of these happened.
 */
export type CareerOpsRunClaim =
  /** This caller won the slot and created the reservation. */
  | { outcome: "claimed"; run: CareerOpsRunRecord }
  /** The same (threadId, clientRequestId) was already claimed — an idempotent retry. */
  | { outcome: "existing"; run: CareerOpsRunRecord }
  /** A different run already holds the conversation's active slot. */
  | { outcome: "active_run_exists" }
  /** The conversation no longer exists, or is not owned by this user. */
  | { outcome: "thread_gone" };
