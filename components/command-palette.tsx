"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Application, ApplicationStatus, STATUS_COLORS, STATUS_ORDER } from "@/types";

interface CommandPaletteProps {
  applications: Application[];
  onSelect: (app: Application) => void;
  onClose: () => void;
}

interface ScoredApp {
  app: Application;
  score: number;
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  // Check if all characters appear in order
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 30 : 0;
}

function matchApp(query: string, app: Application): number {
  const scores = [
    fuzzyScore(query, app.company),
    fuzzyScore(query, app.role),
    app.source ? fuzzyScore(query, app.source) : 0,
  ];
  return Math.max(...scores);
}

const STATUS_ALIASES: Record<string, ApplicationStatus> = {
  inb: "inbound",
  inbound: "inbound",
  new: "inbound",
  app: "applied",
  applied: "applied",
  con: "applied",
  contacted: "applied",
  int: "interview",
  interview: "interview",
  neg: "interview",
  off: "offer",
  offer: "offer",
  clo: "offer",
  closing: "offer",
  rej: "rejected",
  rejected: "rejected",
  los: "rejected",
  lost: "rejected",
};

export function CommandPalette({ applications, onSelect, onClose }: CommandPaletteProps) {
  const t = useTranslations("command_palette");
  const ts = useTranslations("status");
  const [query, setQuery] = useState("");
  const [statusLock, setStatusLock] = useState<ApplicationStatus | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Status lock: typing @prefix then Tab/Enter
      if ((e.key === "Tab" || e.key === "Enter") && query.startsWith("@") && !statusLock) {
        const prefix = query.slice(1).toLowerCase();
        const matched = STATUS_ALIASES[prefix];
        if (matched) {
          e.preventDefault();
          setStatusLock(matched);
          setQuery("");
          setSelectedIndex(0);
          return;
        }
      }

      // Backspace on empty query clears lock
      if (e.key === "Backspace" && query === "" && statusLock) {
        e.preventDefault();
        setStatusLock(null);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => i + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" && !query.startsWith("@")) {
        e.preventDefault();
        // select current item
      }
    },
    [query, statusLock, onClose]
  );

  const results = useMemo(() => {
    let pool = applications;
    if (statusLock) {
      pool = pool.filter((a) => a.status === statusLock);
    }

    if (!query || query.startsWith("@")) {
      // Show all (or locked) sorted by updatedAt
      return pool
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 50);
    }

    const scored: ScoredApp[] = pool
      .map((app) => ({ app, score: matchApp(query, app) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || new Date(b.app.updatedAt).getTime() - new Date(a.app.updatedAt).getTime());

    return scored.slice(0, 50).map((s) => s.app);
  }, [applications, query, statusLock]);

  // Group by status
  const grouped = useMemo(() => {
    const groups: { status: ApplicationStatus; apps: Application[] }[] = [];
    for (const status of STATUS_ORDER) {
      const apps = results.filter((a) => a.status === status);
      if (apps.length > 0) groups.push({ status, apps });
    }
    return groups;
  }, [results]);

  // Flat list for keyboard nav
  const flatList = useMemo(() => grouped.flatMap((g) => g.apps), [grouped]);

  // Clamp selectedIndex using useMemo to derive the clamped value
  const clampedSelectedIndex = useMemo(
    () => Math.min(selectedIndex, Math.max(0, flatList.length - 1)),
    [selectedIndex, flatList.length]
  );

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${clampedSelectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedSelectedIndex]);

  function handleSelect(app: Application) {
    onSelect(app);
    onClose();
  }

  // Handle Enter on selected item
  function handleEnter() {
    if (flatList[clampedSelectedIndex]) {
      handleSelect(flatList[clampedSelectedIndex]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg mx-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center border-b border-gray-200 dark:border-gray-700 px-4">
          <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {statusLock && (
            <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[statusLock]}`}>
              {ts(statusLock)}
              <button
                onClick={() => setStatusLock(null)}
                className="ml-1 hover:opacity-70"
              >
                ×
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              handleKeyDown(e);
              if (e.key === "Enter" && !query.startsWith("@")) {
                handleEnter();
              }
            }}
            placeholder={statusLock ? t("search_in_status") : t("placeholder")}
            className="flex-1 bg-transparent px-3 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600 rounded">
            ESC
          </kbd>
        </div>

        {/* Hint for status lock */}
        {query.startsWith("@") && !statusLock && (
          <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
            {t("status_lock_hint")}
          </div>
        )}

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {flatList.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              {t("no_results")}
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.status}>
                <div className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 sticky top-0 bg-white dark:bg-gray-800">
                  {ts(group.status)} ({group.apps.length})
                </div>
                {group.apps.map((app) => {
                  const idx = flatList.indexOf(app);
                  return (
                    <button
                      key={app.id}
                      data-index={idx}
                      onClick={() => handleSelect(app)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                        idx === clampedSelectedIndex
                          ? "bg-blue-50 dark:bg-blue-900/30"
                          : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                            {app.company}
                          </span>
                          {app.remote && (
                            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                              Remote
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {app.role}
                          {app.source && <span className="ml-2 text-gray-400 dark:text-gray-500">via {app.source}</span>}
                        </div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[app.status]}`}>
                        {ts(app.status)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-2 flex items-center gap-4 text-[10px] text-gray-400 dark:text-gray-500">
          <span><kbd className="px-1 py-0.5 border border-gray-200 dark:border-gray-600 rounded text-[10px]">↑↓</kbd> {t("navigate")}</span>
          <span><kbd className="px-1 py-0.5 border border-gray-200 dark:border-gray-600 rounded text-[10px]">↵</kbd> {t("select")}</span>
          <span><kbd className="px-1 py-0.5 border border-gray-200 dark:border-gray-600 rounded text-[10px]">@</kbd> {t("filter_status")}</span>
        </div>
      </div>
    </div>
  );
}
