"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { ApplicationStatus } from "@/types";
import { STATUS_ORDER } from "@/types";
import type { OpportunityFilters } from "@/lib/applications/opportunity-filters";

interface OpportunityFilterSheetProps {
  open: boolean;
  filters: OpportunityFilters;
  sources: string[];
  onApply: (filters: OpportunityFilters) => void;
  onClose: () => void;
}

export function OpportunityFilterSheet({
  open,
  filters,
  sources,
  onApply,
  onClose,
}: OpportunityFilterSheetProps) {
  const t = useTranslations("workspace");
  const ts = useTranslations("status");
  const [draft, setDraft] = useState(filters);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>("button, select")?.focus(),
    );
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), select:not(:disabled), input:not(:disabled)",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [filters, onClose, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-120" role="presentation">
      <button
        type="button"
        className="nexus-scrim h-full w-full"
        aria-label={t("close_filters")}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="opportunity-filter-title"
        className="nexus-bottom-sheet z-130"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
        <h2 id="opportunity-filter-title" className="text-lg font-semibold">
          {t("all_filters")}
        </h2>
        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium">
            {t("status_filter")}
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as ApplicationStatus | "",
                }))
              }
              className="nexus-input nexus-target mt-2"
            >
              <option value="">{t("all_statuses")}</option>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {ts(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t("source_filter")}
            <select
              value={draft.source}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  source: event.target.value,
                }))
              }
              className="nexus-input nexus-target mt-2"
            >
              <option value="">{t("all_sources")}</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <label className="nexus-tonal nexus-target flex cursor-pointer items-center gap-3 px-4 text-sm font-medium">
            <input
              type="checkbox"
              checked={draft.remoteOnly}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  remoteOnly: event.target.checked,
                }))
              }
            />
            {t("remote_only")}
          </label>
          <label className="nexus-tonal nexus-target flex cursor-pointer items-center gap-3 px-4 text-sm font-medium">
            <input
              type="checkbox"
              checked={draft.highPriorityOnly}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  highPriorityOnly: event.target.checked,
                }))
              }
            />
            {t("high_priority_only")}
          </label>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            className="nexus-button-ghost nexus-target"
            onClick={() =>
              setDraft({
                ...draft,
                status: "",
                source: "",
                remoteOnly: false,
                highPriorityOnly: false,
              })
            }
          >
            {t("clear")}
          </button>
          <button
            type="button"
            className="nexus-button-primary nexus-target"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            {t("apply")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
