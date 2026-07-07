import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { normalizeStatus } from "@/types";
import { format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { SharePortal, type SharedApplication } from "@/components/share-portal";

type Lang = "de" | "en";

function resolveLang(raw: string | undefined): Lang {
  return raw === "en" ? "en" : "de";
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface SharePageProps {
  searchParams: Promise<{ code?: string | string[]; lang?: string | string[] }>;
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const code = firstParam(params.code);
  const lang = resolveLang(firstParam(params.lang));

  if (!code) {
    notFound();
  }

  const db = getDb();
  const link = await db.getShareLinkByCode(code);
  if (!link || link.targetType !== "share_page") {
    notFound();
  }

  const allApplications = await db.listApplications(link.userId);

  // Expose only the fields the public portal renders — nothing else leaves the server.
  const applications: SharedApplication[] = allApplications
    .filter((a) => !a.archivedAt)
    .map((a) => ({
      id: a.id,
      company: a.company,
      role: a.role,
      status: normalizeStatus(a.status),
      appliedAt: toIso(a.appliedAt),
      lastContact: toIso(a.lastContact),
      followUpAt: toIso(a.followUpAt),
      notes: a.notes,
    }));

  const ownerUser = await db.getUser(link.userId);
  const generatedAt = format(new Date(), "dd.MM.yyyy HH:mm", {
    locale: lang === "de" ? de : enUS,
  });

  return (
    <SharePortal
      applications={applications}
      ownerName={ownerUser?.name ?? null}
      lang={lang}
      code={code}
      generatedAt={generatedAt}
    />
  );
}

export const metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};
