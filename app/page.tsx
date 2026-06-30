import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/session";
import { Dashboard } from "@/components/dashboard";
import { getDb } from "@/lib/db";
import { generateShortCode } from "@/lib/token";
import type { ShareLinkRecord } from "@/lib/db/types";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function ensureSharePageLink(userId: string): Promise<ShareLinkRecord | null> {
  if (userId === "dev-user") {
    return null;
  }

  const db = getDb();
  const existing = await db.findShareLink(userId, "share_page", null);
  if (existing) return existing;

  try {
    const created = await db.createShareLink(userId, {
      code: generateShortCode(),
      targetType: "share_page",
      targetId: null,
    });
    return (await db.findShareLink(userId, "share_page", null)) ?? created;
  } catch {
    return db.findShareLink(userId, "share_page", null);
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; source?: string | string[]; search?: string | string[] }>;
}) {
  const session = await requireAuth();
  const params = await searchParams;

  if (!session) {
    redirect("/login");
  }

  let shareUrl = "/share";
  const baseUrl = process.env.BETTER_AUTH_URL ?? "";
  const link = await ensureSharePageLink(session.user.id);
  if (link) {
    shareUrl = `${baseUrl}/s/${link.code}`;
  }

  return <Dashboard user={session.user} shareUrl={shareUrl} initialStatus={firstParam(params.status)} initialSource={firstParam(params.source)} initialSearch={firstParam(params.search)} />;
}
