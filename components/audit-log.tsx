"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  targetEmail: string;
  createdAt: string;
}

async function fetchAuditLogs(): Promise<AuditEntry[]> {
  const res = await fetch("/api/admin/audit-logs");
  if (!res.ok) throw new Error("Failed to fetch audit logs");
  return res.json();
}

export function AuditLog() {
  const t = useTranslations("settings.audit");

  const { data: logs = [], isLoading, isError } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: fetchAuditLogs,
  });

  if (isLoading) return <div className="py-4 text-sm text-gray-500">{t("loading")}</div>;
  if (isError) return <div className="py-4 text-sm text-red-500">{t("error_load")}</div>;

  return (
    <div>
      {logs.length === 0 ? (
        <div className="py-4 text-sm text-gray-500 dark:text-gray-400">{t("empty")}</div>
      ) : (
        <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-700">
          {logs.map((log) => (
            <div key={log.id} className="flex flex-col gap-2 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 break-words">
                <span className="font-medium text-gray-900 dark:text-white">{log.actorEmail}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  {" "}{log.action === "grant_admin" ? t("action_grant") : t("action_revoke")}{" "}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">{log.targetEmail}</span>
              </div>
              <time className="whitespace-nowrap text-xs text-gray-400 dark:text-gray-500 sm:ml-4">
                {new Date(log.createdAt).toLocaleString()}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
