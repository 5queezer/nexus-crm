export function toDateInputValue(date: Date = new Date()): string {
  return date.toISOString().split("T")[0];
}

const APPLIED_OR_LATER = new Set(["applied", "interview", "offer", "rejected"]);

/**
 * Resolve the application date without falsely turning a newly discovered lead
 * into a submitted application. An explicit value is always preserved; an
 * omitted value is only defaulted for an explicitly applied-or-later status.
 */
export function resolveAppliedAtForCreate(
  status: string,
  value: Date | string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (value instanceof Date) return value;
  if (value !== undefined && value !== null && value !== "") return new Date(value);
  return APPLIED_OR_LATER.has(status) ? now : null;
}
