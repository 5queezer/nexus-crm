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
  resumeId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  uploadedAt: Date;
  applications?: ApplicationRef[];
}

export interface ApplicationRef {
  id: string;
  company: string;
  role: string;
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

export interface CreateApplicationInput {
  company: string;
  role: string;
  status: string;
  appliedAt: Date | null;
  lastContact: Date | null;
  followUpAt: Date | null;
  notes: string | null;
  jobDescription: string | null;
  source: string | null;
}

export interface UpdateApplicationInput {
  company?: string;
  role?: string;
  status?: string;
  appliedAt?: Date | null;
  lastContact?: Date | null;
  followUpAt?: Date | null;
  notes?: string | null;
  jobDescription?: string | null;
  source?: string | null;
  resumeId?: string | null;
  archivedAt?: Date | null;
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
}
