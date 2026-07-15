"use client";

import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { Application, ApplicationStatus } from "@/types";
import { STATUS_COLORS, STATUS_ORDER, TRIAGE_COLORS } from "@/types";
import {
  buildFocusQueue,
  type FocusGroupId,
} from "@/lib/applications/focus-queue";
import type { ApplicationStatusMutation } from "@/hooks/use-application-status-mutation";
import { formatLocalCalendarDate } from "@/lib/applications/local-calendar";
import { ActionMenu } from "./action-menu";

interface FocusQueueProps {
  applications: Application[];
  isTrueEmpty: boolean;
  isFilteredEmpty: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpen: (application: Application) => void;
  onEdit: (application: Application) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string, archive: boolean) => void;
  onCreate: () => void;
  onClearFilters: () => void;
  statusMutation: ApplicationStatusMutation;
}

export function FocusQueue({
  applications,
  isTrueEmpty,
  isFilteredEmpty,
  selectedIds,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
  onArchive,
  onCreate,
  onClearFilters,
  statusMutation,
}: FocusQueueProps) {
  const t = useTranslations("focus");
  const groups = useMemo(() => buildFocusQueue(applications), [applications]);

  if (isTrueEmpty) {
    return (
      <div className="nexus-panel mx-auto max-w-xl px-6 py-14 text-center">
        <h2 className="text-xl font-semibold">{t("true_empty_title")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          {t("true_empty_description")}
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="nexus-button-primary nexus-target mt-6"
        >
          {t("create")}
        </button>
      </div>
    );
  }
  if (isFilteredEmpty) {
    return (
      <div className="nexus-panel mx-auto max-w-xl px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">{t("filtered_empty_title")}</h2>
        <p className="mt-2 text-sm text-slate-500">
          {t("filtered_empty_description")}
        </p>
        <button
          type="button"
          onClick={onClearFilters}
          className="nexus-button-ghost nexus-target mt-5"
        >
          {t("clear_filters")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`focus-${group.id}`}>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2
              id={`focus-${group.id}`}
              className="text-sm font-semibold text-slate-700 dark:text-slate-200"
            >
              {t(`groups.${group.id}`)}
            </h2>
            <span className="text-xs tabular-nums text-slate-400">
              {group.applications.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl bg-white/85 shadow-sm ring-1 ring-slate-200/80 dark:bg-white/[0.035] dark:ring-white/8">
            {group.applications.map((application) => (
              <FocusRow
                key={application.id}
                application={application}
                group={group.id}
                selected={selectedIds.has(application.id)}
                selectionMode={selectedIds.size > 0}
                onToggleSelect={onToggleSelect}
                onOpen={onOpen}
                onEdit={onEdit}
                onDelete={onDelete}
                onArchive={onArchive}
                onStatus={(status) =>
                  statusMutation.mutate({ id: application.id, status })
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FocusRow({
  application,
  group,
  selected,
  selectionMode,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
  onArchive,
  onStatus,
}: {
  application: Application;
  group: FocusGroupId;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (application: Application) => void;
  onEdit: (application: Application) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string, archive: boolean) => void;
  onStatus: (status: ApplicationStatus) => void;
}) {
  const t = useTranslations("focus");
  const ts = useTranslations("status");
  const ta = useTranslations("actions");
  const locale = useLocale();
  const due = formatLocalCalendarDate(application.followUpAt, locale);
  const reason =
    due && (group === "overdue" || group === "dueSoon")
      ? t(`reasons.${group}`, { date: due })
      : t(`reasons.${group}`);
  return (
    <article
      className={`flex min-h-20 items-stretch gap-1 border-b border-slate-100 p-1 last:border-b-0 dark:border-white/6 ${selected ? "bg-indigo-50 dark:bg-indigo-500/10" : ""}`}
    >
      {selectionMode && (
        <label className="nexus-target flex shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(application.id)}
            aria-label={t("select", { company: application.company })}
          />
        </label>
      )}
      <button
        type="button"
        onClick={() => onOpen(application)}
        className="nexus-focus-ring min-w-0 flex-1 rounded-xl px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-950 dark:text-white">
            {application.company}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[application.status]}`}
          >
            {ts(application.status)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-300">
          {application.role}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          <span>{reason}</span>
          {application.triageQuality && group === "highPriority" && (
            <span
              className={`rounded-full px-2 py-0.5 font-bold ${TRIAGE_COLORS[application.triageQuality]}`}
            >
              {t("priority_signal", { value: application.triageQuality })}
            </span>
          )}
        </div>
      </button>
      <div
        className="flex shrink-0 items-center gap-1"
        onClick={(event) => event.stopPropagation()}
      >
        <select
          value={application.status}
          onChange={(event) =>
            onStatus(event.target.value as ApplicationStatus)
          }
          className="nexus-focus-ring h-12 max-w-28 rounded-xl border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 sm:max-w-36 sm:text-sm"
          aria-label={t("change_status", { company: application.company })}
        >
          {STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {ts(status)}
            </option>
          ))}
        </select>
        <ActionMenu
          label={ta("opportunity_actions", { company: application.company })}
          items={[
            ...(application.jobUrl
              ? [
                  {
                    id: "job",
                    label: (
                      <span className="flex items-center gap-2">
                        {t("open_job")}
                        <ExternalLink className="h-4 w-4" />
                      </span>
                    ),
                    onSelect: () =>
                      window.open(
                        application.jobUrl!,
                        "_blank",
                        "noopener,noreferrer",
                      ),
                  },
                ]
              : []),
            {
              id: "edit",
              label: ta("edit"),
              onSelect: () => onEdit(application),
            },
            {
              id: "select",
              label: selected ? t("deselect_action") : t("select_action"),
              onSelect: () => onToggleSelect(application.id),
            },
            {
              id: "archive",
              label: ta("archive"),
              onSelect: () => onArchive(application.id, true),
            },
            {
              id: "delete",
              label: ta("delete"),
              destructive: true,
              separatorBefore: true,
              onSelect: () => onDelete(application.id),
            },
          ]}
        />
      </div>
    </article>
  );
}
