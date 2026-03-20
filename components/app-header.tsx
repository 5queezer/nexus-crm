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
    { href: "/", label: tapp("title"), icon: null, show: pathname !== "/" },
    { href: "/documents", label: tn("documents"), icon: FolderOpen, show: true },
    { href: "/analytics", label: tn("analytics"), icon: BarChart3, show: true },
    { href: "/resume-review", label: tn("resume_ai"), icon: Bot, show: true },
    ...(user.isAdmin
      ? [{ href: "/settings", label: tn("settings"), icon: Settings, show: true }]
      : []),
  ];

  const activeLinks = navLinks.filter((l) => l.show && l.href !== pathname);

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-lg font-bold text-gray-900 dark:text-white sm:text-xl">
              {title || tapp("title")}
            </h1>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-3">
            <ThemeSwitcher />
            <LanguageSwitcher />
            {user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name || user.email}
                className="w-8 h-8 rounded-full"
              />
            )}
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {user.name || user.email}
            </span>
            {activeLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center min-h-[44px] px-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
            {shareUrl && (
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 min-h-[44px] px-2 text-sm text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                {tn("share")}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center min-h-[44px] px-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
            >
              {tn("logout")}
            </button>
          </div>

          {/* Mobile nav: language + avatar + hamburger */}
          <div className="flex shrink-0 md:hidden items-center gap-2">
            <LanguageSwitcher />
            {user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name || user.email}
                className="w-8 h-8 rounded-full"
              />
            )}
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex items-center justify-center w-11 h-11 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-100 dark:border-gray-700 px-4 py-2 flex flex-col gap-1 bg-white dark:bg-gray-800">
          <div className="py-2 text-sm text-gray-600 dark:text-gray-300 font-medium">
            {user.name || user.email}
          </div>
          {activeLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2 min-h-[44px] px-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {Icon && <Icon className="w-4 h-4" />}
                {link.label}
              </Link>
            );
          })}
          {shareUrl && (
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 min-h-[44px] px-2 text-sm text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              <ExternalLink className="w-4 h-4" />
              {tn("share")}
            </a>
          )}
          <button
            onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
            className="flex items-center gap-2 min-h-[44px] px-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors w-full text-left"
          >
            <LogOut className="w-4 h-4" />
            {tn("logout")}
          </button>
        </div>
      )}
    </header>
  );
}
