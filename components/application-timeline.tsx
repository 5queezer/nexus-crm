"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  APPLICATION_EVENT_TYPES,
  type ApplicationEventType,
} from "@/lib/applications/events";
import { formatEventDateTime } from "@/lib/applications/event-format";

interface TimelineEvent {
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
}

interface TimelinePage {
  items: TimelineEvent[];
  nextCursor: string | null;
}

interface ApplicationTimelineProps {
  applicationId: string;
  expectedUpdatedAt: string | null;
  disabled?: boolean;
  /** Record form visibility, owned by the page so the hero button can open it. */
  recordOpen: boolean;
  onRecordOpenChange: (open: boolean) => void;
  /** Reveal a contact referenced by an event; the page owns where it lives. */
  onContactSelect?: (contactId: string) => void;
  onProjectionUpdated?: (updatedAt: string) => void;
}

const RECORDABLE_TYPES = APPLICATION_EVENT_TYPES.filter((type) =>
  !["application_submitted", "opportunity_discovered", "document_attached"].includes(type),
);

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

const VISIBLE_METADATA_KEYS = [
  "fromStage",
  "toStage",
  "fromStatus",
  "toStatus",
  "channel",
  "interviewType",
  "scheduledAt",
  "followUpAt",
  "nextAction",
  "outcome",
  "reason",
  "note",
  "durationMinutes",
  "answerCount",
  "documentType",
  "responseKind",
] as const;

function metadataSummary(
  metadata: Record<string, unknown> | null,
  labelFor: (key: string) => string,
  locale: string,
  /** Keys the event body already shows, so details do not repeat them. */
  promoted: readonly string[] = [],
): string[] {
  if (!metadata) return [];
  return VISIBLE_METADATA_KEYS.flatMap((key) => {
    if (promoted.includes(key)) return [];
    const value = metadata[key];
    if (value === undefined || value === null || value === "" || typeof value === "object") return [];
    const label = labelFor(key);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return [`${label}: ${formatEventDateTime(value, locale)}`];
    }
    return [`${label}: ${String(value)}`];
  });
}

async function loadTimeline(applicationId: string, order: "newest" | "oldest", cursor: string): Promise<TimelinePage> {
  const params = new URLSearchParams({ applicationId, limit: "50", order });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/events?${params.toString()}`);
  if (!response.ok) throw new Error("timeline_load_failed");
  return response.json() as Promise<TimelinePage>;
}

export function ApplicationTimeline({
  applicationId,
  expectedUpdatedAt,
  disabled = false,
  recordOpen,
  onRecordOpenChange,
  onContactSelect,
  onProjectionUpdated,
}: ApplicationTimelineProps) {
  const t = useTranslations("timeline");
  const te = useTranslations("events.eventTypes");
  const tm = useTranslations("events.metadata");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ApplicationEventType>("stage_changed");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue());
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const queryKey = useMemo(() => ["application-events", applicationId, order], [applicationId, order]);
  const timeline = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam }) => loadTimeline(applicationId, order, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const metadata: Record<string, unknown> = {};
      const add = (key: string) => {
        const value = fields[key]?.trim();
        if (value) metadata[key] = key.endsWith("At") ? new Date(value).toISOString() : value;
      };
      switch (type) {
        case "outbound_contact_recorded":
          add("channel");
          add("contactId");
          add("outcome");
          break;
        case "reply_received":
          add("responseKind");
          metadata.replyDateKnown = fields.replyDateKnown !== "false";
          add("channel");
          add("contactId");
          add("outcome");
          break;
        case "stage_changed":
          add("toStage");
          add("toStatus");
          break;
        case "interview_invited":
        case "interview_scheduled":
          add("interviewType");
          add("scheduledAt");
          add("followUpAt");
          add("nextAction");
          break;
        case "interview_completed":
        case "feedback_received":
          add("interviewType");
          add("outcome");
          add("nextAction");
          add("followUpAt");
          break;
        case "follow_up_scheduled":
          add("followUpAt");
          add("nextAction");
          break;
        case "application_rejected":
          add("outcome");
          add("reason");
          break;
        case "offer_received":
        case "recruiter_contacted":
          add("outcome");
          add("nextAction");
          add("followUpAt");
          break;
        case "note_added":
          add("note");
          break;
        default:
          break;
      }
      const response = await fetch(`/api/applications/${applicationId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          occurredAt: new Date(occurredAt).toISOString(),
          expectedUpdatedAt,
          idempotencyKey: `ui-${crypto.randomUUID()}`,
          metadata,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "event_failed");
      return result as { application: { updatedAt: string } };
    },
    onSuccess: async (result) => {
      setError(null);
      onRecordOpenChange(false);
      setFields({});
      setOccurredAt(localDateTimeValue());
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: ["applications"] });
      onProjectionUpdated?.(result.application.updatedAt);
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "event_failed"),
  });

  const field = (
    name: string,
    label: string,
    options?: { type?: string; required?: boolean; placeholder?: string },
  ) => (
    <label className="block space-y-1" key={name}>
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <input
        name={name}
        type={options?.type ?? "text"}
        required={options?.required}
        placeholder={options?.placeholder}
        value={fields[name] ?? ""}
        onChange={(event) => setFields((current) => ({ ...current, [name]: event.target.value }))}
        className="nexus-input w-full"
      />
    </label>
  );

  const eventFields = () => {
    switch (type) {
      case "outbound_contact_recorded":
        return <>{field("channel", t("channel"))}{field("contactId", tm("contactId"))}{field("outcome", t("outcome"))}</>;
      case "reply_received":
        return <>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t("response_kind")}</span>
            <select
              required
              value={fields.responseKind ?? ""}
              onChange={(event) => setFields((current) => ({ ...current, responseKind: event.target.value }))}
              className="nexus-input w-full"
            >
              <option value="" disabled>{t("response_kind")}</option>
              <option value="human">{t("response_human")}</option>
              <option value="automatic">{t("response_automatic")}</option>
            </select>
          </label>
          <label className="nexus-target flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={fields.replyDateKnown !== "false"}
              onChange={(event) => setFields((current) => ({
                ...current,
                replyDateKnown: event.target.checked ? "true" : "false",
              }))}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-white/20 dark:bg-white/10"
            />
            {t("reply_date_known")}
          </label>
          {field("channel", t("channel"))}
          {field("contactId", tm("contactId"))}
          {field("outcome", t("outcome"))}
        </>;
      case "stage_changed":
        return <>{field("toStage", t("new_stage"), { required: true, placeholder: "technical_interview" })}{field("toStatus", t("status_optional"), { placeholder: "interview" })}</>;
      case "interview_invited":
        return <>{field("interviewType", t("interview_type"))}{field("scheduledAt", t("scheduled_for"), { type: "datetime-local" })}{field("followUpAt", t("follow_up"), { type: "datetime-local" })}{field("nextAction", t("next_action"))}</>;
      case "interview_scheduled":
        return <>{field("interviewType", t("interview_type"), { required: true })}{field("scheduledAt", t("scheduled_for"), { type: "datetime-local", required: true })}{field("nextAction", t("preparation"))}</>;
      case "interview_completed":
      case "feedback_received":
        return <>{type === "interview_completed" && field("interviewType", t("interview_type"))}{field("outcome", t("outcome"))}{field("nextAction", t("next_action"))}{field("followUpAt", t("follow_up"), { type: "datetime-local" })}</>;
      case "follow_up_scheduled":
        return <>{field("followUpAt", t("follow_up"), { type: "datetime-local", required: true })}{field("nextAction", t("next_action"))}</>;
      case "application_rejected":
        return <>{field("outcome", t("outcome"), { placeholder: "declined" })}{field("reason", t("reason"))}</>;
      case "offer_received":
      case "recruiter_contacted":
        return <>{field("outcome", t("outcome"))}{field("nextAction", t("next_action"))}{field("followUpAt", t("follow_up"), { type: "datetime-local" })}</>;
      case "note_added":
        return field("note", t("timeline_note"), { required: true });
      default:
        return null;
    }
  };

  const events = timeline.data?.pages.flatMap((page) => Array.isArray(page.items) ? page.items : []) ?? [];

  return (
    <section aria-label={t("title")} className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-slate-950 dark:text-[#f7f8f8]">
          {t("title")}
        </h2>
        <select
          aria-label={t("order")}
          value={order}
          onChange={(event) => setOrder(event.target.value as "newest" | "oldest")}
          className="nexus-focus-ring min-h-8 rounded-md border-0 bg-transparent py-0 pl-0 pr-6 text-xs text-slate-500 dark:text-slate-400"
        >
          <option value="newest">{t("newest")}</option>
          <option value="oldest">{t("oldest")}</option>
        </select>
      </div>

      {recordOpen && (
        <form
          className="mb-6 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/8 dark:bg-white/[0.03]"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            mutation.mutate();
          }}
        >
          <h3 className="mb-3 text-sm font-semibold text-slate-950 dark:text-[#f7f8f8]">
            {t("record_activity")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t("activity")}</span>
              <select
                autoFocus
                value={type}
                onChange={(event) => { setType(event.target.value as ApplicationEventType); setFields({}); }}
                className="nexus-input w-full"
              >
                {RECORDABLE_TYPES.map((eventType) => <option key={eventType} value={eventType}>{te(eventType)}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t("occurred_at")}</span>
              <input type="datetime-local" required value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className="nexus-input w-full" />
            </label>
            {eventFields()}
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onRecordOpenChange(false)}
              className="nexus-button-ghost min-h-10 py-2 text-sm"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={disabled || mutation.isPending || !occurredAt}
              className="nexus-button-primary min-h-10 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? t("recording") : t("record_event")}
            </button>
          </div>
        </form>
      )}

      {timeline.isLoading && <p role="status" aria-live="polite" className="text-sm text-slate-500">{t("loading")}</p>}
      {timeline.isError && <p role="alert" className="text-sm text-red-600">{t("load_error")}</p>}
      {!timeline.isLoading && !timeline.isError && events.length === 0 && <p className="text-sm text-slate-500">{t("empty")}</p>}

      <ol className="m-0 list-none p-0">
        {events.map((event, index) => {
          const outcome = typeof event.metadata?.outcome === "string" ? event.metadata.outcome : null;
          const details = metadataSummary(
            event.metadata,
            (key) => tm(key),
            locale,
            outcome ? ["outcome"] : [],
          );
          const title = APPLICATION_EVENT_TYPES.includes(event.type as ApplicationEventType)
            ? te(event.type as ApplicationEventType)
            : t("unknown_event", { type: event.type });
          const documentId = typeof event.metadata?.documentId === "string" ? event.metadata.documentId : null;
          const submissionId = typeof event.metadata?.submissionId === "string" ? event.metadata.submissionId : null;
          const taskId = typeof event.metadata?.taskId === "string" ? event.metadata.taskId : null;
          const first = index === 0;
          return (
            <li key={event.id} className="relative pb-6 pl-7 last:pb-0">
              {index < events.length - 1 && (
                <span aria-hidden="true" className="absolute bottom-0 left-[7px] top-5 w-px bg-slate-200 dark:bg-white/10" />
              )}
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1 flex h-[15px] w-[15px] items-center justify-center rounded-full ${
                  first
                    ? "bg-indigo-100 dark:bg-[#5e6ad2]/30"
                    : "border border-slate-200 bg-white dark:border-white/10 dark:bg-[#111214]"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${first ? "bg-indigo-600 dark:bg-[#a5a1ff]" : "bg-slate-400 dark:bg-slate-500"}`} />
              </span>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
              <time className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400" dateTime={event.occurredAt}>
                {formatEventDateTime(event.occurredAt, locale)}
              </time>
              {(event.source || event.actor) && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {[event.source, event.actor].filter(Boolean).join(" · ")}
                </p>
              )}
              {outcome && (
                <p className="mt-2 text-xs text-slate-800 dark:text-slate-200">{outcome}</p>
              )}
              {(details.length > 0 || event.createdAt) && (
                <details className="mt-2">
                  <summary className="nexus-focus-ring cursor-pointer rounded text-[11px] text-slate-500 dark:text-slate-400">
                    {t("event_details")}
                  </summary>
                  <div className="pt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {details.map((detail) => (
                      <div key={detail} className="py-0.5">{detail}</div>
                    ))}
                    {event.createdAt && (
                      <div className="py-0.5">{t("recorded_at", { date: formatEventDateTime(event.createdAt, locale) })}</div>
                    )}
                  </div>
                </details>
              )}
              {(event.contactId || documentId || submissionId || taskId) && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {event.contactId && (
                    // The contact lives in another tab, so a bare fragment
                    // link would point at a target that is not rendered.
                    <button
                      type="button"
                      onClick={() => onContactSelect?.(event.contactId!)}
                      className="nexus-focus-ring rounded text-[#5e6ad2] hover:underline dark:text-[#a5a1ff]"
                    >
                      {t("contact_link", { id: event.contactId })}
                    </button>
                  )}
                  {documentId && <Link className="text-[#5e6ad2] hover:underline dark:text-[#a5a1ff]" href={`/documents#document-${encodeURIComponent(documentId)}`}>{t("document_link", { id: documentId })}</Link>}
                  {submissionId && <span className="text-slate-500 dark:text-slate-400">{t("submission_link", { id: submissionId })}</span>}
                  {taskId && <Link className="text-[#5e6ad2] hover:underline dark:text-[#a5a1ff]" href={`/tasks/${encodeURIComponent(taskId)}`}>{t("task_link")}</Link>}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {!recordOpen && (
        <button
          type="button"
          disabled={disabled}
          title={disabled ? t("save_first") : undefined}
          onClick={() => onRecordOpenChange(true)}
          className="nexus-focus-ring mt-2 flex w-full items-center gap-2 rounded-lg border border-slate-200/80 bg-white/60 px-3 py-3 text-left text-xs text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/8 dark:bg-white/[0.02] dark:text-slate-400 dark:hover:bg-white/5"
        >
          {t("add_note")}
        </button>
      )}

      {timeline.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <button type="button" className="nexus-button-ghost" disabled={timeline.isFetchingNextPage} onClick={() => timeline.fetchNextPage()}>
            {timeline.isFetchingNextPage ? t("loading_more") : t("load_more")}
          </button>
        </div>
      )}
    </section>
  );
}
