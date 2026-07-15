const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/;

/**
 * Parses calendar-only application fields without allowing UTC midnight
 * serialization to shift the intended day in negative UTC offsets.
 *
 * The application API currently persists HTML date inputs through `new Date`,
 * which serializes `YYYY-MM-DD` as `YYYY-MM-DDT00:00:00.000Z`. Treat both
 * representations as the same local calendar day. Other timestamps retain
 * normal instant semantics.
 */
export function parseLocalCalendarDate(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const calendarMatch = DATE_ONLY_PATTERN.exec(value);
  if (calendarMatch) {
    const [, year, month, day] = calendarMatch;
    const numericYear = Number(year);
    const numericMonth = Number(month);
    const numericDay = Number(day);
    const date = new Date(numericYear, numericMonth - 1, numericDay);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== numericYear ||
      date.getMonth() !== numericMonth - 1 ||
      date.getDate() !== numericDay
    ) {
      return null;
    }
    return date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toLocalCalendarInputValue(
  value: Date | string | null | undefined,
): string {
  const date =
    value instanceof Date ? value : parseLocalCalendarDate(value ?? null);
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatLocalCalendarDate(
  value: string | null | undefined,
  locale: string,
): string | null {
  const date = parseLocalCalendarDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function localCalendarTimestamp(
  value: string | null | undefined,
): number {
  return parseLocalCalendarDate(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}
