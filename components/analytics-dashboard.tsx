"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AnalyticsSnapshot } from "@/lib/analytics/metrics";
import { SOURCE_PRESETS } from "@/types";
import { AppHeader } from "./app-header";

interface AnalyticsDashboardProps {
  user: {
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin?: boolean;
  };
}

interface AnalyticsResponse extends AnalyticsSnapshot {
  filters: {
    start: string;
    end: string;
    cutoff: string;
    source: string | null;
    includeArchived: boolean;
  };
}

const SOURCE_OPTIONS = [...SOURCE_PRESETS, "himalayas", "web-search", "unknown"];

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultInterval() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  return { start: dateInputValue(start), end: dateInputValue(end) };
}

async function fetchAnalytics(params: {
  start: string;
  end: string;
  source: string;
  includeArchived: boolean;
}): Promise<AnalyticsResponse> {
  const search = new URLSearchParams({
    start: params.start,
    end: params.end,
    includeArchived: String(params.includeArchived),
  });
  if (params.source) search.set("source", params.source);
  const response = await fetch(`/api/analytics?${search}`);
  if (!response.ok) throw new Error("analytics_query_failed");
  return response.json();
}

function formatPercent(value: number | null, noData: string): string {
  return value === null ? noData : `${value}%`;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
}

function MetricCard({
  label,
  value,
  note,
  onClick,
  viewRecords,
}: {
  label: string;
  value: string;
  note: string;
  onClick: () => void;
  viewRecords: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-36 rounded-2xl border border-gray-200 bg-white p-5 text-left transition hover:border-violet-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-violet-600"
      aria-label={`${label}: ${value}. ${note}. ${viewRecords}.`}
    >
      <span className="block text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <span className="mt-3 block text-3xl font-semibold tracking-tight text-gray-950 dark:text-white">{value}</span>
      <span className="mt-2 block text-sm text-gray-500 dark:text-gray-400">{note}</span>
    </button>
  );
}

function EvidenceBar({
  label,
  count,
  denominator,
  percentage,
  onClick,
  noData,
  ofLabel,
  viewRecords,
}: {
  label: string;
  count: number;
  denominator: number;
  percentage: number | null;
  onClick: () => void;
  noData: string;
  ofLabel: string;
  viewRecords: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg p-2 text-left hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:hover:bg-gray-700/50"
      aria-label={`${label}: ${count} ${ofLabel} ${denominator}. ${viewRecords}.`}
    >
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-gray-800 dark:text-gray-200">{label}</span>
        <span className="text-gray-600 dark:text-gray-300">
          {count} <span className="text-xs text-gray-400">{ofLabel} {denominator} · {formatPercent(percentage, noData)}</span>
        </span>
      </span>
      <span className="mt-2 block h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" aria-hidden="true">
        <span
          className="block h-full rounded-full bg-violet-500"
          style={{ width: `${percentage ?? 0}%` }}
        />
      </span>
    </button>
  );
}

export function AnalyticsDashboard({ user }: AnalyticsDashboardProps) {
  const t = useTranslations("analytics");
  const locale = useLocale();
  const noData = t("redesign.no_data");
  const sourceLabel = (value: string) => t(`source_labels.${value}`);
  const initial = useMemo(() => defaultInterval(), []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [source, setSource] = useState("");
  const [includeArchived, setIncludeArchived] = useState(true);
  const [showDefinitions, setShowDefinitions] = useState(false);
  const [sourceSort, setSourceSort] = useState<"volume" | "rate">("volume");
  const [detail, setDetail] = useState<{ title: string; recordIds: string[] } | null>(null);

  const query = useQuery({
    queryKey: ["analytics", start, end, source, includeArchived],
    queryFn: () => fetchAnalytics({ start, end, source, includeArchived }),
  });
  const data = query.data;
  const sortedSources = useMemo(() => {
    const rows = [...(data?.sources ?? [])];
    return rows.sort((a, b) => sourceSort === "rate"
      ? (b.progressionPercentage ?? -1) - (a.progressionPercentage ?? -1) || b.contacted - a.contacted
      : b.contacted - a.contacted || a.source.localeCompare(b.source));
  }, [data?.sources, sourceSort]);
  const detailRecords = detail && data
    ? data.records.filter((record) => detail.recordIds.includes(record.id))
    : [];
  const openDetail = (title: string, recordIds: string[]) => setDetail({ title, recordIds });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader user={user} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{t("title")}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("redesign.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowDefinitions((open) => !open)}
            aria-expanded={showDefinitions}
            aria-controls="analytics-definitions"
            className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            {t("redesign.how_we_measure")}
          </button>
        </header>

        <section aria-label={t("redesign.filters_label")} className="mt-7 grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-700 dark:bg-gray-800">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("redesign.added_from")}
            <input
              type="date"
              value={start}
              max={end}
              onChange={(event) => { setStart(event.target.value); setDetail(null); }}
              className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-900"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("redesign.added_through")}
            <input
              type="date"
              value={end}
              min={start}
              onChange={(event) => { setEnd(event.target.value); setDetail(null); }}
              className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-900"
            />
          </label>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("redesign.source")}
            <select
              value={source}
              onChange={(event) => { setSource(event.target.value); setDetail(null); }}
              className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 dark:border-gray-600 dark:bg-gray-900"
            >
              <option value="">{t("redesign.all_sources")}</option>
              {SOURCE_OPTIONS.map((option) => <option key={option} value={option}>{sourceLabel(option)}</option>)}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-3 self-end rounded-lg px-1 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => { setIncludeArchived(event.target.checked); setDetail(null); }}
              className="h-5 w-5 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
            {t("redesign.include_archived")}
          </label>
        </section>

        {showDefinitions && (
          <section id="analytics-definitions" className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-5 text-sm text-gray-700 dark:border-violet-900 dark:bg-violet-950/20 dark:text-gray-300">
            <h2 className="font-semibold text-gray-950 dark:text-white">{t("redesign.definitions_title")}</h2>
            <dl className="mt-3 grid gap-4 md:grid-cols-2">
              <div><dt className="font-medium">{t("redesign.cohort_definition_title")}</dt><dd className="mt-1 text-gray-600 dark:text-gray-400">{t("redesign.cohort_definition")}</dd></div>
              <div><dt className="font-medium">{t("redesign.reply_rate")}</dt><dd className="mt-1 text-gray-600 dark:text-gray-400">{t("redesign.reply_definition")}</dd></div>
              <div><dt className="font-medium">{t("redesign.progression")}</dt><dd className="mt-1 text-gray-600 dark:text-gray-400">{t("redesign.progression_definition")}</dd></div>
              <div><dt className="font-medium">{t("redesign.reply_timing")}</dt><dd className="mt-1 text-gray-600 dark:text-gray-400">{t("redesign.reply_timing_definition")}</dd></div>
            </dl>
          </section>
        )}

        {query.isLoading && (
          <div className="py-24 text-center text-sm text-gray-500" role="status">{t("redesign.loading")}</div>
        )}
        {query.isError && (
          <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/20" role="alert">
            <p className="text-sm text-red-700 dark:text-red-300">{t("redesign.error")}</p>
            <button type="button" onClick={() => query.refetch()} className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium">{t("redesign.retry")}</button>
          </div>
        )}

        {data && (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <span className="font-medium text-gray-800 dark:text-gray-100">
                {t("redesign.cohort_summary", data.cohort)}
              </span>
              <span>
                {t("redesign.cohort_interval", {
                  start: formatDate(`${data.filters.start}T00:00:00Z`, locale),
                  end: formatDate(`${data.filters.end}T00:00:00Z`, locale),
                  cutoff: formatDate(data.filters.cutoff, locale),
                  source: data.filters.source ? sourceLabel(data.filters.source) : t("redesign.all_sources_lower"),
                })}
              </span>
            </div>

            <section aria-label={t("redesign.headline_label")} className="mt-5 grid gap-4 md:grid-cols-3">
              <MetricCard
                label={t("redesign.reply_rate")}
                value={formatPercent(data.replyRate.percentage, noData)}
                note={t("redesign.contacted_note", {
                  numerator: data.replyRate.numerator,
                  denominator: data.replyRate.denominator,
                })}
                onClick={() => openDetail(t("redesign.confirmed_human_replies"), data.replyRate.recordIds)}
                viewRecords={t("redesign.view_records")}
              />
              <MetricCard
                label={t("redesign.reached_negotiation")}
                value={formatPercent(data.progressionRate.percentage, noData)}
                note={t("redesign.contacted_note", {
                  numerator: data.progressionRate.numerator,
                  denominator: data.progressionRate.denominator,
                })}
                onClick={() => openDetail(t("redesign.reached_negotiation"), data.progressionRate.recordIds)}
                viewRecords={t("redesign.view_records")}
              />
              <MetricCard
                label={t("redesign.median_first_reply")}
                value={data.medianFirstReplyDays.value === null ? noData : t("redesign.days_value", { days: data.medianFirstReplyDays.value })}
                note={t("redesign.dated_reply_sample", { count: data.medianFirstReplyDays.sampleCount })}
                onClick={() => openDetail(t("redesign.dated_reply_records"), data.medianFirstReplyDays.recordIds)}
                viewRecords={t("redesign.view_records")}
              />
            </section>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-baseline justify-between"><h2 className="font-semibold text-gray-950 dark:text-white">{t("redesign.stage_progression")}</h2><span className="text-xs uppercase tracking-wide text-gray-400">{t("redesign.ever_reached")}</span></div>
                <p className="mt-1 text-sm text-gray-500">{t("redesign.stage_caption")}</p>
                <div className="mt-4 space-y-1">
                  {data.stages.map((stage) => (
                    <EvidenceBar
                      key={stage.key}
                      label={t(`redesign.stage_labels.${stage.key}`)}
                      count={stage.count}
                      denominator={stage.denominator}
                      percentage={stage.percentage}
                      onClick={() => openDetail(t(`redesign.stage_labels.${stage.key}`), stage.recordIds)}
                      noData={noData}
                      ofLabel={t("redesign.of")}
                      viewRecords={t("redesign.view_records")}
                    />
                  ))}
                </div>
                <p className="mt-3 text-xs text-gray-500">{t("redesign.stage_history_gaps", { count: data.coverage.stageHistoryGaps })}</p>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-baseline justify-between"><h2 className="font-semibold text-gray-950 dark:text-white">{t("redesign.time_to_first_reply")}</h2><span className="text-xs uppercase tracking-wide text-gray-400">{t("redesign.calendar_days")}</span></div>
                <p className="mt-1 text-sm text-gray-500">{t("redesign.time_caption")}</p>
                <div className="mt-4 space-y-1">
                  {data.replyTimeDistribution.map((bucket) => (
                    <EvidenceBar
                      key={bucket.key}
                      label={t(`redesign.reply_buckets.${bucket.key}`)}
                      count={bucket.count}
                      denominator={bucket.denominator}
                      percentage={bucket.percentage}
                      onClick={() => openDetail(t("redesign.replied_in", { range: t(`redesign.reply_buckets.${bucket.key}`) }), bucket.recordIds)}
                      noData={noData}
                      ofLabel={t("redesign.of")}
                      viewRecords={t("redesign.view_records")}
                    />
                  ))}
                </div>
                <p className="mt-3 text-xs text-gray-500">{t("redesign.duration_coverage", {
                  dated: data.coverage.datedReplies,
                  undated: data.coverage.undatedReplies,
                  pending: data.coverage.pendingReplies,
                  invalid: data.coverage.invalidDatePairs,
                })}</p>
              </section>
            </div>

            <section className="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-col gap-3 border-b border-gray-200 p-5 sm:flex-row sm:items-end sm:justify-between dark:border-gray-700">
                <div><h2 className="font-semibold text-gray-950 dark:text-white">{t("redesign.source_title")}</h2><p className="mt-1 text-sm text-gray-500">{t("redesign.source_caption")}</p></div>
                <label className="text-sm text-gray-600 dark:text-gray-300">{t("redesign.sort_by")} <select value={sourceSort} onChange={(event) => setSourceSort(event.target.value as "volume" | "rate")} className="ml-2 min-h-10 rounded-lg border border-gray-300 bg-white px-2 dark:border-gray-600 dark:bg-gray-900"><option value="volume">{t("redesign.contacted")}</option><option value="rate">{t("redesign.progression_rate")}</option></select></label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/40"><tr><th className="px-5 py-3">{t("redesign.source")}</th><th className="px-4 py-3">{t("redesign.contacted")}</th><th className="px-4 py-3">{t("redesign.replied")}</th><th className="px-4 py-3">{t("redesign.negotiation")}</th><th className="px-5 py-3">{t("redesign.progression")}</th></tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {sortedSources.map((row) => (
                      <tr key={row.source}>
                        <td className="px-5 py-3"><button type="button" className="font-medium text-violet-700 hover:underline dark:text-violet-300" onClick={() => openDetail(t("redesign.source_opportunities", { source: sourceLabel(row.source) }), row.recordIds.all)}>{t("redesign.source_cohort_count", { source: sourceLabel(row.source), count: row.cohort })}</button></td>
                        <td className="px-4 py-3"><button type="button" className="hover:underline" onClick={() => openDetail(t("redesign.source_metric", { source: sourceLabel(row.source), metric: t("redesign.contacted") }), row.recordIds.contacted)}>{row.contacted}</button></td>
                        <td className="px-4 py-3"><button type="button" className="hover:underline" onClick={() => openDetail(t("redesign.source_metric", { source: sourceLabel(row.source), metric: t("redesign.confirmed_human_replies") }), row.recordIds.replied)}>{row.replied}</button></td>
                        <td className="px-4 py-3"><button type="button" className="hover:underline" onClick={() => openDetail(t("redesign.source_metric", { source: sourceLabel(row.source), metric: t("redesign.negotiation") }), row.recordIds.negotiation)}>{row.negotiation}</button></td>
                        <td className="px-5 py-3 font-medium">{formatPercent(row.progressionPercentage, noData)}</td>
                      </tr>
                    ))}
                    {sortedSources.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">{t("redesign.no_cohort")}</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {detail && (
              <section className="mt-5 rounded-2xl border border-violet-200 bg-white p-5 dark:border-violet-900 dark:bg-gray-800" aria-label={t("redesign.records_behind_metric")}>
                <div className="flex items-start justify-between gap-4">
                  <div><h2 className="font-semibold text-gray-950 dark:text-white">{detail.title}</h2><p className="mt-1 text-sm text-gray-500">{t("redesign.record_count", { count: detailRecords.length })}</p></div>
                  <button type="button" onClick={() => setDetail(null)} className="min-h-10 rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:hover:bg-gray-700" aria-label={t("redesign.close_metric_details")}>{t("redesign.close")}</button>
                </div>
                {detailRecords.length === 0 ? <p className="mt-5 text-sm text-gray-500">{t("redesign.no_matching")}</p> : (
                  <div className="mt-4 divide-y divide-gray-100 dark:divide-gray-700">
                    {detailRecords.map((record) => (
                      <div key={record.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                        <div><a href={`/applications/${record.id}`} className="font-medium text-violet-700 hover:underline dark:text-violet-300" aria-label={`${record.company} — ${record.role}`}>{record.company}</a><p className="text-sm text-gray-500">{record.role} · {sourceLabel(record.source)}</p></div>
                        <div className="text-xs text-gray-500"><p>{t("redesign.contact")}: {record.firstContactAt ? formatDate(record.firstContactAt, locale) : t("redesign.not_recorded")}</p><p>{t("redesign.reply")}: {record.firstHumanReplyAt ? `${formatDate(record.firstHumanReplyAt, locale)} · ${record.replyDurationDays}d` : record.confirmedHumanReply ? t("redesign.date_missing") : t("redesign.none_recorded")}</p></div>
                        <span className="w-fit rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">{record.archived ? t("redesign.archived") : t("redesign.active")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <footer className="mt-5 flex flex-wrap justify-between gap-2 text-xs text-gray-500">
              <span>{t("redesign.snapshot_cutoff", { cutoff: new Date(data.filters.cutoff).toLocaleString(locale) })}</span>
              <button type="button" onClick={() => openDetail(t("redesign.included_opportunities"), data.records.map((record) => record.id))} className="font-medium text-violet-700 hover:underline dark:text-violet-300">{t("redesign.explore_included")}</button>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
