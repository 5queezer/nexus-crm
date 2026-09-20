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
  const [actionError, setActionError] = useState(false);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["email-settings"],
    queryFn: async () => {
      const resp = await fetch("/api/email/settings");
      if (!resp.ok) throw new Error("Failed to load email settings");
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
    onMutate: () => setActionError(false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-settings"] }),
    onError: () => setActionError(true),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const resp = await fetch("/api/email/settings", { method: "DELETE" });
      if (!resp.ok) throw new Error("Failed to disconnect");
    },
    onMutate: () => setActionError(false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-settings"] }),
    onError: () => setActionError(true),
  });

  const handleScan = async () => {
    setScanning(true);
    setActionError(false);
    try {
      const resp = await fetch("/api/email/scan", { method: "POST" });
      if (!resp.ok) throw new Error("Failed to scan email");
      queryClient.invalidateQueries({ queryKey: ["scanned-emails"] });
    } catch {
      setActionError(true);
    } finally {
      setScanning(false);
    }
  };

  if (isLoading) {
    return (
      <section className="py-2">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("loading")}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="space-y-3 py-2">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t("settings_load_error")}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {t("retry")}
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {actionError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t("action_failed")}
        </p>
      )}
      {!data ? (
        /* Not connected */
        <div className="space-y-3">
          <a
            href="/api/email/oauth/connect"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:ring-offset-gray-900"
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
          <div className="flex flex-col items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-green-800 dark:bg-green-900/20">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
              <Settings2 className="w-4 h-4" />
              {t("connected", { provider: data.provider })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleScan}
                disabled={scanning}
                className="inline-flex min-h-11 items-center gap-1 rounded-md bg-blue-100 px-3 py-2 text-xs text-blue-700 transition-colors hover:bg-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
              >
                {scanning ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                {t("scan_now")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(t("confirm_disconnect"))) {
                    disconnectMutation.mutate();
                  }
                }}
                className="inline-flex min-h-11 items-center gap-1 rounded-md bg-red-100 px-3 py-2 text-xs text-red-700 transition-colors hover:bg-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
              >
                <Unplug className="w-3 h-3" />
                {t("disconnect")}
              </button>
            </div>
          </div>

          {/* Settings grid */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {/* Enabled toggle */}
            <label className="flex min-h-11 items-center justify-between gap-4 py-1">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("enabled")}
              </span>
              <input
                type="checkbox"
                checked={data.enabled}
                onChange={(e) =>
                  updateMutation.mutate({ enabled: e.target.checked })
                }
                className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
            </label>

            {/* Scan frequency */}
            <div>
              <label htmlFor="email-scan-frequency" className="text-sm text-gray-700 dark:text-gray-300">
                {t("scan_frequency")}
              </label>
              <select
                id="email-scan-frequency"
                value={data.scanFrequency}
                onChange={(e) =>
                  updateMutation.mutate({
                    scanFrequency: parseInt(e.target.value, 10),
                  })
                }
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                <option value={15}>{t("every_15min")}</option>
                <option value={30}>{t("every_30min")}</option>
                <option value={60}>{t("every_60min")}</option>
              </select>
            </div>

            {/* Auto-import mode */}
            <div>
              <label htmlFor="email-auto-import" className="text-sm text-gray-700 dark:text-gray-300">
                {t("auto_import")}
              </label>
              <select
                id="email-auto-import"
                value={data.autoImport}
                onChange={(e) =>
                  updateMutation.mutate({ autoImport: e.target.value })
                }
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
                <option value="off">{t("import_off")}</option>
                <option value="review">{t("import_review")}</option>
                <option value="auto">{t("import_auto")}</option>
              </select>
            </div>

            {/* Days back */}
            <div>
              <label htmlFor="email-scan-days" className="text-sm text-gray-700 dark:text-gray-300">
                {t("scan_days_back")}
              </label>
              <select
                id="email-scan-days"
                value={data.scanDaysBack}
                onChange={(e) =>
                  updateMutation.mutate({
                    scanDaysBack: parseInt(e.target.value, 10),
                  })
                }
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
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
