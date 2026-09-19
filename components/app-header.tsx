"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { BriefcaseBusiness, ChevronRight, Menu } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { HeaderUtilityMenu } from "./header-utility-menu";
import { MobileNavigationSheet } from "./mobile-navigation-sheet";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface AppHeaderProps {
  user: {
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin?: boolean;
  };
  shareUrl?: string;
  title?: string;
  /** Trail shown on the desktop bar; the last entry is the current page. */
  breadcrumbs?: Breadcrumb[];
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

/**
 * Slim bar above the page content. On `lg` and up the workspace navigation
 * lives in the sidebar, so the bar only carries the breadcrumb trail and the
 * utility menu; below that it also carries the brand and the burger.
 */
export function AppHeader({
  user,
  shareUrl,
  title,
  breadcrumbs = [],
  onBeforeLogout,
}: AppHeaderProps) {
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

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-white/8 dark:bg-[#08090a]/80">
      <div className="flex min-h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 lg:hidden">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm dark:bg-[#5e6ad2]">
            <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-semibold tracking-[-0.02em] text-slate-950 dark:text-[#f7f8f8]">
            {title || tapp("title")}
          </span>
        </Link>

        {breadcrumbs.length > 0 && (
          <nav
            aria-label={tn("breadcrumb")}
            className="hidden min-w-0 items-center gap-2 text-sm text-slate-500 dark:text-slate-400 lg:flex"
          >
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
                  {index > 0 && (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  )}
                  {crumb.href && !last ? (
                    <Link
                      href={crumb.href}
                      className="nexus-focus-ring truncate rounded transition hover:text-slate-900 dark:hover:text-white"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={last ? "page" : undefined}
                      className={`truncate ${last ? "text-slate-900 dark:text-slate-100" : ""}`}
                    >
                      {crumb.label}
                    </span>
                  )}
                </span>
              );
            })}
          </nav>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <HeaderUtilityMenu
            user={user}
            shareUrl={shareUrl}
            onLogout={handleLogout}
          />
          <div className="lg:hidden">
            <MobileNavigationDisclosure key={pathname} isAdmin={user.isAdmin} />
          </div>
        </div>
      </div>
    </header>
  );
}
