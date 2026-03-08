import type {
  ApplicationRecord,
  ContactRecord,
  DocumentRecord,
  UserRecord,
  CreateApplicationInput,
  UpdateApplicationInput,
  CreateContactInput,
  UpdateContactInput,
  CreateDocumentInput,
} from "./types";

export interface DatabaseAdapter {
  // ── Applications ─────────────────────────────────────────────────────────
  /** List applications, optionally scoped to userId (null = admin/all). */
  listApplications(userId: string | null): Promise<ApplicationRecord[]>;
  getApplication(id: string, userId: string | null): Promise<ApplicationRecord | null>;
  createApplication(userId: string, data: CreateApplicationInput): Promise<ApplicationRecord>;
  updateApplication(id: string, userId: string, data: UpdateApplicationInput): Promise<ApplicationRecord>;
  deleteApplication(id: string, userId: string): Promise<void>;

  // ── Contacts ─────────────────────────────────────────────────────────────
  /** Verify an application exists and belongs to userId. */
  verifyApplicationOwner(id: string, userId: string): Promise<boolean>;
  createContact(applicationId: string, data: CreateContactInput): Promise<ContactRecord>;
  updateContact(id: string, applicationId: string, userId: string, data: UpdateContactInput): Promise<ContactRecord>;
  deleteContact(id: string, applicationId: string, userId: string): Promise<void>;

  // ── Documents ────────────────────────────────────────────────────────────
  listDocuments(userId: string | null): Promise<DocumentRecord[]>;
  getDocument(id: string, userId: string | null): Promise<DocumentRecord | null>;
  createDocument(userId: string, data: CreateDocumentInput): Promise<DocumentRecord>;
  /** Replace the set of linked application IDs on a document. */
  updateDocumentLinks(id: string, userId: string, applicationIds: string[]): Promise<DocumentRecord>;
  /** Delete document record. Returns the record (for filename cleanup) or null. */
  deleteDocument(id: string, userId: string): Promise<DocumentRecord | null>;

  // ── Users ────────────────────────────────────────────────────────────────
  getUser(id: string): Promise<UserRecord | null>;
}
