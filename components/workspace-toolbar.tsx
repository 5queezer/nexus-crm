import { ReactNode } from "react";

export type WorkspaceViewMode = "focus" | "table" | "kanban";

interface WorkspaceToolbarProps {
  title: string;
  count: number;
  viewMode: WorkspaceViewMode;
  onViewModeChange: (viewMode: WorkspaceViewMode) => void;
  moreMenu: ReactNode;
  onCreate: () => void;
  createLabel: string;
  focusLabel: string;
  tableLabel: string;
  kanbanLabel: string;
  listLabel?: string;
  stagesLabel?: string;
  showFocus?: boolean;
}

export function WorkspaceToolbar({
  title,
  count,
  viewMode,
  onViewModeChange,
  moreMenu,
  onCreate,
  createLabel,
  focusLabel,
  tableLabel,
  kanbanLabel,
  listLabel = tableLabel,
  stagesLabel = kanbanLabel,
  showFocus = true,
}: WorkspaceToolbarProps) {
  const views = [
    ...(showFocus
      ? [{ id: "focus" as const, compact: focusLabel, expanded: focusLabel }]
      : []),
    { id: "table" as const, compact: listLabel, expanded: tableLabel },
    { id: "kanban" as const, compact: stagesLabel, expanded: kanbanLabel },
  ];
  return (
    <div className="mb-4 space-y-3 sm:mb-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
          {title} <span className="text-slate-400">({count})</span>
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {moreMenu}
          <button
            type="button"
            onClick={onCreate}
            data-dashboard-create-control="desktop"
            className="nexus-button-primary nexus-target hidden whitespace-nowrap lg:inline-flex"
          >
            <span aria-hidden="true">+</span>
            {createLabel}
          </button>
        </div>
      </div>
      <div
        role="group"
        aria-label={views.map((view) => view.expanded).join(" / ")}
        className="grid min-h-12 w-full grid-flow-col overflow-hidden rounded-xl bg-slate-100 p-1 dark:bg-white/[0.055] lg:inline-grid lg:w-auto"
      >
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-pressed={viewMode === view.id}
            onClick={() => onViewModeChange(view.id)}
            className={`nexus-focus-ring min-h-12 min-w-0 rounded-lg px-3 text-sm font-medium transition lg:min-w-28 ${viewMode === view.id ? "bg-white text-slate-950 shadow-sm dark:bg-white/10 dark:text-white" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}
          >
            <span className="lg:hidden">{view.compact}</span>
            <span className="hidden lg:inline">{view.expanded}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
