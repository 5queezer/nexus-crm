import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { SettingsClient } from "@/components/settings-client";

export default async function SettingsPage() {
  const session = await requireAuth();

  if (!session) {
    redirect("/");
  }

  return <SettingsClient user={session.user} />;
}
