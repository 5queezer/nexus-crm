"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
type Task = { id: string; actionType: string; status: string; createdAt: string; total: number; applied: number; undone: number };
type Page = { tasks: Task[]; nextCursor: string | null };
export function BulkTaskHistory() {
  const t = useTranslations("bulk_review");
  const locale = useLocale();
  const query = useInfiniteQuery({ queryKey: ["bulk-tasks"], initialPageParam: "", queryFn: async ({ pageParam }): Promise<Page> => {
    const res = await fetch(`/api/agent/bulk${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`);
    if (!res.ok) throw new Error(t("history_error"));
    const body = await res.json();
    if (!Array.isArray(body.tasks)) throw new Error(t("history_error"));
    return body;
  }, getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: 10000 });
  const tasks = query.data?.pages.flatMap(page => page.tasks) ?? [];
  return <section aria-label={t("history")} className="mb-6 rounded-lg border border-slate-200 p-4 dark:border-white/10">
    <h2 className="mb-3 text-sm font-semibold">{t("history")}</h2>
    {query.isPending && <p role="status" className="text-sm text-slate-500">{t("loading")}</p>}
    {query.isError && <button onClick={() => void query.refetch()} className="min-h-11 text-sm text-red-700">{t("history_error")} · {t("retry")}</button>}
    {!query.isPending && !query.isError && !tasks.length && <p className="text-sm text-slate-500">{t("history_empty")}</p>}
    <ul className="divide-y divide-slate-100 dark:divide-white/5">{tasks.map(task => <li key={task.id} className="py-3">
      <Link href={`/tasks/${encodeURIComponent(task.id)}`} className="nexus-focus-ring flex min-h-11 flex-wrap items-center justify-between gap-2 text-sm">
        <span>{t(task.actionType === "reschedule_follow_up" ? "reschedule" : task.actionType === "restore" ? "restore" : "archive")}<time className="mt-1 block text-xs text-slate-500">{new Date(task.createdAt).toLocaleString(locale)}</time></span>
        <span className="text-xs text-slate-500">{t(`states.${task.status}`)} · {t("outcome_counts", { applied: task.applied, total: task.total, undone: task.undone })}</span>
      </Link>
    </li>)}</ul>
    {query.hasNextPage && <button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} className="nexus-button-ghost mt-2">{t("more")}</button>}
  </section>;
}
