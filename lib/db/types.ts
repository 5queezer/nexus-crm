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

export interface CreateDocumentInput {
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  applicationIds: string[];
}
