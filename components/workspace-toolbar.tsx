import { ReactNode } from "react";

export type WorkspaceViewMode = "focus" | "table" | "kanban";

interface WorkspaceToolbarProps {
  title: string;
  count: number;
  countLabel?: string;
  viewMode: WorkspaceViewMode;
  onViewModeChange: (viewMode: WorkspaceViewMode) => void;
  moreMenu: ReactNode;
  onCreate: () => void;
  createDisabled?: boolean;
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
  countLabel,
  viewMode,
  onViewModeChange,
  moreMenu,
  onCreate,
  createDisabled = false,
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
        <div className="min-w-0"><h1 className="truncate text-[27px] font-semibold tracking-tight text-slate-950 dark:text-white">{title}</h1>
          <p className="mt-1 text-xs text-slate-500">{countLabel ?? `${count} opportunities`}</p></div>
        <div className="flex shrink-0 items-center gap-2">
          {moreMenu}
          <button
            type="button"
            onClick={onCreate}
            disabled={createDisabled}
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
        className="flex min-h-12 w-full gap-5 overflow-x-auto border-b border-slate-200 dark:border-white/10"
      >
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-pressed={viewMode === view.id}
            onClick={() => onViewModeChange(view.id)}
            className={`nexus-focus-ring min-h-12 shrink-0 border-b-2 px-1 text-sm font-medium transition ${viewMode === view.id ? "border-violet-600 text-slate-950 dark:border-violet-400 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}
          >
            <span className="lg:hidden">{view.compact}</span>
            <span className="hidden lg:inline">{view.compact}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
