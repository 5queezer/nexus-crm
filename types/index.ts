export type ApplicationStatus =
  | "inbound"
  | "applied"
  | "interview"
  | "offer"
  | "rejected";

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  linkedIn: string | null;
  applicationId: string;
  createdAt: string;
}

export type CompanySize = "micro" | "small" | "mid" | "large" | "enterprise";
export type IncomingSource = "linkedin" | "email" | "referral" | "outbound";
export type TriageScore = 1 | 2 | 3 | 4 | 5;

export const COMPANY_SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: "micro", label: "< 50" },
  { value: "small", label: "50–500" },
  { value: "mid", label: "500–5k" },
  { value: "large", label: "5k+" },
  { value: "enterprise", label: "Enterprise" },
];

export const INCOMING_SOURCE_OPTIONS: IncomingSource[] = [
  "linkedin",
  "email",
  "referral",
  "outbound",
];

export const TRIAGE_COLORS: Record<number, string> = {
  5: "bg-green-100 text-green-800 dark:bg-green-500/25 dark:text-green-300",
  4: "bg-blue-100 text-blue-800 dark:bg-blue-500/25 dark:text-blue-300",
  3: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/25 dark:text-yellow-300",
  2: "bg-gray-100 text-gray-600 dark:bg-gray-500/25 dark:text-gray-400",
  1: "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-300",
};

export const TRIAGE_LABELS: Record<number, string> = {
  5: "Perfect fit",
  4: "Strong",
  3: "Consider",
  2: "Weak",
  1: "Pass",
};

export interface Application {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  lastContact: string | null;
  followUpAt: string | null;
  notes: string | null;
  jobDescription: string | null;
  source: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  rating: number | null;
  jobUrl: string | null;
  resumeId: string | null;
  companySize: CompanySize | null;
  salaryBandMentioned: boolean;
  triageQuality: TriageScore | null;
  triageReason: string | null;
  incomingSource: IncomingSource | null;
  autoRejected: boolean;
  autoRejectReason: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contacts?: Contact[];
}

// Color mapping per status — labels come from i18n translations
export const STATUS_COLORS: Record<ApplicationStatus, string> = {
  inbound: "bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-300",
  applied: "bg-blue-100 text-blue-800 dark:bg-blue-500/25 dark:text-blue-300",
  interview: "bg-purple-100 text-purple-800 dark:bg-purple-500/25 dark:text-purple-300",
  offer: "bg-green-100 text-green-800 dark:bg-emerald-500/25 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-300",
};

// Row highlight colors for table
export const STATUS_ROW_COLORS: Record<ApplicationStatus, string> = {
  inbound: "",
  applied: "",
  interview: "bg-purple-50/40 dark:bg-purple-950/20",
  offer: "bg-green-50/40 dark:bg-green-950/20",
  rejected: "bg-red-50/30 dark:bg-red-950/20",
};

// Ordered for Kanban display
export const STATUS_ORDER: ApplicationStatus[] = [
  "inbound",
  "applied",
  "interview",
  "offer",
  "rejected",
];

const STATUS_ALIASES: Record<string, ApplicationStatus> = {
  waiting: "applied",
  draft: "applied",
  ghost: "rejected",
};

export function normalizeStatus(status: string | null | undefined): ApplicationStatus {
  const normalized = String(status ?? "").trim().toLowerCase();
  if ((STATUS_ORDER as string[]).includes(normalized)) {
    return normalized as ApplicationStatus;
  }
  return STATUS_ALIASES[normalized] ?? "applied";
}

// Preset source values for the source field
export const SOURCE_PRESETS = [
  "linkedin",
  "referral",
  "website",
  "cold-outreach",
  "event",
  "partner",
  "email",
  "other",
] as const;

const SOURCE_ALIASES: Record<string, string> = {
  "linkedin inmail": "linkedin",
  "linkedin-inmail": "linkedin",
  "linkedin recruiter": "linkedin",
  "webseite": "website",
  "web": "website",
  "homepage": "website",
  "karriereseite": "website",
  "kaltakquise": "cold-outreach",
  "cold outreach": "cold-outreach",
  "empfehlung": "referral",
  "referenz": "referral",
  "messe": "event",
  "konferenz": "event",
  "e-mail": "email",
  "mail": "email",
};

export function normalizeSource(source: string | null | undefined): string | null {
  if (!source) return null;
  const trimmed = source.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // Exact match to a preset
  if ((SOURCE_PRESETS as readonly string[]).includes(lower)) {
    return lower;
  }

  // Check aliases
  if (SOURCE_ALIASES[lower]) {
    return SOURCE_ALIASES[lower];
  }

  // Substring match for linkedin variants
  if (lower.includes("linkedin")) return "linkedin";

  // Heuristic: if it looks like a domain name, map to "website"
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(lower)) {
    return "website";
  }

  // Return trimmed original if no match
  return trimmed;
}

// Legacy: for any place that still needs a label+color pair
export const STATUS_OPTIONS: { value: ApplicationStatus; label: string; color: string }[] = [
  { value: "inbound", label: "Neuer Lead", color: STATUS_COLORS.inbound },
  { value: "applied", label: "Kontaktiert", color: STATUS_COLORS.applied },
  { value: "interview", label: "Verhandlung", color: STATUS_COLORS.interview },
  { value: "offer", label: "Abschluss", color: STATUS_COLORS.offer },
  { value: "rejected", label: "Verloren", color: STATUS_COLORS.rejected },
];
