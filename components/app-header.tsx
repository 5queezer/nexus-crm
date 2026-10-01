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

function AssistButton({ unfinishedTasks, className = "" }: { unfinishedTasks: number; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("nexus:assistant-open"))}
      className={`nexus-focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm dark:border-white/10 lg:min-h-[42px] lg:rounded-[6px] lg:border-0 lg:text-[13px] lg:font-medium lg:text-slate-500 lg:hover:text-slate-900 lg:dark:text-slate-400 lg:dark:hover:text-white ${className}`}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" />
      <span>Assist</span>
      {unfinishedTasks > 0 && <span aria-label={`${unfinishedTasks} unfinished tasks`} className="rounded bg-violet-100 px-1.5 text-xs text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">{unfinishedTasks}</span>}
    </button>
  );
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
  const mainLinks = activeLinks.filter((l) => l.href !== "/settings");
  const settingsLink = activeLinks.find((l) => l.href === "/settings");

  function renderNavLink(link: (typeof navLinks)[number]) {
    const Icon = link.icon;
    const active =
      pathname === link.href ||
      (link.href === "/" && pathname.startsWith("/applications/")) ||
      (link.href === "/activity" && pathname.startsWith("/tasks/"));
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
  }

  return (
    <header className="nexus-app-header sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 dark:border-white/8 dark:bg-[#151618]/95 lg:static lg:border-0 lg:bg-transparent lg:dark:bg-transparent">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between gap-4 lg:min-h-0">
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
            {mainLinks.map(renderNavLink)}
            <div className="mt-auto flex flex-col gap-[5px]">
              <AssistButton unfinishedTasks={unfinishedTasks} className="w-full" />
              {settingsLink && renderNavLink(settingsLink)}
              <HeaderUtilityMenu
                user={user}
                shareUrl={shareUrl}
                onLogout={handleLogout}
                variant="sidebar"
              />
            </div>
          </nav>

          <AssistButton unfinishedTasks={unfinishedTasks} className="ml-auto lg:hidden" />

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
