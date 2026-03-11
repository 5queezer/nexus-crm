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
  resumeId: string | null;
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

// Preset source values for the source field
export const SOURCE_PRESETS = [
  "linkedin",
  "indeed",
  "company-site",
  "referral",
  "recruiter",
  "email",
  "ams",
  "other",
] as const;

// Legacy: for any place that still needs a label+color pair
export const STATUS_OPTIONS: { value: ApplicationStatus; label: string; color: string }[] = [
  { value: "inbound", label: "Eingehend", color: STATUS_COLORS.inbound },
  { value: "applied", label: "Beworben", color: STATUS_COLORS.applied },
  { value: "interview", label: "Interview", color: STATUS_COLORS.interview },
  { value: "offer", label: "Angebot", color: STATUS_COLORS.offer },
  { value: "rejected", label: "Abgelehnt", color: STATUS_COLORS.rejected },
];
