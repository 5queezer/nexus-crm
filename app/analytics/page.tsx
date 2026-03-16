import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";

export default async function AnalyticsPage() {
  const session = await requireAuth();

  if (!session) {
    redirect("/login");
  }

  return <AnalyticsDashboard />;
}
