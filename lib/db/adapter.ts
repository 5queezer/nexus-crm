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
} from "./types";

export interface DatabaseAdapter {
  // ── Applications ─────────────────────────────────────────────────────────
  /** List applications, optionally scoped to userId (null = admin/all). */
  listApplications(userId: string | null): Promise<ApplicationRecord[]>;
  /** List applications with offset-based pagination. */
  listApplicationsPaginated(userId: string | null, params: PaginationParams): Promise<PaginatedResult<ApplicationRecord>>;
  getApplication(id: string, userId: string | null): Promise<ApplicationRecord | null>;
  createApplication(userId: string, data: CreateApplicationInput): Promise<ApplicationRecord>;
  updateApplication(id: string, userId: string, data: UpdateApplicationInput): Promise<ApplicationRecord>;
  deleteApplication(id: string, userId: string): Promise<void>;
  /** Find an exact canonical URL match owned by the user. */
  findApplicationByCanonicalJobUrl(userId: string, canonicalJobUrl: string): Promise<ApplicationRecord | null>;
  /** Append notes without a caller-side read/replace race and record an event. */
  appendApplicationNote(id: string, userId: string, note: string, event: CreateApplicationEventInput): Promise<{ application: ApplicationRecord; event: ApplicationEventRecord }>;

  // ── Submissions & timeline ───────────────────────────────────────────────
  recordApplicationSubmission(userId: string, input: RecordSubmissionInput): Promise<RecordSubmissionResult>;
  listApplicationSubmissions(applicationId: string, userId: string, includeAnswers?: boolean): Promise<ApplicationSubmissionRecord[]>;
  listUserSubmissions(userId: string): Promise<ApplicationSubmissionRecord[]>;
  getApplicationSubmission(id: string, userId: string): Promise<ApplicationSubmissionRecord | null>;
  createApplicationEvent(applicationId: string, userId: string, input: CreateApplicationEventInput): Promise<ApplicationEventRecord>;
  recordApplicationEvent(applicationId: string, userId: string, input: RecordApplicationEventInput): Promise<RecordApplicationEventResult>;
  listApplicationEvents(applicationId: string, userId: string, limit?: number): Promise<ApplicationEventRecord[]>;
  listApplicationEventsFiltered(userId: string, filter: ListApplicationEventsFilter): Promise<ApplicationEventPage>;

  /** List applications with optional filters and field selection. */
  listApplicationsFiltered(userId: string | null, filter: ListApplicationsFilter): Promise<Partial<ApplicationRecord>[]>;
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
  createDocument(userId: string, data: CreateDocumentInput): Promise<DocumentRecord>;
  updateDocumentMetadata(id: string, userId: string, data: UpdateDocumentMetadataInput): Promise<DocumentRecord>;
  /** Replace the set of linked application IDs on a document. */
  updateDocumentLinks(id: string, userId: string, applicationIds: string[]): Promise<DocumentRecord>;
  /** Rename the user-facing original name of a document. */
  renameDocument(id: string, userId: string, newName: string): Promise<DocumentRecord | null>;
  /** Delete document record. Returns the record (for filename cleanup) or null. */
  deleteDocument(id: string, userId: string): Promise<DocumentRecord | null>;

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
}
