import { format } from "date-fns";
import type { Application } from "@/types";

export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const neutralized = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replace(/"/g, '""')}"`;
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
    application.appliedAt
      ? format(new Date(application.appliedAt), "yyyy-MM-dd")
      : "",
    application.lastContact
      ? format(new Date(application.lastContact), "yyyy-MM-dd")
      : "",
    application.followUpAt
      ? format(new Date(application.followUpAt), "yyyy-MM-dd")
      : "",
    application.notes?.replace(/\r\n?|\n/g, " ") ?? "",
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}
