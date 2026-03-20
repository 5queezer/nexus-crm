import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { ResumeAnalyzer } from "@/components/resume-analyzer";
import { AppHeader } from "@/components/app-header";

interface PageProps {
  searchParams: Promise<{ applicationId?: string }>;
}

export default async function ResumeReviewPage({ searchParams }: PageProps) {
  const session = await requireAuth();

  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  let jobDescription: string | undefined;
  let applicationId: string | undefined;

  if (params.applicationId) {
    try {
      const app = await getDb().getApplication(
        params.applicationId,
        session.readScopeUserId
      );
      if (app?.jobDescription) {
        jobDescription = app.jobDescription;
        applicationId = params.applicationId;
      }
    } catch {
      // Application not found or unauthorized — just proceed without JD
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader user={session.user} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ResumeAnalyzer
          initialJobDescription={jobDescription}
          applicationId={applicationId}
        />
      </main>
    </div>
  );
}
