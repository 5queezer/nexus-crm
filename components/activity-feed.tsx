"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AppHeader } from "./app-header";
import { APPLICATION_EVENT_TYPES, type ApplicationEventType } from "@/lib/applications/events";
import { formatEventDateTime } from "@/lib/applications/event-format";

interface ActivityEvent {
  id: string;
  applicationId: string;
  type: string;
  occurredAt: string;
  createdAt: string;
  source: string | null;
  actor: string | null;
  contactId: string | null;
  outcome: string | null;
  metadata: Record<string, unknown> | null;
  application?: { id: string; company: string; role: string };
}

interface ActivityPage {
  items: ActivityEvent[];
  nextCursor: string | null;
}

interface ActivityFeedProps {
  user: { name?: string | null; email: string; image?: string | null; isAdmin?: boolean };
}

const EMPTY_FILTERS = {
  company: "",
  applicationId: "",
  type: "",
  order: "newest",
  occurredAfter: "",
  occurredBefore: "",
  source: "",
  actor: "",
  contactId: "",
  outcome: "",
};

type Filters = typeof EMPTY_FILTERS;

async function fetchActivity(filters: Filters, cursor: string): Promise<ActivityPage> {
  const params = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    const normalized = key === "occurredAfter" || key === "occurredBefore"
      ? new Date(value).toISOString()
      : value;
    params.set(key, normalized);
  }
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/events?${params.toString()}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "activity_load_failed");
  return body as ActivityPage;
}

function EventDetails({ event }: { event: ActivityEvent }) {
  const tm = useTranslations("events.metadata");
  const locale = useLocale();
  const metadata = event.metadata ?? {};
  const details = [
    typeof metadata.fromStage === "string" && typeof metadata.toStage === "string"
      ? `${tm("fromStage")}: ${metadata.fromStage || "—"} → ${tm("toStage")}: ${metadata.toStage}`
      : null,
    typeof metadata.scheduledAt === "string"
      ? `${tm("scheduledAt")}: ${formatEventDateTime(metadata.scheduledAt, locale)}`
      : null,
    typeof metadata.nextAction === "string" ? `${tm("nextAction")}: ${metadata.nextAction}` : null,
    typeof metadata.reason === "string" ? `${tm("reason")}: ${metadata.reason}` : null,
    event.outcome ? `${tm("outcome")}: ${event.outcome}` : null,
  ].filter(Boolean) as string[];
  if (!details.length) return null;
  return <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">{details.map((detail) => <li key={detail}>{detail}</li>)}</ul>;
}

export function ActivityFeed({ user }: ActivityFeedProps) {
  const t = useTranslations("activityFeed");
  const te = useTranslations("events.eventTypes");
  const locale = useLocale();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const activity = useInfiniteQuery({
    queryKey: ["application-activity", filters],
    initialPageParam: "",
    queryFn: ({ pageParam }) => fetchActivity(filters, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const events = activity.data?.pages.flatMap((page) => page.items) ?? [];
  const update = (name: keyof Filters, value: string) => setDraft((current) => ({ ...current, [name]: value }));

  return (
    <div className="nexus-shell">
      <AppHeader user={user} />
      <main className="nexus-page-bottom-space mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{t("title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("description")}</p>
        </div>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/8 dark:bg-[#111214]">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input aria-label={t("company")} className="nexus-input" placeholder={t("company")} value={draft.company} onChange={(event) => update("company", event.target.value)} />
            <input aria-label={t("application_id")} className="nexus-input" placeholder={t("application_id")} value={draft.applicationId} onChange={(event) => update("applicationId", event.target.value)} />
            <select aria-label={t("event_type")} className="nexus-input" value={draft.type} onChange={(event) => update("type", event.target.value)}>
              <option value="">{t("all_types")}</option>
              {APPLICATION_EVENT_TYPES.map((type) => <option key={type} value={type}>{te(type)}</option>)}
            </select>
            <select aria-label={t("order")} className="nexus-input" value={draft.order} onChange={(event) => update("order", event.target.value)}>
              <option value="newest">{t("newest")}</option>
              <option value="oldest">{t("oldest")}</option>
            </select>
            <input aria-label={t("source")} className="nexus-input" placeholder={t("source")} value={draft.source} onChange={(event) => update("source", event.target.value)} />
            <input aria-label={t("actor")} className="nexus-input" placeholder={t("actor")} value={draft.actor} onChange={(event) => update("actor", event.target.value)} />
            <input aria-label={t("contact_id")} className="nexus-input" placeholder={t("contact_id")} value={draft.contactId} onChange={(event) => update("contactId", event.target.value)} />
            <input aria-label={t("outcome")} className="nexus-input" placeholder={t("outcome")} value={draft.outcome} onChange={(event) => update("outcome", event.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-medium text-slate-500">{t("from")}<input aria-label={t("from")} type="datetime-local" className="nexus-input mt-1 w-full" value={draft.occurredAfter} onChange={(event) => update("occurredAfter", event.target.value)} /></label>
              <label className="text-[11px] font-medium text-slate-500">{t("to")}<input aria-label={t("to")} type="datetime-local" className="nexus-input mt-1 w-full" value={draft.occurredBefore} onChange={(event) => update("occurredBefore", event.target.value)} /></label>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="nexus-button-ghost" onClick={() => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); }}>{t("clear")}</button>
            <button type="button" className="nexus-button-primary" onClick={() => setFilters({ ...draft })}>{t("apply")}</button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/8 dark:bg-[#111214]">
          {activity.isLoading && <p role="status" aria-live="polite" className="text-sm text-slate-500">{t("loading")}</p>}
          {activity.isError && <p role="alert" className="text-sm text-red-600">{t("load_error")}</p>}
          {!activity.isLoading && !activity.isError && events.length === 0 && <p className="text-sm text-slate-500">{t("empty")}</p>}
          <ol>
            {events.map((event, index) => (
              <li key={event.id} className="relative border-b border-slate-100 py-4 pl-6 last:border-0 dark:border-white/6">
                <span className="absolute left-0 top-6 h-2.5 w-2.5 rounded-full bg-[#5e6ad2]" />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{APPLICATION_EVENT_TYPES.includes(event.type as ApplicationEventType) ? te(event.type as ApplicationEventType) : event.type}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {event.application ? <Link className="font-medium text-[#5e6ad2] hover:underline" href={`/applications/${event.application.id}`}>{event.application.company} — {event.application.role}</Link> : t("application_link", { id: event.applicationId })}
                      {(event.source || event.actor) && <> · {[event.source, event.actor].filter(Boolean).join(" · ")}</>}
                    </p>
                  </div>
                  <time dateTime={event.occurredAt} className="text-xs text-slate-500">{formatEventDateTime(event.occurredAt, locale)}</time>
                </div>
                <EventDetails event={event} />
                {index === events.length - 1 && activity.hasNextPage && <span className="sr-only">{t("more_available")}</span>}
              </li>
            ))}
          </ol>
          {activity.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <button type="button" className="nexus-button-ghost" disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>
                {activity.isFetchingNextPage ? t("loading_more") : t("load_more")}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
