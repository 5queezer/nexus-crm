import { redirect } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { requireAuth } from "@/lib/session";

export default async function ActivityPage() {
  const session = await requireAuth();
  if (!session) redirect("/login");
  return <ActivityFeed user={session.user} />;
}
