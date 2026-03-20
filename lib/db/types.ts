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
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  rating: number | null;
  jobUrl: string | null;
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
  remote?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  rating?: number | null;
  jobUrl?: string | null;
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
  search?: string;
  remote?: boolean;
  sort?: string;
  fields?: string[];
  limit?: number;
  includeContacts?: boolean;
  page?: number;
  pageSize?: number;
}

export interface BatchUpsertItem {
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
