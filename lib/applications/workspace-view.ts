import type { WorkspaceViewMode } from "@/components/workspace-toolbar";

export function resolveOpportunityView(
  explicitView: WorkspaceViewMode | null,
  compactViewport: boolean | null,
  showArchived: boolean,
): WorkspaceViewMode {
  if (showArchived) {
    return explicitView === "kanban" || explicitView === "table"
      ? explicitView
      : "table";
  }
  if (explicitView) return explicitView;
  return compactViewport ? "focus" : "table";
}
