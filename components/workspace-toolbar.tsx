import { ReactNode } from "react";

type WorkspaceViewMode = "table" | "kanban";

interface WorkspaceToolbarProps {
  title: string;
  count: number;
  viewMode: WorkspaceViewMode;
  onViewModeChange: (viewMode: WorkspaceViewMode) => void;
  moreMenu: ReactNode;
  onCreate: () => void;
  createLabel: string;
  tableLabel: string;
  kanbanLabel: string;
}

export function WorkspaceToolbar({
  title,
  count,
  viewMode,
  onViewModeChange,
  moreMenu,
  onCreate,
  createLabel,
  tableLabel,
  kanbanLabel,
}: WorkspaceToolbarProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="min-w-0 truncate text-lg font-semibold text-slate-900 dark:text-white">
        {title} ({count})
      </h1>

      <div className="grid w-full grid-cols-[auto_1fr] items-center gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
        <div
          role="group"
          aria-label={`${tableLabel} / ${kanbanLabel}`}
          className="col-span-2 inline-flex min-w-0 w-full items-center overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-xs dark:border-white/10 dark:bg-white/[0.035] sm:w-auto sm:flex-none"
        >
          <button
            type="button"
            aria-pressed={viewMode === "table"}
            onClick={() => onViewModeChange("table")}
            className={`min-h-10 flex-1 whitespace-nowrap px-3 font-medium transition-colors sm:flex-none ${
              viewMode === "table"
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.06]"
            }`}
          >
            {tableLabel}
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "kanban"}
            onClick={() => onViewModeChange("kanban")}
            className={`min-h-10 flex-1 whitespace-nowrap px-3 font-medium transition-colors sm:flex-none ${
              viewMode === "kanban"
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.06]"
            }`}
          >
            {kanbanLabel}
          </button>
        </div>

        {moreMenu}

        <button
          type="button"
          onClick={onCreate}
          className="nexus-button-primary min-h-10 justify-self-end whitespace-nowrap px-4 sm:justify-self-auto"
        >
          <span aria-hidden="true">+</span>
          {createLabel}
        </button>
      </div>
    </div>
  );
}
