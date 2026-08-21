import type {
  ApplicationRecord,
  ContactRecord,
  DocumentRecord,
  UserRecord,
  AuditLogRecord,
  ApiTokenRecord,
  ApiTokenInfo,
  ShareLinkRecord,
  CreateApplicationInput,
  UpdateApplicationInput,
  CreateContactInput,
  UpdateContactInput,
  CreateDocumentInput,
  CreateShareLinkInput,
  ListApplicationsFilter,
  PaginationParams,
  PaginatedResult,
  BatchUpsertItem,
  BatchUpsertResult,
  BatchDeleteResult,
  CvProfileRecord,
  UpsertCvProfileInput,
  CvPatchRecord,
  UpsertCvPatchInput,
  ApplicationSubmissionRecord,
  ApplicationEventRecord,
  RecordSubmissionInput,
  RecordSubmissionResult,
  CreateApplicationEventInput,
  RecordApplicationEventInput,
  RecordApplicationEventResult,
  ListApplicationEventsFilter,
  ApplicationEventPage,
  ListDocumentsFilter,
  UpdateDocumentMetadataInput,
  DocumentMutationOptions,
  DemoReadOptions,
  EnsureDemoWorkspaceResult,
  DeleteDemoWorkspaceResult,
  CareerOpsThreadRecord,
  CareerOpsRunRecord,
  CareerOpsRunStatus,
  CreateCareerOpsThreadInput,
  CreateCareerOpsRunInput,
  CareerOpsApprovalGateClaim,
  CareerOpsApprovalState,
  CareerOpsRunClaim,
  CareerOpsThreadDeletion,
} from "./types";
import type { DemoFixtures } from "@/lib/demo-workspace/fixtures";

export interface DatabaseAdapter {
  // ── Applications ─────────────────────────────────────────────────────────
  /** List applications, optionally scoped to userId (null = admin/all). */
  listApplications(userId: string | null, options?: DemoReadOptions): Promise<ApplicationRecord[]>;
  /** List applications with offset-based pagination. */
  listApplicationsPaginated(userId: string | null, params: PaginationParams, options?: DemoReadOptions): Promise<PaginatedResult<ApplicationRecord>>;
  getApplication(id: string, userId: string | null, options?: DemoReadOptions): Promise<ApplicationRecord | null>;
  createApplication(userId: string, data: CreateApplicationInput): Promise<ApplicationRecord>;
  updateApplication(id: string, userId: string, data: UpdateApplicationInput): Promise<ApplicationRecord>;
  deleteApplication(id: string, userId: string): Promise<void>;
  /** Find an exact canonical URL match owned by the user. */
  findApplicationByCanonicalJobUrl(userId: string, canonicalJobUrl: string, options?: DemoReadOptions): Promise<ApplicationRecord | null>;
  /** Append notes without a caller-side read/replace race and record an event. */
  appendApplicationNote(id: string, userId: string, note: string, event: CreateApplicationEventInput): Promise<{ application: ApplicationRecord; event: ApplicationEventRecord }>;

  // ── Submissions & timeline ───────────────────────────────────────────────
  recordApplicationSubmission(userId: string, input: RecordSubmissionInput): Promise<RecordSubmissionResult>;
  listApplicationSubmissions(applicationId: string, userId: string, includeAnswers?: boolean): Promise<ApplicationSubmissionRecord[]>;
  listUserSubmissions(userId: string): Promise<ApplicationSubmissionRecord[]>;
  getApplicationSubmission(id: string, userId: string): Promise<ApplicationSubmissionRecord | null>;
  createApplicationEvent(applicationId: string, userId: string, input: CreateApplicationEventInput): Promise<ApplicationEventRecord>;
  recordApplicationEvent(applicationId: string, userId: string, input: RecordApplicationEventInput): Promise<RecordApplicationEventResult>;
  listApplicationEvents(applicationId: string, userId: string, limit?: number, options?: DemoReadOptions): Promise<ApplicationEventRecord[]>;
  listApplicationEventsFiltered(userId: string, filter: ListApplicationEventsFilter, options?: DemoReadOptions): Promise<ApplicationEventPage>;

  /** List applications with optional filters and field selection. */
  listApplicationsFiltered(userId: string | null, filter: ListApplicationsFilter, options?: DemoReadOptions): Promise<Partial<ApplicationRecord>[]>;

  // ── Demo workspace lifecycle ─────────────────────────────────────────────
  ensureDemoWorkspace(userId: string, fixtures: DemoFixtures): Promise<EnsureDemoWorkspaceResult>;
  deleteDemoWorkspace(userId: string): Promise<DeleteDemoWorkspaceResult>;
  /** Batch create/update applications. Items with id → update, without → create. */
  batchUpsertApplications(userId: string, items: BatchUpsertItem[]): Promise<BatchUpsertResult>;
  /** Batch delete applications by IDs. */
  batchDeleteApplications(ids: string[], userId: string): Promise<BatchDeleteResult>;

  // ── Contacts ─────────────────────────────────────────────────────────────
  /** Verify an application exists and belongs to userId. */
  verifyApplicationOwner(id: string, userId: string): Promise<boolean>;
  createContact(applicationId: string, userId: string, data: CreateContactInput): Promise<ContactRecord>;
  updateContact(id: string, applicationId: string, userId: string, data: UpdateContactInput): Promise<ContactRecord>;
  deleteContact(id: string, applicationId: string, userId: string): Promise<void>;

  // ── Documents ────────────────────────────────────────────────────────────
  listDocuments(userId: string | null): Promise<DocumentRecord[]>;
  listDocumentsFiltered(userId: string | null, filter: ListDocumentsFilter): Promise<Partial<DocumentRecord>[]>;
  /** List documents linked to a specific application. */
  listDocumentsByApplication(applicationId: string, userId: string): Promise<DocumentRecord[]>;
  getDocument(id: string, userId: string | null): Promise<DocumentRecord | null>;
  createDocument(userId: string, data: CreateDocumentInput, options?: DocumentMutationOptions): Promise<DocumentRecord>;
  updateDocumentMetadata(id: string, userId: string, data: UpdateDocumentMetadataInput, options?: DocumentMutationOptions): Promise<DocumentRecord>;
  /** Replace the set of linked application IDs on a document. */
  updateDocumentLinks(id: string, userId: string, applicationIds: string[], options?: DocumentMutationOptions): Promise<DocumentRecord>;
  /** Rename the user-facing original name of a document. */
  renameDocument(id: string, userId: string, newName: string): Promise<DocumentRecord | null>;
  /** Delete document record. Returns the record (for filename cleanup) or null. */
  deleteDocument(id: string, userId: string, options?: DocumentMutationOptions): Promise<DocumentRecord | null>;

  // ── Users ────────────────────────────────────────────────────────────────
  getUser(id: string): Promise<UserRecord | null>;
  listUsers(): Promise<UserRecord[]>;
  updateUserAdmin(id: string, isAdmin: boolean): Promise<UserRecord>;

  // ── Audit Logs ──────────────────────────────────────────────────────────
  createAuditLog(actorId: string, action: string, targetId: string): Promise<void>;
  listAuditLogs(limit?: number): Promise<AuditLogRecord[]>;

  // ── API Tokens ─────────────────────────────────────────────────────────
  getApiTokenByHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  getApiToken(userId: string): Promise<ApiTokenInfo | null>;
  createApiToken(userId: string, tokenHash: string, name?: string): Promise<ApiTokenInfo>;
  deleteApiToken(userId: string): Promise<void>;
  touchApiTokenLastUsed(id: string): Promise<void>;

  // ── Share Links ──────────────────────────────────────────────────────────
  getShareLinkByCode(code: string): Promise<ShareLinkRecord | null>;
  listShareLinks(userId: string): Promise<ShareLinkRecord[]>;
  findShareLink(userId: string, targetType: string, targetId: string | null): Promise<ShareLinkRecord | null>;
  createShareLink(userId: string, data: CreateShareLinkInput): Promise<ShareLinkRecord>;
  deleteShareLink(id: string, userId: string): Promise<void>;

  // ── CV ─────────────────────────────────────────────────────────────────
  getCvProfile(userId: string): Promise<CvProfileRecord | null>;
  upsertCvProfile(userId: string, data: UpsertCvProfileInput): Promise<CvProfileRecord>;
  getCvPatch(applicationId: string, userId: string): Promise<CvPatchRecord | null>;
  upsertCvPatch(applicationId: string, userId: string, data: UpsertCvPatchInput): Promise<CvPatchRecord>;
  setCvPatchDocumentId(patchId: string, userId: string, documentId: string | null): Promise<void>;

  // ── Career Ops (Hermes session bridge) ───────────────────────────────────
  /** List a user's Career Ops threads, most recently updated first. */
  listCareerOpsThreads(userId: string): Promise<CareerOpsThreadRecord[]>;
  /** Fetch one thread, or null when it does not exist or belongs to someone else. */
  getCareerOpsThread(id: string, userId: string): Promise<CareerOpsThreadRecord | null>;
  createCareerOpsThread(userId: string, data: CreateCareerOpsThreadInput): Promise<CareerOpsThreadRecord>;
  /** Rename a thread the user owns. Returns null when it is not theirs. */
  renameCareerOpsThread(id: string, userId: string, title: string): Promise<CareerOpsThreadRecord | null>;
  /** Delete a thread and its runs. Returns the removed record, or null when not owned. */
  /**
   * Delete a conversation, refusing atomically if it holds an active run.
   * The refusal must be decided in the same transaction as the delete.
   */
  deleteCareerOpsThread(id: string, userId: string): Promise<CareerOpsThreadDeletion>;
  /** Fetch one run, or null when it does not exist or belongs to someone else. */
  getCareerOpsRun(id: string, userId: string): Promise<CareerOpsRunRecord | null>;
  /** Create a run, returning the existing one when (threadId, clientRequestId) is already used. */
  /**
   * Atomically claim the conversation's single active-run slot. Implementations
   * MUST decide the race in the database — a read followed by a write lets two
   * concurrent submissions both start a privileged agent run against one Hermes
   * session — and MUST refuse a run whose parent thread is gone.
   */
  claimCareerOpsRun(userId: string, data: CreateCareerOpsRunInput): Promise<CareerOpsRunClaim>;
  /** Record the last-known Hermes run state. No-op when the run is not the user's. */
  updateCareerOpsRunStatus(id: string, userId: string, status: CareerOpsRunStatus): Promise<void>;
  /**
   * Attach the upstream run id to a reservation created with an empty one.
   * Returns null when the run is not the user's.
   */
  /**
   * Attach the upstream run id to a reservation, if it is still one.
   *
   * Conditional, not a blind write: expiry can reach the same row, and the two
   * must have exactly one winner. Binding a row that expiry has already settled
   * would leave a live upstream run attached to a closed reservation while the
   * conversation's active slot stands free for a second one.
   */
  bindCareerOpsRunHermesId(id: string, userId: string, hermesRunId: string): Promise<CareerOpsRunRecord | null>;

  /**
   * Give up on a reservation that has no upstream id and is past its cutoff.
   *
   * One conditional transition, so it cannot race binding: it matches only a
   * row that is still unbound, still active, and created before `cutoff`. The
   * status it writes is `abandoned` rather than `failed` — Nexus never observed
   * the upstream run end, and must not claim it did.
   */
  expireCareerOpsRunReservation(id: string, userId: string, cutoff: Date): Promise<boolean>;
  /** Release a reservation whose upstream run could not be started. */
  deleteCareerOpsRun(id: string, userId: string): Promise<void>;
  /** Most recent run on a thread, so a reloaded client can rejoin it. */
  getLatestCareerOpsRun(threadId: string, userId: string): Promise<CareerOpsRunRecord | null>;
  /** The run already claimed by this (thread, clientRequestId), if any. */
  findCareerOpsRunByClientRequestId(
    threadId: string,
    userId: string,
    clientRequestId: string,
  ): Promise<CareerOpsRunRecord | null>;
  /**
   * Record who decided an approval and when. Deliberately stores no command
   * payload or arguments. No-op when the run is not the user's.
   */
  /**
   * Open the approval gate a run has reached, with the challenge disclosed for
   * it (or null when none could be minted).
   *
   * Must succeed *before* the prompt reaches the browser. Exposing controls
   * first lets a decision arrive while no gate is recorded, where it is refused
   * as a conflict — the client drops the prompt and Hermes stays blocked with
   * nobody able to answer.
   */
  openCareerOpsApprovalGate(
    id: string,
    userId: string,
    challengeId: string | null,
  ): Promise<void>;

  /**
   * Atomically claim the decision for the gate a run is currently at.
   *
   * One conditional write decides, for grant and denial alike. Splitting this
   * into a challenge-consuming path and a status-checking path is what let a
   * grant and a denial both reach Hermes: the denial read a `waiting_for_approval`
   * status that the grant's claim had already invalidated.
   *
   * `challengeId` is required for a granting decision and must still be the
   * outstanding one — that is what makes a grant single-use and bound to the
   * gate that disclosed it. Denial passes `null` and claims the gate on its
   * state alone, so a recovered prompt with no challenge can still be refused.
   *
   * Returns the outstanding challenge (empty when the gate had none) to exactly
   * one caller and `null` to every other.
   */
  claimCareerOpsApprovalGate(
    id: string,
    userId: string,
    challengeId: string | null,
  ): Promise<CareerOpsApprovalGateClaim | null>;

  /**
   * Put a claimed gate back, for a caller that claimed it and then sent
   * nothing. Conditional on the run still being as the claim left it, so a
   * gate the agent has since moved on to is never overwritten.
   */
  releaseCareerOpsApprovalGate(id: string, userId: string, challengeId: string): Promise<void>;

  recordCareerOpsApprovalDecision(
    id: string,
    userId: string,
    choice: string,
    challengeId: string,
    state: CareerOpsApprovalState,
  ): Promise<void>;
}
