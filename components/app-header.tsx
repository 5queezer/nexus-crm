"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  Activity,
  FolderOpen,
  Bot,
  Settings,
  Menu,
  BriefcaseBusiness,
  Sparkles,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { HeaderUtilityMenu } from "./header-utility-menu";
import { MobileNavigationSheet } from "./mobile-navigation-sheet";

interface AppHeaderProps {
  user: {
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin?: boolean;
  };
  shareUrl?: string;
  title?: string;
  /** Optional veto before signing out (e.g. unsaved changes on the page). */
  onBeforeLogout?: () => boolean;
}

function MobileNavigationDisclosure({ isAdmin }: { isAdmin?: boolean }) {
  const tn = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="nexus-target nexus-focus-ring flex items-center justify-center rounded-xl border border-slate-200 bg-white/70 text-slate-600 transition hover:bg-slate-50 dark:border-white/8 dark:bg-white/4 dark:text-slate-300"
        aria-label={tn("menu")}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Menu className="h-5 w-5" />
      </button>
      <MobileNavigationSheet
        open={open}
        isAdmin={isAdmin}
        onClose={close}
        onNavigate={() => setOpen(false)}
      />
    </>
  );
}

export function AppHeader({ user, shareUrl, title, onBeforeLogout }: AppHeaderProps) {
  const [unfinishedTasks, setUnfinishedTasks] = useState(0);
  useEffect(() => {
    const update = (event: Event) => {
      const count = (event as CustomEvent<{ count?: unknown }>).detail?.count;
      if (typeof count === "number" && Number.isInteger(count) && count >= 0) setUnfinishedTasks(count);
    };
    window.addEventListener("nexus:assistant-task-state", update);
    window.dispatchEvent(new Event("nexus:assistant-task-state-request"));
    return () => window.removeEventListener("nexus:assistant-task-state", update);
  }, []);
  const router = useRouter();
  const pathname = usePathname();
  const tn = useTranslations("nav");
  const tapp = useTranslations("app");
  async function handleLogout() {
    if (onBeforeLogout && !onBeforeLogout()) return;
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const navLinks = [
    {
      href: "/",
      label: tn("opportunities"),
      icon: BriefcaseBusiness,
      show: true,
    },
    {
      href: "/activity",
      label: tn("activity"),
      icon: Activity,
      show: true,
    },
    {
      href: "/documents",
      label: tn("documents"),
      icon: FolderOpen,
      show: true,
    },
    { href: "/analytics", label: tn("analytics"), icon: BarChart3, show: true },
    { href: "/resume-review", label: tn("resume_ai"), icon: Bot, show: true },
    { href: "/settings", label: tn("settings"), icon: Settings, show: true },
  ];

  const activeLinks = navLinks.filter((l) => l.show);
  return (
    <header className="nexus-app-header sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 dark:border-white/8 dark:bg-[#151618]/95">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between gap-4">
          <Link href="/" aria-label={tn("opportunities")} className="nexus-brand flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm dark:bg-[#5e6ad2]">
              <BriefcaseBusiness className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-[-0.02em] text-slate-950 dark:text-[#f7f8f8] sm:text-base">
                {title || tapp("title")}
              </div>
              <div className="hidden truncate text-[11px] text-slate-400 dark:text-slate-500 sm:block">
                {tapp("eyebrow")}
              </div>
            </div>
          </Link>

          <nav aria-label={tn("opportunities")} className="nexus-sidebar hidden lg:flex">
            {activeLinks.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href || (link.href === "/" && pathname.startsWith("/applications/"));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  title={link.label}
                  aria-label={link.label}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-9 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition ${
                    active
                      ? "bg-white text-slate-950 shadow-sm dark:bg-white/8 dark:text-white"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="hidden min-w-0 flex-1 items-center gap-2 text-xs text-slate-500 lg:flex" aria-label="Breadcrumb">
            <span>Workspace</span><span aria-hidden="true">/</span>
            <span className="truncate text-slate-800 dark:text-slate-200">{pathname.startsWith("/applications/") ? tn("opportunities") : pathname.startsWith("/tasks/") ? tn("activity") : activeLinks.find((link) => link.href === pathname)?.label}</span>
          </div>

          <button type="button" onClick={() => window.dispatchEvent(new Event("nexus:assistant-open"))} className="nexus-focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm dark:border-white/10">
            <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" />Assist
            {unfinishedTasks > 0 && <span aria-label={`${unfinishedTasks} unfinished tasks`} className="rounded bg-violet-100 px-1.5 text-xs text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">{unfinishedTasks}</span>}
          </button>

          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <HeaderUtilityMenu
              user={user}
              shareUrl={shareUrl}
              onLogout={handleLogout}
            />
          </div>

          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            <HeaderUtilityMenu
              user={user}
              shareUrl={shareUrl}
              onLogout={handleLogout}
            />
            <MobileNavigationDisclosure
              key={pathname}
              isAdmin={user.isAdmin}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
