import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { Dashboard } from "@/components/dashboard";
import { getDb } from "@/lib/db";
import { generateShortCode } from "@/lib/token";

export default async function Home() {
  const session = await requireAuth();

  if (!session) {
    redirect("/login");
  }

  let shareUrl = "/share";
  const shareToken = process.env.PUBLIC_READ_TOKEN ?? "";
  if (shareToken) {
    const db = getDb();
    const baseUrl = process.env.BETTER_AUTH_URL ?? "";
    let link = await db.findShareLink(session.user.id, "share_page", null);
    if (!link) {
      link = await db.createShareLink(session.user.id, {
        code: generateShortCode(),
        targetType: "share_page",
        targetId: null,
      });
    }
    shareUrl = `${baseUrl}/s/${link.code}`;
  }

  return <Dashboard user={session.user} shareUrl={shareUrl} />;
}
