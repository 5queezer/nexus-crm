import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { CvViewer } from "@/components/cv-viewer";

interface PageProps {
  searchParams: Promise<{ applicationId?: string }>;
}

export default async function ResumeReviewPage({ searchParams }: PageProps) {
  const session = await requireAuth();
  const t = await getTranslations("nav");

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;

  // Fetch all non-archived applications for the selector
  const allApps = await getDb().listApplications(session.readScopeUserId);
  const applications = allApps
    .filter((a) => !a.archivedAt)
    .map((a) => ({
      id: a.id,
      company: a.company,
      role: a.role,
      jobDescription: a.jobDescription,
    }));

  return (
    <AppShell user={session.user} breadcrumbs={[{ label: t("resume_ai") }]}>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CvViewer
          applications={applications}
          initialApplicationId={params.applicationId}
        />
      </main>
    </AppShell>
  );
}
