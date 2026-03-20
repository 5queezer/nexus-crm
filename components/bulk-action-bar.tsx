"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ApplicationStatus, STATUS_ORDER, STATUS_COLORS } from "@/types";

interface BulkActionBarProps {
  selectedCount: number;
  onChangeStatus: (status: ApplicationStatus) => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function BulkActionBar({ selectedCount, onChangeStatus, onArchive, onDelete, onClear }: BulkActionBarProps) {
  const t = useTranslations("bulk_actions");
  const ts = useTranslations("status");
  const [statusOpen, setStatusOpen] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("selected", { count: selectedCount })}
          </span>
          {selectedCount > 100 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {t("max_warning")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Status change dropdown */}
          <div className="relative">
            <button
              onClick={() => setStatusOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t("change_status")}
              <span className="text-xs">{statusOpen ? "▲" : "▼"}</span>
            </button>
            {statusOpen && (
              <div className="absolute bottom-full mb-1 right-0 w-44 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
                {STATUS_ORDER.map((status) => (
                  <button
                    key={status}
                    onClick={() => {
                      setStatusOpen(false);
                      onChangeStatus(status);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[status]}`}>
                      {ts(status)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onArchive}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
          >
            {t("archive_selected")}
          </button>

          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
          >
            {t("delete_selected")}
          </button>

          <button
            onClick={onClear}
            className="inline-flex items-center rounded-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {t("clear")}
          </button>
        </div>
      </div>
    </div>
  );
}
