"use client";

import { useRef } from "react";

export interface DetailTab {
  id: string;
  label: string;
  count?: number;
}

interface DetailTabsProps {
  tabs: DetailTab[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
}

/**
 * Underlined tablist with roving arrow-key navigation. Panels stay mounted and
 * are hidden by the caller, so unsaved edits survive a tab switch.
 */
export function DetailTabs({ tabs, active, onSelect, label }: DetailTabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onSelect(tabs[next].id);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>("[role='tab']")
      [next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className="mt-6 flex gap-6 overflow-x-auto border-b border-slate-200/80 dark:border-white/8"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`application-${tab.id}-tab`}
            aria-controls={`application-${tab.id}-panel`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`nexus-focus-ring -mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition ${
              selected
                ? "border-indigo-600 font-medium text-slate-950 dark:border-[#7170ff] dark:text-white"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {tab.label}
            {tab.count != null && (
              <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
