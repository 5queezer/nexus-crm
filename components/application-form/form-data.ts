import {
  Application,
  ApplicationStatus,
  Contact,
  CompanySize,
  IncomingSource,
} from "@/types";
import { toDateInputValue } from "@/lib/applications/defaults";
import { toLocalCalendarInputValue } from "@/lib/applications/local-calendar";

export interface ApplicationFormData {
  company: string;
  role: string;
  status: ApplicationStatus;
  appliedAt: string;
  lastContact: string;
  followUpAt: string;
  notes: string;
  jobDescription: string;
  source: string;
  remote: boolean;
  salaryMin: string;
  salaryMax: string;
  rating: number | null;
  jobUrl: string;
  companySize: CompanySize | "";
  salaryBandMentioned: boolean;
  triageQuality: number | null;
  triageReason: string;
  incomingSource: IncomingSource | "";
  autoRejected: boolean;
  autoRejectReason: string;
}

export interface ContactFormRow {
  /** Stable identity so async updaters never target a shifted array index. */
  clientId: string;
  id?: string; // set when persisted
  name: string;
  email: string;
  role: string;
  linkedIn: string;
  isDirty: boolean;
  isNew: boolean;
}

function toDateInput(dateStr: string | null | undefined): string {
  return toLocalCalendarInputValue(dateStr);
}

export function toFormData(
  application: Application | null,
): ApplicationFormData {
  return {
    company: application?.company || "",
    role: application?.role || "",
    status: (application?.status as ApplicationStatus) || "inbound",
    appliedAt:
      toDateInput(application?.appliedAt) ||
      (application ? "" : toDateInputValue()),
    lastContact: toDateInput(application?.lastContact),
    followUpAt: toDateInput(application?.followUpAt),
    notes: application?.notes || "",
    jobDescription: application?.jobDescription || "",
    source: application?.source || "",
    remote: application?.remote ?? false,
    salaryMin:
      application?.salaryMin != null ? String(application.salaryMin) : "",
    salaryMax:
      application?.salaryMax != null ? String(application.salaryMax) : "",
    rating: application?.rating ?? null,
    jobUrl: application?.jobUrl || "",
    companySize: (application?.companySize as CompanySize) || "",
    salaryBandMentioned: application?.salaryBandMentioned ?? false,
    triageQuality: application?.triageQuality ?? null,
    triageReason: application?.triageReason || "",
    incomingSource: (application?.incomingSource as IncomingSource) || "",
    autoRejected: application?.autoRejected ?? false,
    autoRejectReason: application?.autoRejectReason || "",
  };
}

export function serializeForm(data: ApplicationFormData) {
  return {
    ...data,
    appliedAt: data.appliedAt || null,
    lastContact: data.lastContact || null,
    followUpAt: data.followUpAt || null,
    notes: data.notes || null,
    jobDescription: data.jobDescription || null,
    source: data.source || null,
    salaryMin: data.salaryMin ? parseInt(data.salaryMin, 10) : null,
    salaryMax: data.salaryMax ? parseInt(data.salaryMax, 10) : null,
    rating: data.rating,
    jobUrl: data.jobUrl || null,
    companySize: data.companySize || null,
    salaryBandMentioned: data.salaryBandMentioned,
    triageQuality: data.triageQuality,
    triageReason: data.triageReason || null,
    incomingSource: data.incomingSource || null,
    autoRejected: data.autoRejected,
    autoRejectReason: data.autoRejectReason || null,
  };
}

export async function createApplication(
  data: ApplicationFormData,
): Promise<Application> {
  const res = await fetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializeForm(data)),
  });
  if (!res.ok) throw new Error("Failed to create application");
  return res.json();
}

export class UpdateConflictError extends Error {
  constructor() {
    super("update_conflict");
    this.name = "UpdateConflictError";
  }
}

export async function updateApplication(
  id: string,
  data: ApplicationFormData,
  expectedUpdatedAt?: string | null,
): Promise<Application> {
  const res = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...serializeForm(data),
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    }),
  });
  if (res.status === 409) throw new UpdateConflictError();
  if (!res.ok) throw new Error("Failed to update application");
  return res.json();
}

export interface ContactPayload {
  name: string;
  email: string;
  role: string;
  linkedIn: string;
}

export async function createContact(
  applicationId: string,
  contact: ContactPayload,
): Promise<Contact> {
  const res = await fetch(`/api/applications/${applicationId}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contact),
  });
  if (!res.ok) throw new Error("Failed to create contact");
  return res.json();
}

export async function updateContact(
  applicationId: string,
  contactId: string,
  contact: Partial<ContactFormRow>,
): Promise<Contact> {
  const res = await fetch(
    `/api/applications/${applicationId}/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contact),
    },
  );
  if (!res.ok) throw new Error("Failed to update contact");
  return res.json();
}

export async function deleteContact(
  applicationId: string,
  contactId: string,
): Promise<void> {
  const res = await fetch(
    `/api/applications/${applicationId}/contacts/${contactId}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) throw new Error("Failed to delete contact");
}

export function contactToRow(c: Contact): ContactFormRow {
  return {
    clientId: c.id,
    id: c.id,
    name: c.name,
    email: c.email || "",
    role: c.role || "",
    linkedIn: c.linkedIn || "",
    isDirty: false,
    isNew: false,
  };
}
