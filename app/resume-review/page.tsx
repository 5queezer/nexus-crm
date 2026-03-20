import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { AppHeader } from "@/components/app-header";
import { CvViewer } from "@/components/cv-viewer";

interface PageProps {
  searchParams: Promise<{ applicationId?: string }>;
}

export default async function ResumeReviewPage({ searchParams }: PageProps) {
  const session = await requireAuth();

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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader user={session.user} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CvViewer
          applications={applications}
          initialApplicationId={params.applicationId}
        />
      </main>
    </div>
  );
}
