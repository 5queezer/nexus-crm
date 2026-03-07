import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { Dashboard } from "@/components/dashboard";

export default async function Home() {
  const session = await requireAuth();

  if (!session) {
    redirect("/login");
  }

  const shareToken = process.env.PUBLIC_READ_TOKEN ?? "";
  const shareUrl = shareToken
    ? `${process.env.BETTER_AUTH_URL ?? ""}/share?token=${shareToken}`
    : "/share";

  return <Dashboard user={session.user} shareUrl={shareUrl} />;
}
