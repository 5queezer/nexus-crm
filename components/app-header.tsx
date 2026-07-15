"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  FolderOpen,
  Bot,
  Settings,
  Menu,
  BriefcaseBusiness,
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
}

export function AppHeader({ user, shareUrl, title }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tn = useTranslations("nav");
  const tapp = useTranslations("app");
  const [mobileMenuPath, setMobileMenuPath] = useState<string | null>(null);
  const mobileMenuOpen = mobileMenuPath === pathname;
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const closeMobileMenu = useCallback(() => {
    setMobileMenuPath(null);
    requestAnimationFrame(() => mobileMenuTriggerRef.current?.focus());
  }, []);

  async function handleLogout() {
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
      href: "/documents",
      label: tn("documents"),
      icon: FolderOpen,
      show: true,
    },
    { href: "/analytics", label: tn("analytics"), icon: BarChart3, show: true },
    { href: "/resume-review", label: tn("resume_ai"), icon: Bot, show: true },
    ...(user.isAdmin
      ? [
          {
            href: "/settings",
            label: tn("settings"),
            icon: Settings,
            show: true,
          },
        ]
      : []),
  ];

  const activeLinks = navLinks.filter((l) => l.show);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-white/8 dark:bg-[#08090a]/80">
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
              <div className="hidden truncate text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 sm:block">
                {tapp("eyebrow")}
              </div>
            </div>
          </Link>

          <nav className="hidden shrink-0 items-center gap-1 rounded-2xl border border-slate-200/80 bg-slate-100/80 p-1 dark:border-white/8 dark:bg-white/[0.035] lg:flex">
            {activeLinks.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  title={link.label}
                  aria-label={link.label}
                  className={`flex min-h-9 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition ${
                    active
                      ? "bg-white text-slate-950 shadow-sm dark:bg-white/8 dark:text-white"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="hidden xl:inline">{link.label}</span>
                </Link>
              );
            })}
          </nav>

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
            <button
              ref={mobileMenuTriggerRef}
              onClick={() => setMobileMenuPath(pathname)}
              className="nexus-target nexus-focus-ring flex items-center justify-center rounded-xl border border-slate-200 bg-white/70 text-slate-600 transition hover:bg-slate-50 dark:border-white/8 dark:bg-white/4 dark:text-slate-300"
              aria-label={tn("menu")}
              aria-haspopup="dialog"
              aria-expanded={mobileMenuOpen}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <MobileNavigationSheet
        open={mobileMenuOpen}
        isAdmin={user.isAdmin}
        onClose={closeMobileMenu}
      />
    </header>
  );
}
