export type ApplicationStatus =
  | "applied"
  | "waiting"
  | "interview"
  | "rejected"
  | "offer"
  | "ghost"
  | "draft"
  | "inbound";

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
  resumeId: string | null;
  createdAt: string;
  updatedAt: string;
  contacts?: Contact[];
}

// Color mapping per status — labels come from i18n translations
export const STATUS_COLORS: Record<ApplicationStatus, string> = {
  applied: "bg-blue-100 text-blue-800 dark:bg-blue-500/25 dark:text-blue-300",
  waiting: "bg-yellow-100 text-yellow-800 dark:bg-amber-500/25 dark:text-amber-300",
  interview: "bg-purple-100 text-purple-800 dark:bg-purple-500/25 dark:text-purple-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-300",
  offer: "bg-green-100 text-green-800 dark:bg-emerald-500/25 dark:text-emerald-300",
  ghost: "bg-gray-100 text-gray-600 dark:bg-gray-500/25 dark:text-gray-300",
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-500/25 dark:text-slate-300",
  inbound: "bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-300",
};

// Row highlight colors for table
export const STATUS_ROW_COLORS: Record<ApplicationStatus, string> = {
  applied: "",
  waiting: "",
  interview: "bg-purple-50/40 dark:bg-purple-950/20",
  rejected: "bg-red-50/30 dark:bg-red-950/20",
  offer: "bg-green-50/40 dark:bg-green-950/20",
  ghost: "bg-gray-50/50 dark:bg-gray-800/30",
  draft: "",
  inbound: "",
};

// Ordered for Kanban display
export const STATUS_ORDER: ApplicationStatus[] = [
  "inbound",
  "draft",
  "applied",
  "waiting",
  "interview",
  "offer",
  "rejected",
  "ghost",
];

// Legacy: for any place that still needs a label+color pair
export const STATUS_OPTIONS: { value: ApplicationStatus; label: string; color: string }[] = [
  { value: "applied", label: "Beworben", color: STATUS_COLORS.applied },
  { value: "waiting", label: "Wartend", color: STATUS_COLORS.waiting },
  { value: "interview", label: "Interview", color: STATUS_COLORS.interview },
  { value: "rejected", label: "Abgelehnt", color: STATUS_COLORS.rejected },
  { value: "offer", label: "Angebot", color: STATUS_COLORS.offer },
  { value: "ghost", label: "Ghosted", color: STATUS_COLORS.ghost },
  { value: "draft", label: "Entwurf", color: STATUS_COLORS.draft },
  { value: "inbound", label: "Eingehend", color: STATUS_COLORS.inbound },
];
