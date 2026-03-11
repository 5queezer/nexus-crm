"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "bossMode";
const DEFAULT_TITLE = "Job Tracker";
const BOSS_TITLE = "Workspace";

interface BossModeContextValue {
  enabled: boolean;
  toggle: () => void;
}

const BossModeContext = createContext<BossModeContextValue | null>(null);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    !!target.closest("[contenteditable='true']")
  );
}

function applyBossMode(enabled: boolean) {
  const root = document.documentElement;
  if (enabled) {
    root.dataset.bossMode = "on";
    document.title = BOSS_TITLE;
  } else {
    delete root.dataset.bossMode;
    document.title = DEFAULT_TITLE;
  }
}

export function BossModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) === "true";
      setEnabled(stored);
      applyBossMode(stored);
    } catch {
      applyBossMode(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Ignore storage failures.
    }
    applyBossMode(enabled);
  }, [enabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "b") return;
      if (isTypingTarget(event.target)) return;

      event.preventDefault();
      setEnabled((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((current) => !current);
  }, []);

  const value = useMemo(
    () => ({ enabled, toggle }),
    [enabled, toggle]
  );

  return <BossModeContext.Provider value={value}>{children}</BossModeContext.Provider>;
}

export function useBossMode() {
  const context = useContext(BossModeContext);
  if (!context) {
    throw new Error("useBossMode must be used inside BossModeProvider");
  }
  return context;
}

export function BossModeToggle({ className = "" }: { className?: string }) {
  const { enabled, toggle } = useBossMode();
  const t = useTranslations("boss");

  return (
    <button
      onClick={toggle}
      title={`${t("toggle")} (B)`}
      aria-pressed={enabled}
      className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all ${
        enabled
          ? "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
          : "border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:border-gray-500"
      } ${className}`.trim()}
    >
      <span className="text-sm leading-none">{enabled ? "🕶️" : "👔"}</span>
      <span>{t("toggle")}</span>
      <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide dark:bg-black/20">
        {enabled ? t("on") : t("off")}
      </span>
    </button>
  );
}
