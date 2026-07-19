"use client";

import { useState } from "react";

/**
 * Collapsible chrome used inside the create modal (title row toggles the body,
 * `aria-expanded` mirrors the open state). The title may be a function of the
 * open state for show/hide labels.
 */
export function CollapsibleCard({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode | ((open: boolean) => React.ReactNode);
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/8">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="nexus-target flex w-full items-center justify-between bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:bg-white/4 dark:text-slate-300 dark:hover:bg-white/6"
      >
        <span className="flex min-w-0 items-center gap-2">
          {typeof title === "function" ? title(open) : title}
          {badge}
        </span>
        <span aria-hidden="true" className="shrink-0 text-slate-400">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

/**
 * Always-open panel chrome for the detail page, mirroring the settings page
 * section pattern on the nexus design tokens.
 */
export function SectionCard({
  title,
  description,
  headerExtra,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="nexus-panel">
      <div className="border-b border-slate-200/80 px-5 py-4 dark:border-white/8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-slate-950 dark:text-[#f7f8f8]">
            {title}
          </h2>
          {headerExtra}
        </div>
        {description ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}
