import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { applicationPath } from "@/lib/applications/slug";

interface ApplicationShortRouteProps {
  params: Promise<{ id: string }>;
}

export default async function ApplicationShortRoute({ params }: ApplicationShortRouteProps) {
  const { id } = await params;
  const requestedPath = `/applications/${encodeURIComponent(id)}`;
  const session = await requireAuth();
  if (!session) redirect(`/login?callbackURL=${encodeURIComponent(requestedPath)}`);

  // Owner + ID is the complete identity. Unknown and foreign IDs deliberately
  // share the same not-found path.
  const application = await getDb().getApplication(id, session.userId);
  if (!application) notFound();

  redirect(applicationPath(application));
}
