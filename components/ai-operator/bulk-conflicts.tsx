"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { BulkCommandSnapshot } from "@/lib/agent/bulk/types";
import { formatLocalCalendarDate } from "@/lib/applications/local-calendar";
import { apiJson } from "./types";

export function BulkConflicts({ command, onReview }: { command: BulkCommandSnapshot; onReview: (id: string) => void }) {
  const t = useTranslations("bulk_review");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<Record<string, { followUpAt: string | null; archivedAt: string | null }>>({});
  const stale = command.items.filter(item => item.status === "stale");
  if (!stale.length || !["completed_with_errors", "completed", "cancelled"].includes(command.status)) return null;
  async function inspect(id: string) {
    setError(""); setBusy(true);
    try { const value = await apiJson<{ followUpAt: string | null; archivedAt: string | null }>(`/api/applications/${encodeURIComponent(id)}`); setCurrent(previous => ({ ...previous, [id]: value })); }
    catch { setError(t("conflict_error")); } finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError("");
    try {
      const result = await apiJson<{ command: BulkCommandSnapshot }>(`/api/agent/bulk/previews/${encodeURIComponent(command.id)}/revisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest: command.digest, excludedApplicationIds: command.items.filter(item => item.status !== "stale").map(item => item.applicationId), idempotencyKey: crypto.randomUUID() }),
      });
      onReview(result.command.id);
    } catch { setError(t("conflict_error")); } finally { setBusy(false); }
  }
  return <section aria-label={t("conflicts")} className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-500/20 dark:bg-amber-500/5">
    <h3 className="font-semibold">{t("conflicts")}</h3><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{t("conflict_preserved")}</p>
    {stale.map(item => <div key={item.id} className="mt-3 flex flex-wrap items-center gap-3 border-t border-amber-200/70 pt-3 dark:border-amber-500/20">
      <Link href={`/applications/${encodeURIComponent(item.applicationId)}`} className="min-h-11 content-center font-medium underline">{item.company} · {item.role}</Link>
      <button disabled={busy} onClick={() => void inspect(item.applicationId)} className="min-h-11 rounded border border-amber-300 px-3">{t("inspect_current")}</button>
      {current[item.applicationId] && <span>{t("current_value")}: {command.actionType === "reschedule_follow_up" ? formatLocalCalendarDate(current[item.applicationId].followUpAt, locale) ?? t("no_reminder") : current[item.applicationId].archivedAt ? t("archived") : t("active")}</span>}
    </div>)}
    <button disabled={busy} onClick={() => void refresh()} className="nexus-button-ghost mt-3">{t("refresh_conflicts")}</button>
    {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-300">{error}</p>}
  </section>;
}
