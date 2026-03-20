"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

interface KeyboardShortcutDialogProps {
  onClose: () => void;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

interface ShortcutGroup {
  titleKey: string;
  shortcuts: { keys: string[]; labelKey: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    titleKey: "navigation",
    shortcuts: [
      { keys: ["J", "↓"], labelKey: "nav_down" },
      { keys: ["K", "↑"], labelKey: "nav_up" },
      { keys: ["1–5"], labelKey: "status_filter" },
      { keys: ["Enter"], labelKey: "open_focused" },
    ],
  },
  {
    titleKey: "search",
    shortcuts: [
      { keys: [`${MOD}K`, "/"], labelKey: "open_search" },
      { keys: ["@status"], labelKey: "lock_status" },
    ],
  },
  {
    titleKey: "actions_group",
    shortcuts: [
      { keys: ["N"], labelKey: "new_app" },
      { keys: ["E"], labelKey: "edit_focused" },
      { keys: ["X"], labelKey: "toggle_select" },
      { keys: ["Esc"], labelKey: "clear_selection" },
    ],
  },
  {
    titleKey: "views",
    shortcuts: [
      { keys: ["T"], labelKey: "table_view" },
      { keys: ["B"], labelKey: "kanban_view" },
    ],
  },
  {
    titleKey: "other",
    shortcuts: [
      { keys: ["?"], labelKey: "show_shortcuts" },
    ],
  },
];

export function KeyboardShortcutDialog({ onClose }: KeyboardShortcutDialogProps) {
  const t = useTranslations("shortcuts");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-5">
          {GROUPS.map((group) => (
            <div key={group.titleKey}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                {t(group.titleKey)}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.labelKey} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {t(shortcut.labelKey)}
                    </span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={key}>
                          {i > 0 && <span className="text-gray-400 dark:text-gray-500 text-xs mx-0.5">/</span>}
                          <kbd className="inline-flex items-center px-1.5 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-300 min-w-[1.5rem] justify-center">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
