import { APPLICATION_EVENT_TYPES } from "./events";

// These audit entries are written by domain jobs, not by the activity composer.
const LABELED_EVENT_TYPES = new Set<string>([
  ...APPLICATION_EVENT_TYPES,
  "application_archived",
  "application_restored",
  "bulk_change_undone",
]);

export function hasEventLabel(type: string): boolean {
  return LABELED_EVENT_TYPES.has(type);
}

export function formatEventDateTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}
