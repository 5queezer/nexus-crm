"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  APPLICATION_EVENT_TYPES,
  type ApplicationEventType,
} from "@/lib/applications/events";

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
  "interviewType",
  "scheduledAt",
  "followUpAt",
  "nextAction",
  "outcome",
  "reason",
  "note",
  "durationMinutes",
  "location",
  "meetingUrl",
  "offerType",
  "compensationSummary",
  "atsName",
  "requisitionId",
  "filename",
  "documentCount",
] as const;

function metadataSummary(
  metadata: Record<string, unknown> | null,
  labelFor: (key: string) => string,
): string[] {
  if (!metadata) return [];
  return VISIBLE_METADATA_KEYS.flatMap((key) => {
    const value = metadata[key];
    if (value === undefined || value === null || value === "" || typeof value === "object") return [];
    const label = labelFor(key);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return [`${label}: ${new Date(value).toLocaleString()}`];
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
  onProjectionUpdated,
}: ApplicationTimelineProps) {
  const t = useTranslations("timeline");
  const te = useTranslations("events.eventTypes");
  const tm = useTranslations("events.metadata");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
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
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/8 dark:bg-[#111214]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("title")}</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label={t("order")}
            value={order}
            onChange={(event) => setOrder(event.target.value as "newest" | "oldest")}
            className="nexus-input"
          >
            <option value="newest">{t("newest")}</option>
            <option value="oldest">{t("oldest")}</option>
          </select>
          <button
            type="button"
            disabled={disabled}
            title={disabled ? t("save_first") : undefined}
            onClick={() => setOpen((value) => !value)}
            className="nexus-button-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {open ? t("cancel") : t("record_activity")}
          </button>
        </div>
      </div>

      {open && (
        <form
          className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.03]"
          onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t("activity")}</span>
              <select
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
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={mutation.isPending || !occurredAt}
              className="nexus-button-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? t("recording") : t("record_event")}
            </button>
          </div>
        </form>
      )}

      <div className="mt-5">
        {timeline.isLoading && <p role="status" aria-live="polite" className="text-sm text-slate-500">{t("loading")}</p>}
        {timeline.isError && <p role="alert" className="text-sm text-red-600">{t("load_error")}</p>}
        {!timeline.isLoading && !timeline.isError && events.length === 0 && <p className="text-sm text-slate-500">{t("empty")}</p>}
        <ol className="space-y-0">
          {events.map((event, index) => {
            const details = metadataSummary(event.metadata, (key) => tm(key));
            const title = APPLICATION_EVENT_TYPES.includes(event.type as ApplicationEventType)
              ? te(event.type as ApplicationEventType)
              : t("unknown_event", { type: event.type });
            const documentId = typeof event.metadata?.documentId === "string" ? event.metadata.documentId : null;
            const submissionId = typeof event.metadata?.submissionId === "string" ? event.metadata.submissionId : null;
            return (
              <li key={event.id} className="relative pl-7 pb-5 last:pb-0">
                {index < events.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-slate-200 dark:bg-white/10" />}
                <span className="absolute left-0 top-2 h-2.5 w-2.5 rounded-full bg-cyan-500 ring-4 ring-cyan-50 dark:ring-cyan-950" />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
                  <div className="text-right text-xs text-slate-500">
                    <time className="block" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
                    {event.createdAt && <time className="block text-[10px]" dateTime={event.createdAt}>{t("recorded_at", { date: new Date(event.createdAt).toLocaleString() })}</time>}
                  </div>
                </div>
                {(event.source || event.actor) && <p className="mt-0.5 text-xs text-slate-500">{[event.source, event.actor].filter(Boolean).join(" · ")}</p>}
                {details.length > 0 && <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">{details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
                {(event.contactId || documentId || submissionId) && (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {event.contactId && <Link className="text-[#5e6ad2] hover:underline" href={`#contact-${encodeURIComponent(event.contactId)}`}>{t("contact_link", { id: event.contactId })}</Link>}
                    {documentId && <Link className="text-[#5e6ad2] hover:underline" href={`/documents#document-${encodeURIComponent(documentId)}`}>{t("document_link", { id: documentId })}</Link>}
                    {submissionId && <span className="text-slate-500 dark:text-slate-400">{t("submission_link", { id: submissionId })}</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {timeline.hasNextPage && (
          <div className="mt-3 flex justify-center">
            <button type="button" className="nexus-button-ghost" disabled={timeline.isFetchingNextPage} onClick={() => timeline.fetchNextPage()}>
              {timeline.isFetchingNextPage ? t("loading_more") : t("load_more")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
