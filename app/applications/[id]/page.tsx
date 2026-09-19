import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { applicationPath, isSafeApplicationId } from "@/lib/applications/slug";

interface ApplicationShortRouteProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}

export default async function ApplicationShortRoute({ params, searchParams }: ApplicationShortRouteProps) {
  const { id } = await params;
  const query = await searchParams;
  const tab = typeof query?.tab === "string" && ["activity", "brief", "materials", "contacts"].includes(query.tab) ? `?tab=${query.tab}` : "";
  const requestedPath = `/applications/${encodeURIComponent(id)}${tab}`;
  const session = await requireAuth();
  if (!session) redirect(`/login?callbackURL=${encodeURIComponent(requestedPath)}`);
  if (!isSafeApplicationId(id)) notFound();

  // Owner + ID is the complete identity. Unknown and foreign IDs deliberately
  // share the same not-found path.
  const application = await getDb().getApplication(id, session.userId);
  if (!application) notFound();

  redirect(applicationPath(application) + tab);
}
