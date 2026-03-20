"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Application, ApplicationStatus, STATUS_COLORS, STATUS_ORDER, normalizeSource } from "@/types";
import { AppHeader } from "./app-header";

async function fetchApplications(): Promise<Application[]> {
  const res = await fetch("/api/applications");
  if (!res.ok) throw new Error("Failed to fetch applications");
  return res.json();
}

// Bar color classes for chart bars (bg only, for the filled portion)
const STATUS_BAR_COLORS: Record<ApplicationStatus, string> = {
  inbound: "bg-teal-500 dark:bg-teal-400",
  applied: "bg-blue-500 dark:bg-blue-400",
  interview: "bg-purple-500 dark:bg-purple-400",
  offer: "bg-green-500 dark:bg-emerald-400",
  rejected: "bg-red-500 dark:bg-red-400",
};

function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const dayStr = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${dayStr}`;
}

function formatWeekLabel(weekKey: string): string {
  const [, m, d] = weekKey.split("-");
  return `${d}.${m}`;
}

interface AnalyticsDashboardProps {
  user: {
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin?: boolean;
  };
}

export function AnalyticsDashboard({ user }: AnalyticsDashboardProps) {
  const t = useTranslations("analytics");
  const ts = useTranslations("status");
  const router = useRouter();

  const { data: applications = [], isLoading, isError } = useQuery({
    queryKey: ["applications"],
    queryFn: fetchApplications,
  });

  const activeApps = useMemo(() => applications.filter((a) => !a.archivedAt), [applications]);

  // === Status Breakdown ===
  const { statusCounts, maxStatusCount } = useMemo(() => {
    const counts: Record<ApplicationStatus, number> = {
      inbound: 0, applied: 0, interview: 0, offer: 0, rejected: 0,
    };
    for (const app of activeApps) {
      counts[app.status] = (counts[app.status] || 0) + 1;
    }
    return { statusCounts: counts, maxStatusCount: Math.max(...Object.values(counts), 1) };
  }, [activeApps]);

  // === Applications Over Time (weekly buckets, stacked: inbound vs applied) ===
  const { finalWeeks, weeklyBuckets, maxWeeklyCount } = useMemo(() => {
    const buckets: Record<string, { inbound: number; applied: number }> = {};
    for (const app of activeApps) {
      const date = app.appliedAt ? new Date(app.appliedAt) : new Date(app.createdAt);
      const week = getWeekKey(date);
      if (!buckets[week]) buckets[week] = { inbound: 0, applied: 0 };
      if (app.status === "inbound") {
        buckets[week].inbound += 1;
      } else {
        buckets[week].applied += 1;
      }
    }
    const sorted = Object.keys(buckets).sort();
    // Fill in gaps between first and last week
    if (sorted.length > 1) {
      const current = new Date(sorted[0]);
      const end = new Date(sorted[sorted.length - 1]);
      while (current <= end) {
        const key = getWeekKey(current);
        if (!buckets[key]) buckets[key] = { inbound: 0, applied: 0 };
        current.setDate(current.getDate() + 7);
      }
    }
    const weeks = Object.keys(buckets).sort();
    const maxCount = Math.max(
      ...weeks.map((w) => buckets[w].inbound + buckets[w].applied),
      1
    );
    return { finalWeeks: weeks, weeklyBuckets: buckets, maxWeeklyCount: maxCount };
  }, [activeApps]);

  // === Response Rate ===
  const { totalApplied, responded, interviewCount, offerCount, responseRate } = useMemo(() => {
    const total = activeApps.filter((a) =>
      (["applied", "interview", "offer", "rejected"] as ApplicationStatus[]).includes(a.status)
    ).length;
    const interviews = activeApps.filter((a) => a.status === "interview").length;
    const offers = activeApps.filter((a) => a.status === "offer").length;
    const resp = activeApps.filter((a) =>
      (["interview", "offer", "rejected"] as ApplicationStatus[]).includes(a.status)
    ).length;
    return {
      totalApplied: total,
      responded: resp,
      interviewCount: interviews,
      offerCount: offers,
      responseRate: total > 0 ? Math.round((resp / total) * 100) : 0,
    };
  }, [activeApps]);

  // === Average Response Time ===
  const avgResponseTime = useMemo(() => {
    const times: number[] = [];
    for (const app of activeApps) {
      if (
        app.appliedAt &&
        app.lastContact &&
        (["interview", "offer", "rejected"] as ApplicationStatus[]).includes(app.status)
      ) {
        const applied = new Date(app.appliedAt).getTime();
        const contact = new Date(app.lastContact).getTime();
        const diffDays = Math.round((contact - applied) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0) times.push(diffDays);
      }
    }
    return times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : null;
  }, [activeApps]);

  // === Top Companies ===
  const { topCompanies, maxCompanyCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const app of activeApps) {
      const name = app.company.trim();
      if (name) counts[name] = (counts[name] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { topCompanies: top, maxCompanyCount: top.length > 0 ? top[0][1] : 1 };
  }, [activeApps]);

  // === Source Breakdown (normalized) ===
  const { topSources, maxSourceCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const app of activeApps) {
      const source = normalizeSource(app.source) || "Unknown";
      counts[source] = (counts[source] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { topSources: top, maxSourceCount: top.length > 0 ? top[0][1] : 1 };
  }, [activeApps]);

  const hasData = activeApps.length > 0;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-20 text-red-500">Failed to load data.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader user={user} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {!hasData ? (
          <div className="text-center py-20 text-gray-500 dark:text-gray-400">
            {t("no_data")}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Breakdown */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t("status_breakdown")}
              </h2>
              <div className="space-y-3">
                {STATUS_ORDER.map((status) => (
                  <div
                    key={status}
                    className="flex items-center gap-3 cursor-pointer rounded-lg px-1 -mx-1 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    onClick={() => router.push(`/?status=${status}`)}
                  >
                    <span
                      className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium w-24 text-center ${STATUS_COLORS[status]}`}
                    >
                      {ts(status)}
                    </span>
                    <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${STATUS_BAR_COLORS[status]}`}
                        style={{
                          width: `${(statusCounts[status] / maxStatusCount) * 100}%`,
                          minWidth: statusCounts[status] > 0 ? "1rem" : "0",
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-8 text-right">
                      {statusCounts[status]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Applications Over Time (stacked: blue = applied, teal = inbound) */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t("over_time")}
                </h2>
                <div className="flex gap-3 text-[10px] text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500 dark:bg-blue-400" />
                    {ts("applied")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-teal-500 dark:bg-teal-400" />
                    {ts("inbound")}
                  </span>
                </div>
              </div>
              {finalWeeks.length === 0 ? (
                <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
                  {t("no_data")}
                </div>
              ) : (
                <div className="flex items-end gap-1 h-48 overflow-x-auto pb-2">
                  {finalWeeks.map((week) => {
                    const bucket = weeklyBuckets[week] || { inbound: 0, applied: 0 };
                    const total = bucket.inbound + bucket.applied;
                    const appliedPct = (bucket.applied / maxWeeklyCount) * 100;
                    const inboundPct = (bucket.inbound / maxWeeklyCount) * 100;
                    return (
                      <div
                        key={week}
                        className="flex flex-col items-center flex-1 min-w-[2rem]"
                        title={`${t("week")} ${formatWeekLabel(week)}: ${bucket.applied} ${ts("applied")}, ${bucket.inbound} ${ts("inbound")}`}
                      >
                        <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                          {total > 0 ? total : ""}
                        </span>
                        <div className="w-full flex flex-col items-stretch justify-end h-36">
                          {bucket.inbound > 0 && (
                            <div
                              className="w-full bg-teal-500 dark:bg-teal-400 rounded-t transition-all duration-500"
                              style={{
                                height: `${inboundPct}%`,
                                minHeight: "4px",
                              }}
                            />
                          )}
                          {bucket.applied > 0 && (
                            <div
                              className={`w-full bg-blue-500 dark:bg-blue-400 transition-all duration-500 ${bucket.inbound === 0 ? "rounded-t" : ""}`}
                              style={{
                                height: `${appliedPct}%`,
                                minHeight: "4px",
                              }}
                            />
                          )}
                        </div>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 whitespace-nowrap">
                          {formatWeekLabel(week)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Response Rate */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {t("response_rate")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {t("response_rate_desc")}
              </p>
              <div className="flex items-center gap-4">
                <div className="text-4xl font-bold text-gray-900 dark:text-white">
                  {responseRate}%
                </div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 dark:bg-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${responseRate}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {responded} / {totalApplied} {t("responded")}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                <span>🟣 {interviewCount} {ts("interview")}</span>
                <span>🟢 {offerCount} {ts("offer")}</span>
              </div>
            </div>

            {/* Average Response Time */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {t("avg_response_time")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {t("avg_response_desc")}
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-gray-900 dark:text-white">
                  {avgResponseTime !== null ? avgResponseTime : "—"}
                </span>
                {avgResponseTime !== null && (
                  <span className="text-lg text-gray-500 dark:text-gray-400">
                    {t("days")}
                  </span>
                )}
              </div>
              {avgResponseTime !== null && (
                <div className="mt-3 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 dark:bg-amber-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((avgResponseTime / 30) * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Top Companies */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t("top_companies")}
              </h2>
              {topCompanies.length === 0 ? (
                <div className="text-center py-4 text-gray-400 dark:text-gray-500 text-sm">
                  {t("no_data")}
                </div>
              ) : (
                <div className="space-y-2">
                  {topCompanies.map(([company, count]) => (
                    <div
                      key={company}
                      className="flex items-center gap-3 cursor-pointer rounded-lg px-1 -mx-1 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      onClick={() => router.push(`/?search=${encodeURIComponent(company)}`)}
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300 w-32 truncate" title={company}>
                        {company}
                      </span>
                      <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 dark:bg-indigo-400 rounded-full transition-all duration-500"
                          style={{
                            width: `${(count / maxCompanyCount) * 100}%`,
                            minWidth: "1rem",
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-6 text-right">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Source Breakdown */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {t("source_breakdown")}
              </h2>
              {topSources.length === 0 ? (
                <div className="text-center py-4 text-gray-400 dark:text-gray-500 text-sm">
                  {t("no_data")}
                </div>
              ) : (
                <div className="space-y-2">
                  {topSources.map(([source, count]) => (
                    <div
                      key={source}
                      className="flex items-center gap-3 cursor-pointer rounded-lg px-1 -mx-1 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      onClick={() => router.push(`/?source=${encodeURIComponent(source)}`)}
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300 w-32 truncate" title={source}>
                        {source}
                      </span>
                      <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-500 dark:bg-cyan-400 rounded-full transition-all duration-500"
                          style={{
                            width: `${(count / maxSourceCount) * 100}%`,
                            minWidth: "1rem",
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-6 text-right">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
