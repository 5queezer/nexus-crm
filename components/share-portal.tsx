"use client";

import { useMemo, useState } from "react";
import { format, isPast, isToday } from "date-fns";
import type { Locale } from "date-fns";
import { de, enUS } from "date-fns/locale";
import {
  AlertTriangle,
  BellRing,
  BriefcaseBusiness,
  Inbox,
  Lock,
  Search,
  X,
} from "lucide-react";
import { ApplicationStatus, STATUS_COLORS, STATUS_ORDER } from "@/types";

export interface SharedApplication {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  lastContact: string | null;
  followUpAt: string | null;
  notes: string | null;
}

type Lang = "de" | "en";

// Aggregate tiles double as filters; legend chips filter single stages.
type Filter = "all" | "active" | ApplicationStatus;

const TRANSLATIONS = {
  de: {
    eyebrow: "Kundenportal",
    title: (name: string | null) =>
      name ? `Portfolio von ${name}` : "Kundenübersicht",
    readOnly: "Lesezugriff",
    langToggle: "EN",
    langToggleTitle: "Switch to English",
    stats: {
      total: "Gesamt",
      active: "Aktiv",
      offers: "Abschluss",
      rejected: "Verloren",
    },
    pipeline: "Pipeline",
    status: {
      inbound: "Neuer Lead",
      applied: "Kontaktiert",
      interview: "Verhandlung",
      offer: "Abschluss",
      rejected: "Verloren",
    } as Record<ApplicationStatus, string>,
    table: {
      heading: "Opportunities",
      company: "Kunde",
      role: "Projekt",
      status: "Status",
      applied: "Erstellt",
      lastContact: "Letzter Kontakt",
      followUp: "Follow-up",
      notes: "Notizen",
    },
    searchPlaceholder: "Kunde oder Projekt suchen …",
    empty: "Noch keine Opportunities eingetragen.",
    noMatches: "Keine Treffer für die aktuelle Auswahl.",
    clearFilters: "Filter zurücksetzen",
    overdue: "Überfällig",
    dueToday: "Heute fällig",
    footer: (count: number, date: string) =>
      `${count} Opportunities gesamt · Zuletzt aktualisiert: ${date} Uhr`,
    readOnlyNote:
      "Diese Seite ist schreibgeschützt. Nur autorisierte Benutzer können Änderungen vornehmen.",
  },
  en: {
    eyebrow: "Client Portal",
    title: (name: string | null) =>
      name ? `Portfolio of ${name}` : "Client Portfolio",
    readOnly: "Read access",
    langToggle: "DE",
    langToggleTitle: "Auf Deutsch wechseln",
    stats: {
      total: "Total",
      active: "Active",
      offers: "Closing",
      rejected: "Lost",
    },
    pipeline: "Pipeline",
    status: {
      inbound: "New Lead",
      applied: "Contacted",
      interview: "Negotiation",
      offer: "Closing",
      rejected: "Lost",
    } as Record<ApplicationStatus, string>,
    table: {
      heading: "Opportunities",
      company: "Account",
      role: "Opportunity",
      status: "Status",
      applied: "Created",
      lastContact: "Last Contact",
      followUp: "Follow-up",
      notes: "Notes",
    },
    searchPlaceholder: "Search account or opportunity …",
    empty: "No opportunities yet.",
    noMatches: "Nothing matches the current selection.",
    clearFilters: "Clear filters",
    overdue: "Overdue",
    dueToday: "Due today",
    footer: (count: number, date: string) =>
      `${count} opportunities total · Last updated: ${date}`,
    readOnlyNote:
      "This is a read-only view. Only authorized users can make changes.",
  },
} as const;

// Pipeline bar fills, validated for CVD separation and surface contrast
// (light: full pass; dark: floor band, relieved by segment gaps + labeled legend).
const BAR_COLORS: Record<ApplicationStatus, string> = {
  inbound: "bg-[#0d9488]",
  applied: "bg-[#2563eb] dark:bg-[#1d4ed8]",
  interview: "bg-[#c084fc] dark:bg-[#a855f7]",
  offer: "bg-[#059669]",
  rejected: "bg-[#dc2626]",
};

function formatDate(value: string | null, locale: Locale): string {
  if (!value) return "—";
  try {
    return format(new Date(value), "dd.MM.yyyy", { locale });
  } catch {
    return "—";
  }
}

function StatusBadge({
  status,
  labels,
}: {
  status: ApplicationStatus;
  labels: Record<ApplicationStatus, string>;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function FollowUpValue({
  value,
  locale,
  overdueLabel,
  dueTodayLabel,
}: {
  value: string | null;
  locale: Locale;
  overdueLabel: string;
  dueTodayLabel: string;
}) {
  if (!value) return <span className="nexus-muted">—</span>;
  const date = new Date(value);
  const overdue = isPast(date) && !isToday(date);
  const dueToday = isToday(date);
  if (overdue) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        <span>{formatDate(value, locale)}</span>
        <span className="sr-only">({overdueLabel})</span>
      </span>
    );
  }
  if (dueToday) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
        <BellRing className="h-3.5 w-3.5" aria-hidden />
        <span>{formatDate(value, locale)}</span>
        <span className="sr-only">({dueTodayLabel})</span>
      </span>
    );
  }
  return <span className="text-slate-700 dark:text-slate-300">{formatDate(value, locale)}</span>;
}

function StatTile({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[4.5rem] rounded-2xl border px-3 py-3 text-center transition sm:px-4 ${
        active
          ? "border-indigo-500 bg-indigo-50 shadow-sm dark:border-[#7170ff] dark:bg-[#5e6ad2]/15"
          : "border-slate-200/80 bg-white/90 hover:border-slate-300 hover:bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.035] dark:hover:border-white/[0.14] dark:hover:bg-white/[0.06]"
      }`}
    >
      <div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
        {value}
      </div>
      <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400 sm:text-sm">
        {label}
      </div>
    </button>
  );
}

export function SharePortal({
  applications,
  ownerName,
  lang,
  code,
  generatedAt,
}: {
  applications: SharedApplication[];
  ownerName: string | null;
  lang: Lang;
  code: string;
  generatedAt: string;
}) {
  const t = TRANSLATIONS[lang];
  const dateLocale = lang === "de" ? de : enUS;
  const otherLang: Lang = lang === "de" ? "en" : "de";

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
      ApplicationStatus,
      number
    >;
    for (const app of applications) {
      if (counts[app.status] !== undefined) counts[app.status] += 1;
    }
    return counts;
  }, [applications]);

  const stats = {
    total: applications.length,
    active: statusCounts.applied + statusCounts.interview,
    offers: statusCounts.offer,
    rejected: statusCounts.rejected,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications.filter((app) => {
      if (filter === "active") {
        if (app.status !== "applied" && app.status !== "interview") return false;
      } else if (filter !== "all" && app.status !== filter) {
        return false;
      }
      if (!q) return true;
      return (
        app.company.toLowerCase().includes(q) ||
        app.role.toLowerCase().includes(q) ||
        (app.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [applications, filter, query]);

  const hasFilters = filter !== "all" || query.trim() !== "";

  function toggleFilter(next: Filter) {
    setFilter((current) => (current === next ? "all" : next));
  }

  function toggleNotes(id: string) {
    setExpandedNotes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="nexus-shell">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#08090a]/80">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-16 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm dark:bg-[#5e6ad2]">
                <BriefcaseBusiness className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold tracking-[-0.02em] text-slate-950 dark:text-[#f7f8f8] sm:text-base">
                  {t.title(ownerName)}
                </h1>
                <p className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 sm:block">
                  {t.eyebrow}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="nexus-chip gap-1.5 !py-1.5 text-emerald-700 dark:text-emerald-300"
                title={t.readOnly}
              >
                <Lock className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t.readOnly}</span>
              </span>
              <a
                href={`/share?code=${encodeURIComponent(code)}&lang=${otherLang}`}
                className="nexus-button-ghost min-h-9 px-3 py-1.5"
                title={t.langToggleTitle}
              >
                {t.langToggle}
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="nexus-panel p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <StatTile
              label={t.stats.total}
              value={stats.total}
              active={filter === "all" && !query}
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
            />
            <StatTile
              label={t.stats.active}
              value={stats.active}
              active={filter === "active"}
              onClick={() => toggleFilter("active")}
            />
            <StatTile
              label={t.stats.offers}
              value={stats.offers}
              active={filter === "offer"}
              onClick={() => toggleFilter("offer")}
            />
            <StatTile
              label={t.stats.rejected}
              value={stats.rejected}
              active={filter === "rejected"}
              onClick={() => toggleFilter("rejected")}
            />
          </div>

          {stats.total > 0 && (
            <div className="mt-4">
              <div
                className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
                role="img"
                aria-label={`${t.pipeline}: ${STATUS_ORDER.map(
                  (s) => `${t.status[s]} ${statusCounts[s]}`
                ).join(", ")}`}
              >
                {STATUS_ORDER.filter((s) => statusCounts[s] > 0).map((s) => (
                  <div
                    key={s}
                    className={`${BAR_COLORS[s]} rounded-full`}
                    style={{ width: `${(statusCounts[s] / stats.total) * 100}%` }}
                  />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-1 gap-y-1.5">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleFilter(s)}
                    aria-pressed={filter === s}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      filter === s
                        ? "border-indigo-500 bg-indigo-50 text-slate-950 dark:border-[#7170ff] dark:bg-[#5e6ad2]/15 dark:text-white"
                        : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${BAR_COLORS[s]}`}
                      aria-hidden
                    />
                    {t.status[s]}
                    <span className="tabular-nums text-slate-400 dark:text-slate-500">
                      {statusCounts[s]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="nexus-panel mt-4 overflow-hidden sm:mt-6">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 dark:border-white/[0.06] sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <h2 className="text-base font-semibold text-slate-950 dark:text-white sm:text-lg">
              {t.table.heading}
              <span className="ml-2 text-sm font-normal nexus-muted">
                {hasFilters ? `${filtered.length} / ${applications.length}` : applications.length}
              </span>
            </h2>
            <div className="relative sm:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="nexus-input !pl-9"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
              <Inbox className="h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="text-sm nexus-muted">
                {applications.length === 0 ? t.empty : t.noMatches}
              </p>
              {applications.length > 0 && hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                  className="nexus-button-ghost min-h-10"
                >
                  <X className="h-4 w-4" aria-hidden />
                  {t.clearFilters}
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <ul className="space-y-3 p-3 md:hidden">
                {filtered.map((app) => {
                  const expanded = expandedNotes.has(app.id);
                  return (
                    <li
                      key={app.id}
                      className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.035]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-slate-950 dark:text-white">
                            {app.company}
                          </h3>
                          <p className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-300">
                            {app.role}
                          </p>
                        </div>
                        <StatusBadge status={app.status} labels={t.status} />
                      </div>

                      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {t.table.applied}
                          </dt>
                          <dd className="mt-0.5 text-slate-700 dark:text-slate-300">
                            {formatDate(app.appliedAt, dateLocale)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {t.table.lastContact}
                          </dt>
                          <dd className="mt-0.5 text-slate-700 dark:text-slate-300">
                            {formatDate(app.lastContact, dateLocale)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {t.table.followUp}
                          </dt>
                          <dd className="mt-0.5">
                            <FollowUpValue
                              value={app.followUpAt}
                              locale={dateLocale}
                              overdueLabel={t.overdue}
                              dueTodayLabel={t.dueToday}
                            />
                          </dd>
                        </div>
                      </dl>

                      {app.notes && (
                        <button
                          type="button"
                          onClick={() => toggleNotes(app.id)}
                          aria-expanded={expanded}
                          className="mt-3 w-full rounded-xl bg-slate-50 px-3 py-2 text-left text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300"
                        >
                          <span className={expanded ? "" : "line-clamp-2"}>{app.notes}</span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Desktop: table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 dark:border-white/[0.06] dark:bg-white/[0.02]">
                      {[
                        t.table.company,
                        t.table.role,
                        t.table.status,
                        t.table.applied,
                        t.table.lastContact,
                        t.table.followUp,
                        t.table.notes,
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 first:pl-5 last:pr-5"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((app) => (
                      <tr
                        key={app.id}
                        className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/60 dark:border-white/[0.04] dark:hover:bg-white/[0.03]"
                      >
                        <td className="px-4 py-3 font-medium text-slate-950 dark:text-white first:pl-5">
                          {app.company}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{app.role}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={app.status} labels={t.status} />
                        </td>
                        <td className="px-4 py-3 text-sm nexus-muted">
                          {formatDate(app.appliedAt, dateLocale)}
                        </td>
                        <td className="px-4 py-3 text-sm nexus-muted">
                          {formatDate(app.lastContact, dateLocale)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <FollowUpValue
                            value={app.followUpAt}
                            locale={dateLocale}
                            overdueLabel={t.overdue}
                            dueTodayLabel={t.dueToday}
                          />
                        </td>
                        <td className="px-4 py-3 last:pr-5">
                          <span
                            className="block max-w-xs truncate text-sm nexus-muted"
                            title={app.notes || ""}
                          >
                            {app.notes || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="border-t border-slate-100 px-4 py-3 text-xs nexus-muted dark:border-white/[0.06] sm:px-5">
            {t.footer(applications.length, generatedAt)}
          </div>
        </section>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400 dark:text-slate-500">
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          {t.readOnlyNote}
        </p>
      </main>
    </div>
  );
}
