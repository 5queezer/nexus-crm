"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeSwitcherProps {
  variant?: "compact" | "menu";
  label?: string;
  themeLabels?: Record<Theme, string>;
  onChange?: () => void;
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("theme") as Theme) ?? "system";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

const ICONS: Record<Theme, string> = {
  light: "\u2600",   // sun
  dark: "\u263E",     // moon
  system: "\u25D1",   // half circle
};

const CYCLE: Theme[] = ["light", "dark", "system"];

export function ThemeSwitcher({
  variant = "compact",
  label = "Theme",
  themeLabels = { light: "Light", dark: "Dark", system: "System" },
  onChange,
}: ThemeSwitcherProps = {}) {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => { if (getStoredTheme() === "system") applyTheme("system"); };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  function cycle() {
    const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
    onChange?.();
  }

  return (
    <button
      onClick={cycle}
      type="button"
      role={variant === "menu" ? "menuitem" : undefined}
      aria-label={label}
      title={themeLabels[theme]}
      className={variant === "menu"
        ? "theme-menu-control flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.07]"
        : "flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-700"
      }
    >
      {variant === "menu" && <span>{label}</span>}
      <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <span className="text-base leading-none">{ICONS[theme]}</span>
        {variant === "menu" && <span className="text-xs font-normal">{themeLabels[theme]}</span>}
      </span>
    </button>
  );
}
