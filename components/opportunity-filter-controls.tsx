"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ApplicationStatus } from "@/types";
import { STATUS_ORDER } from "@/types";
import {
  countOpportunityFilters,
  type OpportunityFilters,
} from "@/lib/applications/opportunity-filters";
import { OpportunityFilterSheet } from "./opportunity-filter-sheet";

interface OpportunityFilterControlsProps {
  filters: OpportunityFilters;
  sources: string[];
  resultCount: number;
  onChange: (filters: OpportunityFilters) => void;
  onClear: () => void;
}

export function OpportunityFilterControls({
  filters,
  sources,
  resultCount,
  onChange,
  onClear,
}: OpportunityFilterControlsProps) {
  const t = useTranslations("workspace");
  const ts = useTranslations("status");
  const tAnalytics = useTranslations("analytics");
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetTriggerRef = useRef<HTMLButtonElement>(null);
  const secondaryCount = countOpportunityFilters(filters);

  function closeSheet() {
    setSheetOpen(false);
    requestAnimationFrame(() => sheetTriggerRef.current?.focus());
  }

  return (
    <div className="mb-4 space-y-3" aria-label={t("filters_label")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={filters.search}
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
          placeholder={t("search_placeholder")}
          aria-label={t("search_placeholder")}
          className="nexus-input nexus-target pl-11"
        />
      </div>

      <div className="flex items-center gap-2 lg:hidden">
        <button
          ref={sheetTriggerRef}
          type="button"
          className="nexus-button-ghost nexus-target flex-1"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {t("all_filters_count", { count: secondaryCount })}
        </button>
        <span className="text-xs text-slate-500" aria-live="polite">
          {t("results", { count: resultCount })}
        </span>
      </div>

      <div className="hidden items-center gap-2 lg:flex">
        <select
          value={filters.status}
          onChange={(event) =>
            onChange({
              ...filters,
              status: event.target.value as ApplicationStatus | "",
            })
          }
          className="nexus-input nexus-target w-auto min-w-44"
        >
          <option value="">{t("all_statuses")}</option>
          {STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {ts(status)}
            </option>
          ))}
        </select>
        <select
          value={filters.source}
          onChange={(event) =>
            onChange({ ...filters, source: event.target.value })
          }
          className="nexus-input nexus-target w-auto min-w-40"
        >
          <option value="">{t("all_sources")}</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {tAnalytics(`source_labels.${source}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={filters.remoteOnly}
          onClick={() =>
            onChange({ ...filters, remoteOnly: !filters.remoteOnly })
          }
          className={`nexus-button-ghost nexus-target ${filters.remoteOnly ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10" : ""}`}
        >
          {t("remote_only")}
        </button>
        <button
          type="button"
          aria-pressed={filters.highPriorityOnly}
          onClick={() =>
            onChange({
              ...filters,
              highPriorityOnly: !filters.highPriorityOnly,
            })
          }
          className={`nexus-button-ghost nexus-target ${filters.highPriorityOnly ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10" : ""}`}
        >
          {t("high_priority_only")}
        </button>
        {(filters.search || secondaryCount > 0) && (
          <button
            type="button"
            className="nexus-target inline-flex items-center gap-1 px-2 text-sm font-medium text-slate-500"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
            {t("clear")}
          </button>
        )}
        <span className="ml-auto text-sm text-slate-500" aria-live="polite">
          {t("results", { count: resultCount })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:hidden">
        {filters.status && (
          <FilterChip
            label={ts(filters.status)}
            onRemove={() => onChange({ ...filters, status: "" })}
          />
        )}
        {filters.source && (
          <FilterChip
            label={tAnalytics(`source_labels.${filters.source}`)}
            onRemove={() => onChange({ ...filters, source: "" })}
          />
        )}
        {filters.remoteOnly && (
          <FilterChip
            label={t("remote_only")}
            onRemove={() => onChange({ ...filters, remoteOnly: false })}
          />
        )}
        {filters.highPriorityOnly && (
          <FilterChip
            label={t("high_priority_only")}
            onRemove={() => onChange({ ...filters, highPriorityOnly: false })}
          />
        )}
        {(filters.search || secondaryCount > 0) && (
          <button
            type="button"
            className="nexus-target ml-auto inline-flex items-center gap-1 px-2 text-sm font-medium text-slate-500"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
            {t("clear")}
          </button>
        )}
      </div>

      {sheetOpen && (
        <OpportunityFilterSheet
          open
          filters={filters}
          sources={sources}
          onApply={onChange}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  const t = useTranslations("workspace");
  return (
    <span className="nexus-chip min-h-12 gap-1 pl-3">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="nexus-focus-ring -mr-2 inline-flex h-12 w-12 items-center justify-center rounded-full"
        aria-label={t("remove_filter", { label })}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
