"use client";

import { useState, useEffect } from "react";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

const SHORTCUTS = [
  { key: IS_MAC ? "⌘K" : "Ctrl+K", label: "Search" },
  { key: "N", label: "New" },
  { key: "T", label: "Table" },
  { key: "B", label: "Board" },
  { key: "J/K", label: "Navigate" },
  { key: "X", label: "Select" },
  { key: "?", label: "Help" },
];

export function KeyboardShortcutBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Control" || e.key === "Meta") {
        setVisible(true);
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === "Control" || e.key === "Meta") {
        setVisible(false);
      }
    }
    function handleBlur() {
      setVisible(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 hidden md:flex items-center justify-center gap-3 bg-gray-900/90 backdrop-blur-sm text-white px-4 py-2 transition-opacity">
      {SHORTCUTS.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-xs">
          <kbd className="px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-[11px] font-mono min-w-[1.5rem] text-center">
            {s.key}
          </kbd>
          <span className="text-gray-300">{s.label}</span>
        </span>
      ))}
    </div>
  );
}
