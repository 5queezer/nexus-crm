import { EMPTY_OPPORTUNITY_FILTERS, type OpportunityFilters } from "./opportunity-filters";
import { STATUS_ORDER, type ApplicationStatus } from "@/types";
import type { WorkspaceViewMode } from "@/components/workspace-toolbar";

export function parseWorkspaceUrl(search: string) {
  const params = new URLSearchParams(search);
  const status = params.get("status") as ApplicationStatus;
  const view = params.get("view");
  return {
    filters: { ...EMPTY_OPPORTUNITY_FILTERS, search: params.get("search") ?? "", status: STATUS_ORDER.includes(status) ? status : "", source: params.get("source") ?? "", remoteOnly: params.get("remote") === "true", highPriorityOnly: params.get("priority") === "true", ...(params.get("workMode") ? { workMode: params.get("workMode") } : {}) } as OpportunityFilters,
    view: (["focus", "table", "kanban"].includes(view ?? "") ? view : null) as WorkspaceViewMode | null,
    archived: params.get("archive") === "true",
  };
}

export function writeWorkspaceUrl(values: Record<string, string | boolean | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === false || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  const next = query ? `/?${query}` : "/";
  if (next !== window.location.pathname + window.location.search) {
    window.history.pushState(null, "", next);
    window.dispatchEvent(new Event("nexus:workspace-url"));
  }
}

export function subscribeWorkspaceUrl(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("nexus:workspace-url", callback);
  return () => { window.removeEventListener("popstate", callback); window.removeEventListener("nexus:workspace-url", callback); };
}
