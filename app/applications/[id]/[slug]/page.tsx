import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { applicationPath, applicationSlug } from "@/lib/applications/slug";
import { normalizeStatus } from "@/types";
import type { Application, Contact } from "@/types";
import type { ApplicationRecord, ContactRecord } from "@/lib/db/types";
import { ApplicationDetail } from "@/components/application-detail";

function toIso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
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
    createdAt: record.createdAt.toISOString(),
  };
}

function serializeApplication(record: ApplicationRecord): Application {
  return {
    id: record.id,
    company: record.company,
    role: record.role,
    status: normalizeStatus(record.status),
    appliedAt: toIso(record.appliedAt),
    lastContact: toIso(record.lastContact),
    notes: record.notes,
    followUpAt: toIso(record.followUpAt),
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
    workMode: record.workMode,
    eligibleCountries: record.eligibleCountries,
    primaryLocations: record.primaryLocations,
    officeDaysMin: record.officeDaysMin,
    travelPercent: record.travelPercent,
    visaSponsorship: record.visaSponsorship,
    rightToWorkRequired: record.rightToWorkRequired,
    timezoneOverlap: record.timezoneOverlap,
    salaryCurrency: record.salaryCurrency,
    salaryPeriod: record.salaryPeriod,
    salaryType: record.salaryType,
    jobSummary: record.jobSummary,
    currentStage: record.currentStage,
  };
}

interface ApplicationDetailPageProps {
  params: Promise<{ id: string; slug: string }>;
}

export async function generateMetadata({
  params,
}: ApplicationDetailPageProps): Promise<Metadata> {
  const session = await requireAuth();
  if (!session) return { robots: { index: false, follow: false } };

  const { id } = await params;
  const record = await getDb().getApplication(id, session.userId);
  if (!record) return { robots: { index: false, follow: false } };

  return {
    title: `${record.company} — ${record.role} | Nexus CRM`,
    alternates: { canonical: applicationPath(record) },
    robots: { index: false, follow: false },
  };
}

export default async function ApplicationDetailPage({ params }: ApplicationDetailPageProps) {
  const { id, slug } = await params;
  const requestedPath = `/applications/${encodeURIComponent(id)}/${encodeURIComponent(slug)}`;
  const session = await requireAuth();
  if (!session) redirect(`/login?callbackURL=${encodeURIComponent(requestedPath)}`);

  // The ID plus the authenticated owner is the only lookup key. The slug is
  // presentation-only and is never sent to a database query.
  const record = await getDb().getApplication(id, session.userId);
  if (!record) notFound();

  const canonicalSlug = applicationSlug(record.company, record.role);
  const canonicalPath = applicationPath(record);
  if (slug !== canonicalSlug) redirect(canonicalPath);

  return (
    <ApplicationDetail
      user={session.user}
      application={serializeApplication(record)}
      canonicalPath={canonicalPath}
    />
  );
}
