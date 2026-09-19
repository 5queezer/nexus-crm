"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pause, Play, RotateCcw, ShieldCheck, Square } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { BulkCommandSnapshot } from "@/lib/agent/bulk/types";
import {
	formatLocalCalendarDate,
	toLocalCalendarInputValue,
} from "@/lib/applications/local-calendar";
import { apiJson } from "./types";
import { BulkConflicts } from "./bulk-conflicts";

export function BulkReview({
	commandId,
	onCommandChange,
}: {
	commandId: string;
	onCommandChange?: (commandId: string) => void;
}) {
	const queryClient = useQueryClient();
	const t = useTranslations("bulk_review");
	const locale = useLocale();
	const [command, setCommand] = useState<BulkCommandSnapshot | null>(null);
	const [excluded, setExcluded] = useState<Set<string>>(new Set());
	const [dateEdits, setDateEdits] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		try {
			const result = await apiJson<{ command: BulkCommandSnapshot }>(
				`/api/agent/bulk/${encodeURIComponent(commandId)}`,
			);
			setCommand(result.command);
			setError("");
		} catch {
			setError(t("errors.load"));
		}
	}, [commandId, t]);

	useEffect(() => {
		setCommand(null);
		setExcluded(new Set());
		setDateEdits({});
		void load();
	}, [load]);

	useEffect(() => {
		if (!command || !["queued", "running", "pause_requested", "cancel_requested", "undo_queued", "undo_running"].includes(command.status)) return;
		const timer = window.setInterval(() => void load(), 1_500);
		return () => window.clearInterval(timer);
	}, [command, load]);

	const revisionDirty = excluded.size > 0 || Object.keys(dateEdits).length > 0;
	const targetLabel = t("exact_targets", { count: command?.targetCount ?? 0 });
	const appliedCount = command?.counts.applied ?? 0;
	const undoActive = command?.status.startsWith("undo_") ?? false;
	const issueCount = command
		? command.counts.failed + command.counts.stale + command.counts.outcome_unknown
		: 0;

	async function invalidateBulkConsumers() {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["bulk-tasks"] }),
			queryClient.invalidateQueries({ queryKey: ["applications"] }),
			queryClient.invalidateQueries({ queryKey: ["activity"] }),
			queryClient.invalidateQueries({ queryKey: ["application-events"] }),
			queryClient.invalidateQueries({ queryKey: ["documents"] }),
			queryClient.invalidateQueries({ queryKey: ["analytics"] }),
		]);
	}

	async function action(
		name: "approve" | "execute" | "pause" | "resume" | "cancel" | "undo",
		includeDigest = false,
	) {
		if (!command) return;
		setBusy(true);
		setError("");
		try {
			const result = await apiJson<{ command: BulkCommandSnapshot }>(
				`/api/agent/bulk/${encodeURIComponent(command.id)}/${name}`,
				{
					method: "POST",
					headers: includeDigest ? { "Content-Type": "application/json" } : undefined,
					body: includeDigest ? JSON.stringify({ digest: command.digest }) : undefined,
				},
			);
			setCommand(result.command);
			await invalidateBulkConsumers();
		} catch {
			setError(t("errors.action"));
		} finally {
			setBusy(false);
		}
	}

	async function revise() {
		if (!command || !revisionDirty) return;
		setBusy(true);
		setError("");
		try {
			const itemChanges = Object.entries(dateEdits).map(
				([applicationId, followUpAt]) => ({
					applicationId,
					followUpAt: `${followUpAt}T00:00:00.000Z`,
				}),
			);
			const result = await apiJson<{ command: BulkCommandSnapshot }>(
				`/api/agent/bulk/previews/${encodeURIComponent(command.id)}/revisions`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						digest: command.digest,
						...(excluded.size
							? { excludedApplicationIds: [...excluded] }
							: {}),
						...(itemChanges.length ? { itemChanges } : {}),
					}),
				},
			);
			setCommand(result.command);
			setExcluded(new Set());
			setDateEdits({});
			onCommandChange?.(result.command.id);
			await invalidateBulkConsumers();
		} catch {
			setError(t("errors.revise"));
		} finally {
			setBusy(false);
		}
	}

	function formatFields(value: { followUpAt?: string | null; archivedAt?: string | null }) {
		if ("followUpAt" in value)
			return value.followUpAt
				? formatLocalCalendarDate(value.followUpAt, locale) ?? t("invalid_date")
				: t("no_follow_up");
		if ("archivedAt" in value) return value.archivedAt ? t("archived") : t("active");
		return "—";
	}

	function formatItemOutcome(status: BulkCommandSnapshot["items"][number]["status"], undoStatus: BulkCommandSnapshot["items"][number]["undoStatus"]) {
		if (!undoActive) return t(`item_states.${status}`);
		return t(`undo_states.${undoStatus ?? "pending"}`);
	}

	if (!command && !error) {
		return (
			<div className="ml-10 flex items-center gap-2 rounded-2xl border border-slate-200 p-4 text-xs text-slate-500 dark:border-white/10">
				<Loader2 className="h-4 w-4 animate-spin" /> {t("loading_review")}
			</div>
		);
	}

	return (
		<section data-bulk-review className="overflow-hidden rounded-2xl border border-indigo-200 bg-indigo-50/40 dark:border-indigo-500/20 dark:bg-indigo-500/[0.05]" aria-label={t("change_review")}>
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 px-4 py-3 dark:border-indigo-500/15">
				<div>
					<div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
						<ShieldCheck className="h-4 w-4 text-indigo-600" /> {t("change_review")}
					</div>
					<p className="mt-1 text-xs text-slate-500"><span>{targetLabel}</span> · {command ? t(`actions.${command.actionType}`) : ""}</p>
				</div>
				<span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-slate-300">{command ? t(`states.${command.status}`) : ""}</span>
			</header>

			{error && <div role="alert" className="m-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
			{command && (
				<>
					<div className="max-h-72 overflow-auto">
						<table className="hidden w-full text-left text-xs sm:table">
							<thead className="sticky top-0 bg-indigo-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-[#171727]">
								<tr><th className="px-3 py-2">{t("include")}</th><th className="px-3 py-2">{t("opportunity")}</th><th className="px-3 py-2">{t("before")}</th><th className="px-3 py-2">{t("after")}</th><th className="px-3 py-2">{t("outcome")}</th></tr>
							</thead>
							<tbody className="divide-y divide-indigo-100 dark:divide-white/5">
								{command.items.map((item) => (
									<tr key={item.id}>
										<td className="px-3 py-2 align-top">
											<input
												type="checkbox"
												aria-label={t("include_item", { company: item.company, role: item.role })}
												checked={!excluded.has(item.applicationId)}
												disabled={command.status !== "preview"}
												onChange={(event) => setExcluded((current) => {
													const next = new Set(current);
													if (event.target.checked) next.delete(item.applicationId);
													else next.add(item.applicationId);
													return next;
												})}
											/>
										</td>
										<td className="px-3 py-2 align-top"><span className="font-medium text-slate-900 dark:text-white">{item.company}</span><br /><span className="text-slate-500">{item.role}</span></td>
										<td className="px-3 py-2 align-top text-slate-500">{formatFields(item.before)}</td>
										<td className="px-3 py-2 align-top text-slate-800 dark:text-slate-200">
											{command.actionType === "reschedule_follow_up" && command.status === "preview" ? (
												<input
												type="date"
													aria-label={t("follow_up_date", { company: item.company })}
													value={dateEdits[item.applicationId] ?? toLocalCalendarInputValue(item.after.followUpAt)}
													onChange={(event) => setDateEdits((current) => ({ ...current, [item.applicationId]: event.target.value }))}
													className="min-h-11 max-w-44 rounded border border-slate-200 bg-white px-2 py-1 dark:border-white/10 dark:bg-white/5"
												/>
											) : formatFields(item.after)}
										</td>
										<td className="px-3 py-2 align-top">{formatItemOutcome(item.status, item.undoStatus)}{item.errorMessage ? <span className="block text-red-600">{t("item_error")}</span> : null}</td>
									</tr>
								))}
							</tbody>
						</table>
						<div className="divide-y divide-indigo-100 sm:hidden dark:divide-white/5">
							{command.items.map((item) => (
								<div key={item.id} className="space-y-2 p-3 text-xs">
									<label className="flex min-h-11 items-start gap-2">
										<input type="checkbox" checked={!excluded.has(item.applicationId)} disabled={command.status !== "preview"} onChange={(event) => setExcluded((current) => {
											const next = new Set(current);
											if (event.target.checked) next.delete(item.applicationId); else next.add(item.applicationId);
											return next;
										})} />
										<span><strong>{item.company}</strong><br />{item.role}</span>
									</label>
									<div className="grid grid-cols-2 gap-2 text-slate-500"><span>{t("before")}<br />{formatFields(item.before)}</span><span>{t("after")}<br />{command.actionType === "reschedule_follow_up" && command.status === "preview" ? <input type="date" aria-label={t("follow_up_date", { company: item.company })} value={dateEdits[item.applicationId] ?? toLocalCalendarInputValue(item.after.followUpAt)} onChange={(event) => setDateEdits((current) => ({ ...current, [item.applicationId]: event.target.value }))} className="mt-1 min-h-11 w-full rounded border border-slate-200 bg-white px-2 py-1 dark:border-white/10 dark:bg-white/5" /> : formatFields(item.after)}</span></div>
									<div className="text-slate-500">{t("outcome")}: {formatItemOutcome(item.status, item.undoStatus)}</div>
								</div>
							))}
						</div>
					</div>
					{command.exclusions.length > 0 && (
						<details className="border-t border-indigo-100 px-4 py-3 text-xs dark:border-indigo-500/15">
							<summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">
								{t("excluded_before_review", { count: command.exclusions.length })}
							</summary>
							<ul className="mt-2 space-y-2 text-slate-500">
								{command.exclusions.map((exclusion) => (
									<li key={`${exclusion.applicationId}-${exclusion.code}`}>
										<span className="font-medium text-slate-700 dark:text-slate-300">{exclusion.company} · {exclusion.role}</span>
										<span className="block">{exclusion.reason}</span>
									</li>
								))}
							</ul>
						</details>
					)}
					<BulkConflicts
						command={command}
						onReview={(commandId) => onCommandChange?.(commandId)}
					/>
					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-indigo-100 px-4 py-3 text-xs dark:border-indigo-500/15">
						<div className="text-slate-500">{undoActive ? t("progress_restored", { applied: command.counts.undoApplied, total: appliedCount }) : t("progress_applied", { applied: appliedCount, total: command.targetCount })}{issueCount ? ` · ${t("need_review", { count: issueCount })}` : ""}<details className="mt-1"><summary className="min-h-11 cursor-pointer content-center">{t("plan_identity")}</summary><code className="break-all text-[10px]">{command.digest}</code></details></div>
						<div className="flex flex-wrap gap-2">
							{command.status === "preview" && revisionDirty && <button disabled={busy} onClick={() => void revise()} className="min-h-11 rounded-lg border border-indigo-200 bg-white px-3 py-2 font-medium text-indigo-700 disabled:opacity-50 dark:bg-white/5 dark:text-indigo-300">{t("update_preview")}</button>}
							{command.status === "preview" && !revisionDirty && <button disabled={busy} onClick={() => void action("approve", true)} className="min-h-11 rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white disabled:opacity-50">{t("approve_exact")}</button>}
							{command.status === "approved" && <button disabled={busy} onClick={() => void action("execute", true)} className="flex min-h-11 items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white"><Play className="h-3 w-3" /> {t("execute_approved")}</button>}
							{["queued", "running"].includes(command.status) && <button disabled={busy} onClick={() => void action("pause")} className="flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2"><Pause className="h-3 w-3" /> {t("pause")}</button>}
							{command.status === "paused" && <button disabled={busy} onClick={() => void action("resume")} className="flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2"><Play className="h-3 w-3" /> {t("resume")}</button>}
							{["queued", "running", "pause_requested", "paused"].includes(command.status) && <button disabled={busy} onClick={() => void action("cancel")} className="flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2"><Square className="h-3 w-3" /> {t("cancel_remaining")}</button>}
							{command.reversible && ["completed", "completed_with_errors", "cancelled"].includes(command.status) && appliedCount > 0 && <button disabled={busy} onClick={() => void action("undo", true)} className="flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2"><RotateCcw className="h-3 w-3" /> {t("undo_applied")}</button>}
						</div>
					</div>
				</>
			)}
		</section>
	);
}
