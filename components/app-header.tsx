"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  FolderOpen,
  Bot,
  Settings,
  ExternalLink,
  LogOut,
  Menu,
  X,
  BriefcaseBusiness,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

interface AppHeaderProps {
  user: {
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin?: boolean;
  };
  shareUrl?: string;
  title?: string;
}

export function AppHeader({ user, shareUrl, title }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tn = useTranslations("nav");
  const tapp = useTranslations("app");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  async function handleLogout() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const navLinks = [
    { href: "/", label: tapp("title"), icon: BriefcaseBusiness, show: true },
    { href: "/documents", label: tn("documents"), icon: FolderOpen, show: true },
    { href: "/analytics", label: tn("analytics"), icon: BarChart3, show: true },
    { href: "/resume-review", label: tn("resume_ai"), icon: Bot, show: true },
    ...(user.isAdmin
      ? [{ href: "/settings", label: tn("settings"), icon: Settings, show: true }]
      : []),
  ];

  const activeLinks = navLinks.filter((l) => l.show);
  const userInitial = (user.name || user.email || "N").trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#08090a]/80">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm dark:bg-[#5e6ad2]">
              <BriefcaseBusiness className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-[-0.02em] text-slate-950 dark:text-[#f7f8f8] sm:text-base">
                {title || tapp("title")}
              </div>
              <div className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 sm:block">
                {tapp("eyebrow")}
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 rounded-2xl border border-slate-200/80 bg-slate-100/80 p-1 dark:border-white/[0.08] dark:bg-white/[0.035] md:flex">
            {activeLinks.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex min-h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ${
                    active
                      ? "bg-white text-slate-950 shadow-sm dark:bg-white/[0.08] dark:text-white"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {shareUrl && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="nexus-button-ghost min-h-10 px-3 py-2"
              >
                {tn("share")}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <ThemeSwitcher />
            <LanguageSwitcher />
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/70 px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt={user.name || user.email} className="h-8 w-8 rounded-full" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                  {userInitial}
                </div>
              )}
              <span className="max-w-[11rem] truncate text-sm font-medium text-slate-600 dark:text-slate-300">
                {user.name || user.email}
              </span>
            </div>
            <button onClick={handleLogout} className="nexus-button-ghost min-h-10 px-3 py-2" title={tn("logout")}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2 md:hidden">
            <LanguageSwitcher />
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white/70 text-slate-600 transition hover:bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#08090a]/95 md:hidden">
          <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
            {user.name || user.email}
          </div>
          <div className="flex flex-col gap-1">
            {activeLinks.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium transition ${
                    active
                      ? "bg-slate-100 text-slate-950 dark:bg-white/[0.08] dark:text-white"
                      : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.04]"
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
            {shareUrl && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 dark:text-[#828fff] dark:hover:bg-white/[0.04]"
                onClick={() => setMobileMenuOpen(false)}
              >
                <ExternalLink className="h-4 w-4" />
                {tn("share")}
              </a>
            )}
            <button
              onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-200"
            >
              <LogOut className="h-4 w-4" />
              {tn("logout")}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
