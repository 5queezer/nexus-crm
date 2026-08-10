import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { normalizeStatus } from "@/types";
import type { Application, Contact } from "@/types";
import type { ApplicationRecord, ContactRecord } from "@/lib/db/types";
import { ApplicationDetail } from "@/components/application-detail";

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeContact(record: ContactRecord): Contact {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    role: record.role,
    linkedIn: record.linkedIn,
    applicationId: record.applicationId,
    createdAt: toIso(record.createdAt) ?? "",
  };
}

// ApplicationRecord carries Date objects and server-only fields; the client
// component expects the plain Application shape with ISO strings.
function serializeApplication(record: ApplicationRecord): Application {
  return {
    id: record.id,
    isDemo: record.isDemo,
    demoWorkspaceId: record.demoWorkspaceId,
    demoKey: record.demoKey,
    company: record.company,
    role: record.role,
    status: normalizeStatus(record.status),
    appliedAt: toIso(record.appliedAt),
    lastContact: toIso(record.lastContact),
    followUpAt: toIso(record.followUpAt),
    notes: record.notes,
    jobDescription: record.jobDescription,
    source: record.source,
    remote: record.remote,
    salaryMin: record.salaryMin,
    salaryMax: record.salaryMax,
    rating: record.rating,
    jobUrl: record.jobUrl,
    resumeId: record.resumeId,
    companySize: record.companySize as Application["companySize"],
    salaryBandMentioned: record.salaryBandMentioned,
    triageQuality: record.triageQuality as Application["triageQuality"],
    triageReason: record.triageReason,
    incomingSource: record.incomingSource as Application["incomingSource"],
    autoRejected: record.autoRejected,
    autoRejectReason: record.autoRejectReason,
    archivedAt: toIso(record.archivedAt),
    createdAt: toIso(record.createdAt) ?? "",
    updatedAt: toIso(record.updatedAt) ?? "",
    contacts: record.contacts?.map(serializeContact),
  };
}

interface ApplicationDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: ApplicationDetailPageProps): Promise<Metadata> {
  const session = await requireAuth();
  if (!session) return {};
  const { id } = await params;
  const record = await getDb().getApplication(id, session.readScopeUserId);
  if (!record) return {};
  return { title: `${record.company} — ${record.role}` };
}

export default async function ApplicationDetailPage({
  params,
}: ApplicationDetailPageProps) {
  const session = await requireAuth();
  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  const record = await getDb().getApplication(id, session.readScopeUserId);
  if (!record) {
    notFound();
  }

  return (
    <ApplicationDetail
      user={session.user}
      application={serializeApplication(record)}
    />
  );
}
