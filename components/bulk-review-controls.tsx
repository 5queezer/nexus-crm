"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BulkActionType, BulkMatchFilters, BulkScope } from "@/lib/agent/bulk/types";
import { toLocalCalendarInputValue } from "@/lib/applications/local-calendar";

export async function requestBulkReview(actionType: BulkActionType, scope: BulkScope, followUpAt?: string) {
  const response = await fetch("/api/agent/bulk/previews", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionType, scope, ...(actionType === "reschedule_follow_up" ? { changes: { followUpAt: followUpAt && /^\d{4}-\d{2}-\d{2}$/.test(followUpAt) ? `${followUpAt}T00:00:00.000Z` : followUpAt } } : {}), reason: "Prepared from the opportunities workspace", idempotencyKey: crypto.randomUUID() }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not prepare changes. Please retry.");
  const commandId = result.command?.id;
  if (!commandId) throw new Error("The server did not return a review.");
  window.dispatchEvent(new CustomEvent("nexus:bulk-review", { detail: { commandId } }));
}

export function BulkReviewControls({ selectedIds, visibleIds, filters, hiddenCount, onClear }: {
  selectedIds: string[]; visibleIds: string[]; filters: BulkMatchFilters; hiddenCount: number; onClear: () => void;
}) {
  const t = useTranslations("bulk_review");
  const [scope, setScope] = useState("all_matching");
  const [action, setAction] = useState<BulkActionType>("reschedule_follow_up");
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [date, setDate] = useState(() => {
    const monday = new Date(); monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    return toLocalCalendarInputValue(monday);
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function prepare() {
    setPending(true); setError(null);
    try {
      const now = new Date();
      // Calendar-only reminders use UTC midnight as a civil-date encoding.
      const midnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const target: BulkScope = scope === "all_matching" ? { mode: "all_matching", filters: { ...filters, ...(action === "reschedule_follow_up" && overdueOnly ? { followUpBefore: midnight.toISOString() } : {}) } } : { mode: "selected", applicationIds: scope === "selected" ? selectedIds : visibleIds };
      await requestBulkReview(action, target, date);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare changes"); }
    finally { setPending(false); }
  }
  return <section aria-label={t("title")} className="mb-6 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/3">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span aria-live="polite" className="mr-auto">{t("selected_count", { count: selectedIds.length })}{hiddenCount > 0 ? ` · ${t("hidden_count", { count: hiddenCount })}` : ""}</span>
      {selectedIds.length > 0 && <button type="button" className="nexus-focus-ring min-h-11 px-2" onClick={onClear}>{t("clear")}</button>}
      <select aria-label={t("scope")} value={scope} onChange={event => setScope(event.target.value)} className="min-h-11 max-w-full rounded-md border border-slate-200 bg-white px-2 dark:border-white/10 dark:bg-[#1d1e22]">
        <option value="selected">{t("selected_count", { count: selectedIds.length })}</option><option value="visible">{t("visible_count", { count: visibleIds.length })}</option><option value="all_matching">{t("all_matching")}</option>
      </select>
      <select aria-label={t("operation")} value={action} onChange={event => setAction(event.target.value as BulkActionType)} className="min-h-11 max-w-full rounded-md border border-slate-200 bg-white px-2 dark:border-white/10 dark:bg-[#1d1e22]">
        <option value="reschedule_follow_up">{t("reschedule")}</option><option value="archive">{t("archive")}</option><option value="restore">{t("restore")}</option>
      </select>
      {action === "reschedule_follow_up" && <input type="date" aria-label={t("date")} value={date} onChange={event => setDate(event.target.value)} className="min-h-11 min-w-0 max-w-full rounded-md border border-slate-200 bg-white px-2 dark:border-white/10 dark:bg-[#1d1e22]" />}
      <button type="button" onClick={() => void prepare()} disabled={pending || (scope === "selected" && !selectedIds.length) || (action === "reschedule_follow_up" && !date)} className="nexus-focus-ring min-h-11 rounded-md border border-slate-200 bg-white px-3 font-medium disabled:opacity-50 dark:border-white/10 dark:bg-[#1d1e22]">{pending ? t("preparing") : t("review")}</button>
    </div>
    {action === "reschedule_follow_up" && scope === "all_matching" && <label className="mt-2 flex min-h-9 items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={overdueOnly} onChange={event => setOverdueOnly(event.target.checked)} />{t("overdue_only")} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</label>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
  </section>;
}
