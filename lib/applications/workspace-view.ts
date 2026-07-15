import type { WorkspaceViewMode } from "@/components/workspace-toolbar";

export function resolveOpportunityView(
  explicitView: WorkspaceViewMode | null,
  compactViewport: boolean | null,
  showArchived: boolean,
): WorkspaceViewMode {
  if (showArchived && explicitView === "focus") return "table";
  if (explicitView) return explicitView;
  return compactViewport ? "focus" : "table";
}
