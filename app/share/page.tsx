import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ApplicationStatus, STATUS_COLORS } from "@/types";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { de, enUS } from "date-fns/locale";

interface Document {
  id: number;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

// ── Translations ──────────────────────────────────────────────────────────────

type Lang = "de" | "en";

const TRANSLATIONS = {
  de: {
    title: "Bewerbungen von Christian Pojoni",
    subtitle: "Read-only Ansicht",
    readOnly: "Lesezugriff",
    stats: {
      total: "Gesamt",
      active: "Aktiv",
      offers: "Angebote",
      rejected: "Abgelehnt",
    },
    table: {
      heading: "Bewerbungen",
      company: "Firma",
      role: "Stelle",
      status: "Status",
      applied: "Beworben",
      lastContact: "Letzter Kontakt",
      followUp: "Follow-up",
      notes: "Notizen",
      empty: "Noch keine Bewerbungen eingetragen.",
    },
    status: {
      applied: "Beworben",
      waiting: "Wartend",
      interview: "Interview",
      rejected: "Abgelehnt",
      offer: "Angebot",
      ghost: "Ghosted",
      draft: "Entwurf",
    },
    footer: (count: number, date: string) =>
      `${count} Bewerbungen gesamt · Zuletzt aktualisiert: ${date} Uhr`,
    readOnlyNote:
      "Diese Seite ist schreibgeschützt. Nur Christian kann Änderungen vornehmen.",
    docs: {
      heading: "Dokumente",
      empty: "Keine Dokumente vorhanden.",
      download: "Herunterladen",
    },
  },
  en: {
    title: "Job Applications of Christian Pojoni",
    subtitle: "Read-only view",
    readOnly: "Read access",
    stats: {
      total: "Total",
      active: "Active",
      offers: "Offers",
      rejected: "Rejected",
    },
    table: {
      heading: "Applications",
      company: "Company",
      role: "Role",
      status: "Status",
      applied: "Applied",
      lastContact: "Last Contact",
      followUp: "Follow-up",
      notes: "Notes",
      empty: "No applications yet.",
    },
    status: {
      applied: "Applied",
      waiting: "Waiting",
      interview: "Interview",
      rejected: "Rejected",
      offer: "Offer",
      ghost: "Ghosted",
      draft: "Draft",
    },
    footer: (count: number, date: string) =>
      `${count} applications total · Last updated: ${date}`,
    readOnlyNote:
      "This is a read-only view. Only Christian can make changes.",
    docs: {
      heading: "Documents",
      empty: "No documents available.",
      download: "Download",
    },
  },
} satisfies Record<Lang, unknown>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveLang(raw: string | undefined): Lang {
  return raw === "en" ? "en" : "de";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  return "📎";
}

function formatDate(dateVal: Date | string | null, locale: Locale): string {
  if (!dateVal) return "—";
  try {
    return format(new Date(dateVal), "dd.MM.yyyy", { locale });
  } catch {
    return "—";
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  labels,
}: {
  status: ApplicationStatus;
  labels: Record<string, string>;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "yellow" | "green" | "gray";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    yellow: "bg-yellow-50 text-yellow-700",
    green: "bg-green-50 text-green-700",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <div className={`${colors[color]} rounded-xl p-4 text-center`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm font-medium mt-1">{label}</div>
    </div>
  );
}

function LangToggle({
  current,
  token,
}: {
  current: Lang;
  token: string;
}) {
  const other: Lang = current === "de" ? "en" : "de";
  return (
    <a
      href={`/share?token=${token}&lang=${other}`}
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-600 transition-colors"
      title={other === "en" ? "Switch to English" : "Auf Deutsch wechseln"}
    >
      {other === "en" ? "🇬🇧 EN" : "🇦🇹 DE"}
    </a>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface SharePageProps {
  searchParams: Promise<{ token?: string; lang?: string }>;
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const { token, lang: langParam } = await searchParams;
  const expectedToken = process.env.PUBLIC_READ_TOKEN;

  if (!expectedToken || !token || token !== expectedToken) {
    notFound();
  }

  const lang = resolveLang(langParam);
  const t = TRANSLATIONS[lang];
  const dateLocale = lang === "de" ? de : enUS;

  const applications = await prisma.application.findMany({
    orderBy: { createdAt: "desc" },
  });

  const documents = await prisma.document.findMany({
    orderBy: { uploadedAt: "desc" },
    select: { id: true, originalName: true, mimeType: true, size: true, uploadedAt: true },
  }) as Document[];

  const stats = {
    total: applications.length,
    active: applications.filter((a) =>
      ["applied", "waiting", "interview"].includes(a.status)
    ).length,
    offers: applications.filter((a) => a.status === "offer").length,
    rejected: applications.filter((a) => a.status === "rejected").length,
  };

  const tableHeaders = [
    t.table.company,
    t.table.role,
    t.table.status,
    t.table.applied,
    t.table.lastContact,
    t.table.followUp,
    t.table.notes,
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💼</span>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
                <p className="text-xs text-gray-500">{t.subtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LangToggle current={lang} token={token} />
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                {t.readOnly}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard label={t.stats.total} value={stats.total} color="blue" />
          <StatCard label={t.stats.active} value={stats.active} color="yellow" />
          <StatCard label={t.stats.offers} value={stats.offers} color="green" />
          <StatCard label={t.stats.rejected} value={stats.rejected} color="gray" />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">
              {t.table.heading} ({applications.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {tableHeaders.map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      {t.table.empty}
                    </td>
                  </tr>
                ) : (
                  applications.map((app) => (
                    <tr
                      key={app.id}
                      className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {app.company}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{app.role}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={app.status as ApplicationStatus}
                          labels={t.status}
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {formatDate(app.appliedAt, dateLocale)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {formatDate(app.lastContact, dateLocale)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {formatDate(app.followUpAt, dateLocale)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-gray-500 text-sm max-w-xs truncate block"
                          title={app.notes || ""}
                        >
                          {app.notes || "—"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
            {t.footer(
              applications.length,
              format(new Date(), "dd.MM.yyyy HH:mm", { locale: dateLocale })
            )}
          </div>
        </div>

        {/* Documents */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-8">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">
              {t.docs.heading} ({documents.length})
            </h2>
          </div>
          {documents.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">📭</div>
              <p>{t.docs.empty}</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/60 transition-colors"
                >
                  <span className="text-2xl flex-shrink-0">{fileIcon(doc.mimeType)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{doc.originalName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatBytes(doc.size)} ·{" "}
                      {format(new Date(doc.uploadedAt), "dd.MM.yyyy HH:mm", { locale: dateLocale })}
                    </p>
                  </div>
                  <a
                    href={`/api/documents/${doc.id}/file?token=${token}`}
                    download={doc.originalName}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                  >
                    ⬇ {t.docs.download}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          {t.readOnlyNote}
        </p>
      </main>
    </div>
  );
}

export const metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};
