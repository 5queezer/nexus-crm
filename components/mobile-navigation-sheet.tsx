"use client";

import {
  BarChart3,
  Activity,
  Bot,
  BriefcaseBusiness,
  FolderOpen,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface MobileNavigationSheetProps {
  open: boolean;
  isAdmin?: boolean;
  onClose: () => void;
  onNavigate?: () => void;
}

export function MobileNavigationSheet({
  open,
  isAdmin,
  onClose,
  onNavigate = onClose,
}: MobileNavigationSheetProps) {
  const tn = useTranslations("nav");
  const t = useTranslations("workspace");
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const routes = [
    { href: "/", label: tn("opportunities"), icon: BriefcaseBusiness },
    { href: "/activity", label: tn("activity"), icon: Activity },
    { href: "/documents", label: tn("documents"), icon: FolderOpen },
    { href: "/analytics", label: tn("analytics"), icon: BarChart3 },
    { href: "/resume-review", label: tn("resume_ai"), icon: Bot },
    ...(isAdmin
      ? [{ href: "/settings", label: tn("settings"), icon: Settings }]
      : []),
  ];

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>("a, button")?.focus(),
    );
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "a, button:not(:disabled)",
        ),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    const desktopMedia =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 1024px)")
        : null;
    function handleBreakpointChange(event: MediaQueryListEvent) {
      if (event.matches) onClose();
    }
    desktopMedia?.addEventListener("change", handleBreakpointChange);
    if (desktopMedia?.matches) onClose();

    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", handleKey);
      desktopMedia?.removeEventListener("change", handleBreakpointChange);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-120 lg:hidden">
      <button
        type="button"
        className="nexus-scrim h-full w-full"
        aria-label={t("close_navigation")}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-navigation-title"
        className="nexus-bottom-sheet z-130"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
        <div className="flex min-h-12 items-center justify-between gap-3">
          <h2 id="mobile-navigation-title" className="text-lg font-semibold">
            {t("navigation")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="nexus-target nexus-focus-ring flex items-center justify-center rounded-xl"
            aria-label={t("close_navigation")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="mt-3 space-y-1">
          {routes.map((route) => {
            const Icon = route.icon;
            const active = pathname === route.href;
            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={`nexus-focus-ring flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium ${active ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/6"}`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="min-w-0 wrap-break-word">{route.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>,
    document.body,
  );
}
