import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { ApplicationStatus, STATUS_COLORS } from "@/types";
import type { ApplicationRecord } from "@/lib/db/types";
import { format, isPast, isToday } from "date-fns";
import type { Locale } from "date-fns";
import { de, enUS } from "date-fns/locale";

type Lang = "de" | "en";

const TRANSLATIONS = {
  de: {
    title: (name: string | null) => name ? `Bewerbungen von ${name}` : "Bewerbungsübersicht",
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
      inbound: "Eingehend",
      applied: "Beworben",
      interview: "Interview",
      offer: "Angebot",
      rejected: "Abgelehnt",
    },
    footer: (count: number, date: string) =>
      `${count} Bewerbungen gesamt · Zuletzt aktualisiert: ${date} Uhr`,
    readOnlyNote:
      "Diese Seite ist schreibgeschützt. Nur der Eigentümer kann Änderungen vornehmen.",
  },
  en: {
    title: (name: string | null) => name ? `Job Applications of ${name}` : "Job Applications",
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
      inbound: "Inbound",
      applied: "Applied",
      interview: "Interview",
      offer: "Offer",
      rejected: "Rejected",
    },
    footer: (count: number, date: string) =>
      `${count} applications total · Last updated: ${date}`,
    readOnlyNote:
      "This is a read-only view. Only the owner can make changes.",
  },
} as const;

function resolveLang(raw: string | undefined): Lang {
  return raw === "en" ? "en" : "de";
}

function formatDate(dateVal: Date | string | null, locale: Locale): string {
  if (!dateVal) return "—";
  try {
    return format(new Date(dateVal), "dd.MM.yyyy", { locale });
  } catch {
    return "—";
  }
}

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
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors"
      title={other === "en" ? "Switch to English" : "Auf Deutsch wechseln"}
    >
      {other === "en" ? "🇬🇧 EN" : "🇦🇹 DE"}
    </a>
  );
}

function ReadonlyApplicationCard({
  app,
  labels,
  tableLabels,
  dateLocale,
}: {
  app: ApplicationRecord;
  labels: Record<string, string>;
  tableLabels: {
    company: string;
    role: string;
    status: string;
    applied: string;
    lastContact: string;
    followUp: string;
    notes: string;
    empty: string;
    heading: string;
  };
  dateLocale: Locale;
}) {
  const followUpDate = app.followUpAt ? new Date(app.followUpAt) : null;
  const isOverdue = followUpDate && isPast(followUpDate) && !isToday(followUpDate);
  const isDueToday = followUpDate && isToday(followUpDate);

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">{app.company}</h3>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{app.role}</p>
        </div>
        <div className="shrink-0">
          <StatusBadge status={app.status as ApplicationStatus} labels={labels} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{tableLabels.applied}</div>
          <div className="mt-1 text-gray-700 dark:text-gray-300">{formatDate(app.appliedAt, dateLocale)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{tableLabels.followUp}</div>
          <div className={`mt-1 font-medium ${
            isOverdue ? "text-red-600 dark:text-red-400" : isDueToday ? "text-orange-500 dark:text-orange-400" : "text-gray-700 dark:text-gray-300"
          }`}>
            {followUpDate ? `${isOverdue ? "⚠ " : isDueToday ? "🔔 " : ""}${formatDate(followUpDate, dateLocale)}` : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{tableLabels.lastContact}</div>
          <div className="mt-1 text-gray-700 dark:text-gray-300">{formatDate(app.lastContact, dateLocale)}</div>
        </div>
      </div>

      {app.notes && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
          {app.notes}
        </div>
      )}
    </article>
  );
}

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

  const db = getDb();
  const allApplications = await db.listApplications(null);
  const applications = allApplications.filter((a) => !a.archivedAt);

  const ownerUser = applications[0]?.userId
    ? await db.getUser(applications[0].userId)
    : null;
  const ownerName = ownerUser?.name ?? null;

  const stats = {
    total: applications.length,
    active: applications.filter((a) =>
      ["applied", "interview"].includes(a.status)
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 h-16">
            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 text-2xl">💼</span>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold text-gray-900 dark:text-white sm:text-xl">{t.title(ownerName)}</h1>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{t.subtitle}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <LangToggle current={lang} token={token} />
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                {t.readOnly}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard label={t.stats.total} value={stats.total} color="blue" />
          <StatCard label={t.stats.active} value={stats.active} color="yellow" />
          <StatCard label={t.stats.offers} value={stats.offers} color="green" />
          <StatCard label={t.stats.rejected} value={stats.rejected} color="gray" />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t.table.heading} ({applications.length})
            </h2>
          </div>

          <div className="p-3 md:hidden">
            {applications.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
                {t.table.empty}
              </div>
            ) : (
              <div className="space-y-3">
                {applications.map((app) => (
                  <ReadonlyApplicationCard
                    key={app.id}
                    app={app}
                    labels={t.status}
                    tableLabels={t.table}
                    dateLocale={dateLocale}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
                  {tableHeaders.map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-4 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {applications.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400 dark:text-gray-500">
                      {t.table.empty}
                    </td>
                  </tr>
                ) : (
                  applications.map((app) => (
                    <tr
                      key={app.id}
                      className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                        {app.company}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{app.role}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={app.status as ApplicationStatus}
                          labels={t.status}
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm">
                        {formatDate(app.appliedAt, dateLocale)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm">
                        {formatDate(app.lastContact, dateLocale)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-sm">
                        {formatDate(app.followUpAt, dateLocale)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-gray-500 dark:text-gray-400 text-sm max-w-xs truncate block"
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

          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
            {t.footer(
              applications.length,
              format(new Date(), "dd.MM.yyyy HH:mm", { locale: dateLocale })
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
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
