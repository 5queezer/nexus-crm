"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ClipboardList } from "lucide-react";

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

  if (isLoading) return <div className="p-4 text-sm text-gray-500">{t("loading")}</div>;
  if (isError) return <div className="p-4 text-sm text-red-500">{t("error_load")}</div>;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-blue-600" />
          {t("title")}
        </h3>
      </div>
      {logs.length === 0 ? (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400">{t("empty")}</div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-96 overflow-y-auto">
          {logs.map((log) => (
            <div key={log.id} className="p-4 flex items-center justify-between text-sm">
              <div>
                <span className="font-medium text-gray-900 dark:text-white">{log.actorEmail}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  {" "}{log.action === "grant_admin" ? t("action_grant") : t("action_revoke")}{" "}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">{log.targetEmail}</span>
              </div>
              <time className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap ml-4">
                {new Date(log.createdAt).toLocaleString()}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
