import { toLocalCalendarInputValue } from "./local-calendar";

export function toDateInputValue(date: Date = new Date()): string {
	return toLocalCalendarInputValue(date);
}

export function resolveCreatedAtForCreate(
	value: Date | string | null | undefined,
	now: Date = new Date(),
): Date {
	if (value instanceof Date) return value;
	if (value === undefined || value === null || value === "") return now;
	return new Date(value);
}
