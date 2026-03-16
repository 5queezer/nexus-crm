"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const SETTINGS_KEY = "appSettings";

export interface AppSettings {
  appTitle: string;
  appSubtitle: string;
  shareOwnerName: string;
}

const DEFAULTS: AppSettings = {
  appTitle: "Nexus CRM",
  appSubtitle: "",
  shareOwnerName: "",
};

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveAppSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}

export function AppSettingsPanel() {
  const t = useTranslations("settings");
  const ta = useTranslations("actions");
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadAppSettings());
  }, []);

  const handleChange = useCallback(
    (key: keyof AppSettings, value: string) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
    },
    []
  );

  function handleSave() {
    saveAppSettings(settings);
    setSaved(true);
    // Update document title immediately
    if (settings.appTitle) {
      document.title = settings.appTitle;
    }
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-100 px-6 py-4 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("appearance.title")}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("appearance.description")}
        </p>
      </div>
      <div className="space-y-5 px-6 py-5">
        <div>
          <label
            htmlFor="appTitle"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("appearance.app_title")}
          </label>
          <input
            id="appTitle"
            type="text"
            value={settings.appTitle}
            onChange={(e) => handleChange("appTitle", e.target.value)}
            placeholder="Nexus CRM"
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
        </div>
        <div>
          <label
            htmlFor="appSubtitle"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("appearance.app_subtitle")}
          </label>
          <input
            id="appSubtitle"
            type="text"
            value={settings.appSubtitle}
            onChange={(e) => handleChange("appSubtitle", e.target.value)}
            placeholder={t("appearance.app_subtitle_placeholder")}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
        </div>
        <div>
          <label
            htmlFor="shareOwnerName"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("appearance.share_owner_name")}
          </label>
          <input
            id="shareOwnerName"
            type="text"
            value={settings.shareOwnerName}
            onChange={(e) => handleChange("shareOwnerName", e.target.value)}
            placeholder={t("appearance.share_owner_placeholder")}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {t("appearance.share_owner_hint")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-700">
        <button
          onClick={handleSave}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          {ta("save")}
        </button>
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">
            {t("appearance.saved")}
          </span>
        )}
      </div>
    </section>
  );
}
