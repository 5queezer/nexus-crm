"use client";

import { useTranslations } from "next-intl";
import { Building2, MapPin, Pencil, Plus } from "lucide-react";
import { STATUS_COLORS, type Application } from "@/types";
import { DemoBadge } from "../demo-badge";

interface DetailHeroProps {
  application: Application;
  company: string;
  role: string;
  status: Application["status"];
  editing: boolean;
  onToggleEdit: () => void;
  onRecordActivity: () => void;
  recordDisabled?: boolean;
}

/** `€ 55–75 / year` from the separate salary columns, or null when unknown. */
export function formatSalary(application: Application): string | null {
  if (application.salaryMin == null && application.salaryMax == null) return null;
  const range = [application.salaryMin, application.salaryMax]
    .filter((value): value is number => value != null)
    .join("–");
  return [application.salaryCurrency, range, application.salaryPeriod ? `/ ${application.salaryPeriod}` : null]
    .filter(Boolean)
    .join(" ");
}

export function formatLocations(application: Application): string | null {
  if (application.primaryLocations?.length) return application.primaryLocations.join(", ");
  if (application.eligibleCountries?.length) return application.eligibleCountries.join(", ");
  return null;
}

/**
 * Identity block of the opportunity: who, what, and the two actions that move
 * the record forward. Everything else is one level down, in the tabs.
 */
export function DetailHero({
  application,
  company,
  role,
  status,
  editing,
  onToggleEdit,
  onRecordActivity,
  recordDisabled = false,
}: DetailHeroProps) {
  const td = useTranslations("detail");
  const ts = useTranslations("status");
  const tt = useTranslations("timeline");

  const salary = formatSalary(application);
  const locations = formatLocations(application);
  const workMode =
    application.workMode || (application.remote ? td("remote") : null);
  const officeDays =
    application.officeDaysMin != null
      ? td("office_days_value", { count: application.officeDaysMin })
      : null;

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span className="truncate">{company}</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[status]}`}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {ts(status)}
          </span>
          {application.isDemo && <DemoBadge />}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-[-0.025em] text-slate-950 dark:text-[#f7f8f8] sm:text-[1.6rem]">
          {role}
        </h1>
        {(salary || locations || workMode || officeDays) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            {salary && (
              <span className="font-medium text-slate-800 dark:text-slate-200">{salary}</span>
            )}
            {locations && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {locations}
              </span>
            )}
            {(workMode || officeDays) && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                {[workMode, officeDays].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleEdit}
          aria-expanded={editing}
          aria-controls="application-brief-panel"
          className="nexus-button-ghost min-h-9 px-3 py-1.5 text-xs"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          {editing ? td("done_editing") : td("edit")}
        </button>
        <button
          type="button"
          onClick={onRecordActivity}
          disabled={recordDisabled}
          title={recordDisabled ? tt("save_first") : undefined}
          className="nexus-button-primary min-h-9 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {tt("record_activity")}
        </button>
      </div>
    </header>
  );
}
