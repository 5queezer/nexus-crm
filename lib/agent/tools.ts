import type { DatabaseAdapter } from "@/lib/db/adapter";

export async function getPipelineSummary(db: DatabaseAdapter, userId: string) {
  const applications = await db.listApplications(userId);
  const byStatus: Record<string, number> = {};
  let overdueFollowUps = 0;
  const now = Date.now();
  for (const application of applications) {
    byStatus[application.status] = (byStatus[application.status] ?? 0) + 1;
    if (
      application.followUpAt &&
      application.followUpAt.getTime() < now &&
      !["offer", "rejected"].includes(application.status)
    ) {
      overdueFollowUps += 1;
    }
  }
  return { total: applications.length, byStatus, overdueFollowUps };
}

export async function searchApplicationsForAgent(
  db: DatabaseAdapter,
  userId: string,
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  const applications = await db.listApplications(userId);
  return applications
    .filter((application) => {
      if (!normalized) return true;
      return [application.company, application.role, application.status, application.source]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    })
    .slice(0, 25)
    .map((application) => ({
      id: application.id,
      company: application.company,
      role: application.role,
      status: application.status,
      followUpAt: application.followUpAt?.toISOString() ?? null,
      rating: application.rating,
      workMode: application.workMode,
      updatedAt: application.updatedAt.toISOString(),
    }));
}

export async function getApplicationForAgent(
  db: DatabaseAdapter,
  userId: string,
  applicationId: string,
) {
  const application = await db.getApplication(applicationId, userId);
  if (!application) return null;
  return {
    id: application.id,
    company: application.company,
    role: application.role,
    status: application.status,
    appliedAt: application.appliedAt?.toISOString() ?? null,
    lastContact: application.lastContact?.toISOString() ?? null,
    followUpAt: application.followUpAt?.toISOString() ?? null,
    notes: application.notes,
    rating: application.rating,
    source: application.source,
    jobUrl: application.jobUrl,
    workMode: application.workMode,
    salaryMin: application.salaryMin,
    salaryMax: application.salaryMax,
    salaryCurrency: application.salaryCurrency,
    jobSummary: application.jobSummary,
    untrustedJobDescription: application.jobDescription?.slice(0, 4_000) ?? null,
    updatedAt: application.updatedAt.toISOString(),
  };
}
