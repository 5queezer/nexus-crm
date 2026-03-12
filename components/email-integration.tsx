"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Mail, Unplug, RefreshCw, Settings2, Loader2 } from "lucide-react";

interface EmailIntegrationSettings {
  provider: string;
  enabled: boolean;
  scanFrequency: number;
  autoImport: string;
  scanDaysBack: number;
  lastScanAt: string | null;
  createdAt: string;
}

export function EmailIntegration() {
  const t = useTranslations("email");
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["email-settings"],
    queryFn: async () => {
      const resp = await fetch("/api/email/settings");
      const json = await resp.json();
      return json.integration as EmailIntegrationSettings | null;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (update: Partial<EmailIntegrationSettings>) => {
      const resp = await fetch("/api/email/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!resp.ok) throw new Error("Failed to update settings");
      return resp.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-settings"] }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const resp = await fetch("/api/email/settings", { method: "DELETE" });
      if (!resp.ok) throw new Error("Failed to disconnect");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-settings"] }),
  });

  const handleScan = async () => {
    setScanning(true);
    try {
      await fetch("/api/email/scan", { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["scanned-emails"] });
    } finally {
      setScanning(false);
    }
  };

  if (isLoading) {
    return (
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("loading")}
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h2>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {t("description")}
      </p>

      {!data ? (
        /* Not connected */
        <div className="space-y-3">
          <a
            href="/api/email/oauth/connect"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Mail className="w-4 h-4" />
            {t("connect_gmail")}
          </a>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {t("connect_hint")}
          </p>
        </div>
      ) : (
        /* Connected — show settings */
        <div className="space-y-5">
          {/* Connection status */}
          <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
              <Settings2 className="w-4 h-4" />
              {t("connected", { provider: data.provider })}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleScan}
                disabled={scanning}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
              >
                {scanning ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                {t("scan_now")}
              </button>
              <button
                onClick={() => {
                  if (confirm(t("confirm_disconnect"))) {
                    disconnectMutation.mutate();
                  }
                }}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
              >
                <Unplug className="w-3 h-3" />
                {t("disconnect")}
              </button>
            </div>
          </div>

          {/* Settings grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Enabled toggle */}
            <label className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("enabled")}
              </span>
              <input
                type="checkbox"
                checked={data.enabled}
                onChange={(e) =>
                  updateMutation.mutate({ enabled: e.target.checked })
                }
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>

            {/* Scan frequency */}
            <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                {t("scan_frequency")}
              </label>
              <select
                value={data.scanFrequency}
                onChange={(e) =>
                  updateMutation.mutate({
                    scanFrequency: parseInt(e.target.value, 10),
                  })
                }
                className="mt-1 w-full text-sm rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value={15}>{t("every_15min")}</option>
                <option value={30}>{t("every_30min")}</option>
                <option value={60}>{t("every_60min")}</option>
              </select>
            </div>

            {/* Auto-import mode */}
            <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                {t("auto_import")}
              </label>
              <select
                value={data.autoImport}
                onChange={(e) =>
                  updateMutation.mutate({ autoImport: e.target.value })
                }
                className="mt-1 w-full text-sm rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="off">{t("import_off")}</option>
                <option value="review">{t("import_review")}</option>
                <option value="auto">{t("import_auto")}</option>
              </select>
            </div>

            {/* Days back */}
            <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                {t("scan_days_back")}
              </label>
              <select
                value={data.scanDaysBack}
                onChange={(e) =>
                  updateMutation.mutate({
                    scanDaysBack: parseInt(e.target.value, 10),
                  })
                }
                className="mt-1 w-full text-sm rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value={3}>3 {t("days")}</option>
                <option value={7}>7 {t("days")}</option>
                <option value={14}>14 {t("days")}</option>
                <option value={30}>30 {t("days")}</option>
              </select>
            </div>
          </div>

          {/* Last scan info */}
          {data.lastScanAt && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t("last_scan", {
                time: new Date(data.lastScanAt).toLocaleString(),
              })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
