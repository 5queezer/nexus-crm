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
    return true;
  } catch {
    return false;
  }
}

interface AppSettingsPanelProps {
  onDirtyChange?: (dirty: boolean) => void;
}

export function AppSettingsPanel({ onDirtyChange }: AppSettingsPanelProps = {}) {
  const t = useTranslations("settings");
  const ta = useTranslations("actions");
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [savedSettings, setSavedSettings] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const isDirty =
    settings.appTitle !== savedSettings.appTitle ||
    settings.appSubtitle !== savedSettings.appSubtitle ||
    settings.shareOwnerName !== savedSettings.shareOwnerName;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleChange = useCallback(
    (key: keyof AppSettings, value: string) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
      setSaveError(false);
    },
    []
  );

  function handleSave() {
    if (!saveAppSettings(settings)) {
      setSaveError(true);
      return;
    }
    setSavedSettings(settings);
    setSaved(true);
    setSaveError(false);
    // Update document title immediately
    if (settings.appTitle) {
      document.title = settings.appTitle;
    }
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
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
            className="mt-1 block min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
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
            className="mt-1 block min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
        <div className="sm:col-span-2">
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
            className="mt-1 block min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {t("appearance.share_owner_hint")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleSave}
          className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:ring-offset-gray-900"
        >
          {ta("save")}
        </button>
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">
            {t("appearance.saved")}
          </span>
        )}
        {saveError && (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t("appearance.save_error")}
          </span>
        )}
      </div>
    </section>
  );
}
