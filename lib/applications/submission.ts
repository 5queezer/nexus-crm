import { createHash } from "node:crypto";

export interface SubmissionAnswerInput {
  key?: string;
  question: string;
  answer: string;
  kind?: "text" | "boolean" | "number" | "choice" | "salary" | "other";
  sensitive?: boolean;
}

export interface HealthApplication {
  id: string;
  status: string;
  appliedAt: Date | string | null;
  followUpAt: Date | string | null;
}

export interface HealthSubmission {
  id: string;
  applicationId: string;
  answers: unknown[];
  documentIds: string[];
}

export interface HealthDocument {
  id: string;
  applicationIds: string[];
  state?: string;
}

export interface ApplicationHealthFinding {
  code:
    | "applied_without_date"
    | "date_without_applied_status"
    | "applied_without_submission"
    | "missing_next_action"
    | "overdue_follow_up"
    | "submission_without_answers"
    | "submission_without_materials"
    | "orphan_document";
  severity: "info" | "warning" | "error";
  applicationId?: string;
  submissionId?: string;
  documentId?: string;
  message: string;
  remediation: string;
}

const TRACKING_PARAMS = new Set([
  "ref",
  "source",
  "campaign",
  "mc_cid",
  "mc_eid",
  "gclid",
  "fbclid",
]);

function stableSerialize(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function submissionRequestHash(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

export function canonicalizeJobUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const url = new URL(raw.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Job URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Job URL must not contain credentials");
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  const keys: string[] = [];
  url.searchParams.forEach((_value, key) => keys.push(key));
  for (const key of keys) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\?$/, "").replace(/\/$/, url.pathname === "/" ? "/" : "");
}

export function validateSubmissionAnswers(
  answers: SubmissionAnswerInput[],
): SubmissionAnswerInput[] {
  if (!Array.isArray(answers)) throw new Error("answers must be an array");
  if (answers.length > 50) throw new Error("A submission supports at most 50 answers");
  const validated = answers.map((raw, index) => {
    const question = String(raw.question ?? "").trim();
    const answer = String(raw.answer ?? "");
    if (!question) throw new Error(`Answer ${index + 1} requires a question`);
    if (question.length > 2000) throw new Error("Questions must be at most 2000 characters");
    if (answer.length > 20_000) throw new Error("Answers must be at most 20000 characters");
    const key = raw.key?.trim();
    if (key && key.length > 100) throw new Error("Answer keys must be at most 100 characters");
    const kind = raw.kind;
    if (kind !== undefined && !["text", "boolean", "number", "choice", "salary", "other"].includes(kind)) {
      throw new Error(`Answer ${index + 1} has an invalid kind`);
    }
    if (raw.sensitive !== undefined && typeof raw.sensitive !== "boolean") {
      throw new Error(`Answer ${index + 1} sensitive must be a boolean`);
    }
    return {
      ...(key ? { key } : {}),
      question,
      answer,
      ...(kind ? { kind } : {}),
      ...(raw.sensitive !== undefined ? { sensitive: raw.sensitive } : {}),
    };
  });
  if (Buffer.byteLength(JSON.stringify(validated), "utf8") > 750_000) {
    throw new Error("Submission answers exceed the 750000-byte storage limit");
  }
  return validated;
}

export function validateEventMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("event_metadata_invalid");
  const metadata = value as Record<string, unknown>;
  const entries = Object.entries(metadata);
  if (entries.length > 100 || entries.some(([key]) => !key || key.length > 100)) {
    throw new Error("event_metadata_invalid");
  }
  if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > 32_000) {
    throw new Error("event_metadata_too_large");
  }
  return metadata;
}

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function computeApplicationHealth(input: {
  applications: HealthApplication[];
  submissions: HealthSubmission[];
  documents: HealthDocument[];
  now?: Date;
}): ApplicationHealthFinding[] {
  const now = input.now ?? new Date();
  const findings: ApplicationHealthFinding[] = [];
  const submissionsByApplication = new Map<string, HealthSubmission[]>();
  for (const submission of input.submissions) {
    const existing = submissionsByApplication.get(submission.applicationId) ?? [];
    existing.push(submission);
    submissionsByApplication.set(submission.applicationId, existing);
    if (submission.answers.length === 0) {
      findings.push({
        code: "submission_without_answers",
        severity: "warning",
        applicationId: submission.applicationId,
        submissionId: submission.id,
        message: "The submission does not preserve any application answers.",
        remediation: "Record the exact submitted answers or explicitly confirm the form had none.",
      });
    }
    if (submission.documentIds.length === 0) {
      findings.push({
        code: "submission_without_materials",
        severity: "error",
        applicationId: submission.applicationId,
        submissionId: submission.id,
        message: "The submission has no preserved submitted materials.",
        remediation: "Link the exact submitted CV and other uploaded files.",
      });
    }
  }

  for (const application of input.applications) {
    const appliedAt = asDate(application.appliedAt);
    const followUpAt = asDate(application.followUpAt);
    const isApplied = ["applied", "interview", "offer", "rejected"].includes(application.status);
    if (isApplied && !appliedAt) {
      findings.push({
        code: "applied_without_date",
        severity: "error",
        applicationId: application.id,
        message: "The application is applied-or-later but has no appliedAt timestamp.",
        remediation: "Record the confirmed submission timestamp.",
      });
    }
    if (!isApplied && appliedAt) {
      findings.push({
        code: "date_without_applied_status",
        severity: "warning",
        applicationId: application.id,
        message: "The lead has an appliedAt timestamp but is not in an applied-or-later status.",
        remediation: "Correct the status or clear the application timestamp.",
      });
    }
    if (["applied", "interview", "offer"].includes(application.status)) {
      if ((submissionsByApplication.get(application.id) ?? []).length === 0) {
        findings.push({
          code: "applied_without_submission",
          severity: "error",
          applicationId: application.id,
          message: "No structured submission package is stored for this active application.",
          remediation: "Record the submitted answers and exact submitted materials.",
        });
      }
      if (!followUpAt) {
        findings.push({
          code: "missing_next_action",
          severity: "warning",
          applicationId: application.id,
          message: "The active application has no follow-up date.",
          remediation: "Set the next follow-up or interview action.",
        });
      } else if (followUpAt.getTime() < now.getTime()) {
        findings.push({
          code: "overdue_follow_up",
          severity: "warning",
          applicationId: application.id,
          message: "The follow-up date is overdue.",
          remediation: "Complete or reschedule the follow-up.",
        });
      }
    }
  }

  for (const document of input.documents) {
    if (document.applicationIds.length === 0) {
      findings.push({
        code: "orphan_document",
        severity: "info",
        documentId: document.id,
        message: "The document is not linked to an application.",
        remediation: "Link, classify as intentionally orphaned, archive, or delete after review.",
      });
    }
  }

  return findings;
}
