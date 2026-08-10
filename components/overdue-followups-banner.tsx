"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { Application } from "@/types";

interface OverdueFollowUpsBannerProps {
  applications: Application[];
  onOpen: (application: Application) => void;
  onDismiss: (application: Application) => void;
  onDismissAll: (applications: Application[]) => void;
}

export function OverdueFollowUpsBanner({
  applications,
  onOpen,
  onDismiss,
  onDismissAll,
}: OverdueFollowUpsBannerProps) {
  const tf = useTranslations("focus");
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  if (applications.length === 0) return null;

  const summary =
    applications.length === 1
      ? tf("overdue_summary_one")
      : tf("overdue_summary", { count: applications.length });

  return (
    <div className="mb-6 rounded-2xl border border-red-200/80 bg-red-50/90 text-sm text-red-700 shadow-sm backdrop-blur dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
      <div className="flex items-center gap-3 p-3">
        <span className="text-base" aria-hidden="true">
          ⚠
        </span>
        <span className="font-medium">{summary}</span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="nexus-target ml-auto inline-flex shrink-0 items-center justify-center gap-1 rounded px-2 font-medium transition-colors hover:bg-red-100 dark:hover:bg-red-900/50"
        >
          {expanded ? tf("overdue_hide") : tf("overdue_show")}
          <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            onDismissAll(applications);
          }}
          className="nexus-target inline-flex shrink-0 items-center justify-center rounded text-red-500 transition-colors hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/50"
          aria-label={tf("dismiss_all_overdue")}
        >
          ✕
        </button>
      </div>

      {expanded && (
        <ul
          id={detailsId}
          className="flex flex-wrap gap-2 border-t border-red-200/70 px-3 py-3 dark:border-red-500/20"
        >
          {applications.map((application) => (
            <li
              key={application.id}
              className="inline-flex items-center gap-1 rounded-full bg-red-100/80 pl-3 dark:bg-red-900/30"
            >
              <button
                type="button"
                onClick={() => onOpen(application)}
                className="py-1.5 font-medium hover:underline"
              >
                {application.company}
              </button>
              <button
                type="button"
                onClick={() => onDismiss(application)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-500 transition-colors hover:bg-red-200/80 dark:text-red-400 dark:hover:bg-red-900/60"
                aria-label={tf("dismiss_overdue", {
                  company: application.company,
                })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
