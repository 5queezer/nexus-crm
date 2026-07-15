import { getSourceCategory, type Application, type ApplicationStatus } from "@/types";

export interface OpportunityFilters {
  search: string;
  status: ApplicationStatus | "";
  source: string;
  remoteOnly: boolean;
  highPriorityOnly: boolean;
}

export const EMPTY_OPPORTUNITY_FILTERS: OpportunityFilters = {
  search: "",
  status: "",
  source: "",
  remoteOnly: false,
  highPriorityOnly: false,
};

export function hasOpportunityFilters(filters: OpportunityFilters): boolean {
  return Boolean(
    filters.search.trim() ||
    filters.status ||
    filters.source ||
    filters.remoteOnly ||
    filters.highPriorityOnly,
  );
}

export function opportunityMatchesSearch(
  application: Application,
  search: string,
): boolean {
  const query = search.toLowerCase().trim();
  if (!query) return true;
  const haystack = [
    application.company,
    application.role,
    application.source,
    application.notes,
    ...(application.contacts?.map((contact) => contact.name) ?? []),
  ];
  return haystack.some((value) => value?.toLowerCase().includes(query));
}

export function opportunityMatchesFilters(
  application: Application,
  filters: OpportunityFilters,
): boolean {
  return (
    opportunityMatchesSearch(application, filters.search) &&
    (!filters.status || application.status === filters.status) &&
    (!filters.source || getSourceCategory(application.source) === filters.source) &&
    (!filters.remoteOnly || application.remote) &&
    (!filters.highPriorityOnly ||
      (application.triageQuality != null && application.triageQuality >= 4))
  );
}

export function filterOpportunities(
  applications: Application[],
  filters: OpportunityFilters,
): Application[] {
  return applications.filter((application) =>
    opportunityMatchesFilters(application, filters),
  );
}

export function countOpportunityFilters(filters: OpportunityFilters): number {
  return [
    filters.status,
    filters.source,
    filters.remoteOnly,
    filters.highPriorityOnly,
  ].filter(Boolean).length;
}
