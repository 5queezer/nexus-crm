const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

function parseDateOnly(value: string): CalendarDateParts {
  if (!DATE_PATTERN.test(value)) throw new Error("analytics_filter_invalid");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error("analytics_filter_invalid");
  }
  return { year, month, day };
}

function partsRecord(parts: Intl.DateTimeFormatPart[]): Record<string, number> {
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function calendarDateParts(date: Date, timeZone: string): CalendarDateParts {
  const parts = partsRecord(new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date));
  return { year: parts.year, month: parts.month, day: parts.day };
}

function calendarDayNumber(parts: CalendarDateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS;
}

function firstInstantOfCalendarDate(parts: CalendarDateParts, timeZone: string): Date {
  const targetDay = calendarDayNumber(parts);
  const approximateUtc = targetDay * DAY_MS;
  let lower = approximateUtc - (2 * DAY_MS);
  let upper = approximateUtc + (2 * DAY_MS);

  // UTC offsets stay within this four-day bracket. Binary search also handles
  // days that begin after midnight because a DST transition skipped local time.
  for (let iteration = 0; iteration < 40 && lower < upper; iteration += 1) {
    const middle = Math.floor((lower + upper) / 2);
    const middleDay = calendarDayNumber(calendarDateParts(new Date(middle), timeZone));
    if (middleDay < targetDay) lower = middle + 1;
    else upper = middle;
  }

  const result = new Date(lower);
  if (calendarDayNumber(calendarDateParts(result, timeZone)) !== targetDay) {
    throw new Error("analytics_filter_invalid");
  }
  return result;
}

export function normalizeAnalyticsTimeZone(value?: string | null): string {
  // Existing API and assistant callers omitted this field, so UTC remains the explicit compatibility default.
  const timeZone = value ?? "UTC";
  if (!timeZone || timeZone.length > 100) throw new Error("analytics_filter_invalid");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    throw new Error("analytics_filter_invalid");
  }
  return timeZone;
}

export function dateOnlyInTimeZone(date: Date, timeZone: string): string {
  const parts = calendarDateParts(date, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addCalendarDays(value: string, days: number): string {
  const parts = parseDateOnly(value);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return shifted.toISOString().slice(0, 10);
}

export function dateOnlyRangeInTimeZone(start: string, end: string, timeZone: string) {
  const startParts = parseDateOnly(start);
  const startDate = firstInstantOfCalendarDate(startParts, timeZone);
  const dayAfterEnd = parseDateOnly(addCalendarDays(end, 1));
  const endDate = new Date(firstInstantOfCalendarDate(dayAfterEnd, timeZone).getTime() - 1);
  if (startDate > endDate) throw new Error("analytics_filter_invalid");
  return { start: startDate, end: endDate };
}

export function calendarDayDifference(start: Date, end: Date, timeZone: string): number {
  const startParts = calendarDateParts(start, timeZone);
  const endParts = calendarDateParts(end, timeZone);
  return calendarDayNumber(endParts) - calendarDayNumber(startParts);
}
