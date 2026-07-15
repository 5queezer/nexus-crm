import { format } from "date-fns";
import type { Application } from "@/types";
import { parseLocalCalendarDate } from "./local-calendar";

export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const neutralized = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

function formatCsvDate(value: string | null | undefined): string {
  const date = parseLocalCalendarDate(value);
  return date ? format(date, "yyyy-MM-dd") : "";
}

export function applicationsToCsv(applications: Application[]): string {
  const headers = [
    "Company",
    "Role",
    "Status",
    "Source",
    "Applied",
    "Last Contact",
    "Follow-up",
    "Notes",
  ];
  const rows = applications.map((application) => [
    application.company,
    application.role,
    application.status,
    application.source ?? "",
    formatCsvDate(application.appliedAt),
    formatCsvDate(application.lastContact),
    formatCsvDate(application.followUpAt),
    application.notes?.replace(/\r\n?|\n/g, " ") ?? "",
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}
