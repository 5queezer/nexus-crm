import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { getDb } from "@/lib/db";
import { ResumeAnalyzer } from "@/components/resume-analyzer";
import { getTranslations } from "next-intl/server";

interface PageProps {
  searchParams: Promise<{ applicationId?: string }>;
}

export default async function ResumeReviewPage({ searchParams }: PageProps) {
  const session = await requireAuth();

  if (!session) {
    redirect("/login");
  }

  const t = await getTranslations("resume_page");
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
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <a
                href="/"
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                ← {t("back")}
              </a>
              <span className="text-2xl">🤖</span>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                {t("title")}
              </h1>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ResumeAnalyzer
          initialJobDescription={jobDescription}
          applicationId={applicationId}
        />
      </main>
    </div>
  );
}
