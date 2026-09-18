"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Hourglass } from "lucide-react";
import type { Application } from "@/types";
import { useNow } from "@/hooks/use-now";

interface NowBannerProps {
  application: Application;
  statusLabel: string;
}

function formatDay(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * The one thing that answers "where does this stand?" without scrolling:
 * current stage, whether a follow-up is due, and when contact last happened.
 */
export function NowBanner({ application, statusLabel }: NowBannerProps) {
  const td = useTranslations("detail");
  const locale = useLocale();
  const now = useNow();

  const followUp = formatDay(application.followUpAt, locale);
  const lastContact = formatDay(application.lastContact, locale);
  const applied = formatDay(application.appliedAt, locale);
  const overdue =
    now != null &&
    application.followUpAt != null &&
    new Date(application.followUpAt).getTime() < now;

  const meta = [
    followUp ? td("follow_up_on", { date: followUp }) : null,
    lastContact ? td("last_contact_on", { date: lastContact }) : null,
    applied ? td("applied_on", { date: applied }) : null,
  ].filter((entry): entry is string => Boolean(entry));

  const Icon = overdue ? AlertTriangle : Hourglass;

  return (
    <section
      aria-label={td("current_state")}
      className={`mt-6 flex items-start gap-3 rounded-r-lg border-l-[3px] bg-slate-100/70 px-4 py-3.5 dark:bg-white/[0.04] ${
        overdue
          ? "border-amber-500 dark:border-amber-400"
          : "border-indigo-600 dark:border-[#7170ff]"
      }`}
    >
      <Icon
        aria-hidden="true"
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          overdue ? "text-amber-600 dark:text-amber-400" : "text-indigo-600 dark:text-[#a5a1ff]"
        }`}
      />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-slate-950 dark:text-[#f7f8f8]">
          {application.currentStage || statusLabel}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {overdue
            ? td("follow_up_overdue")
            : followUp
              ? td("follow_up_pending")
              : td("no_follow_up")}
        </p>
        {meta.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            {meta.map((entry) => (
              <span key={entry}>{entry}</span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
