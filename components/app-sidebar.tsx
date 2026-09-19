"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BriefcaseBusiness } from "lucide-react";
import { isRouteActive, routesInGroup, type NavigationRoute } from "./navigation-routes";

interface AppSidebarProps {
  user: {
    name?: string | null;
    email: string;
    isAdmin?: boolean;
  };
  /** Workspace title configured by an admin; falls back to the product name. */
  title?: string;
}

function SidebarLink({ route, active, label }: { route: NavigationRoute; active: boolean; label: string }) {
  const Icon = route.icon;
  return (
    <Link
      href={route.href}
      aria-current={active ? "page" : undefined}
      className={`nexus-focus-ring flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
        active
          ? "bg-slate-200/70 font-medium text-slate-950 dark:bg-white/8 dark:text-white"
          : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
      }`}
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${active ? "text-indigo-600 dark:text-[#a5a1ff]" : ""}`}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Two letters from the display name, or one from the email local part. */
export function initialsFor(name: string | null | undefined, email: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length > 0) {
    return parts
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("");
  }
  return email.trim()[0]?.toUpperCase() ?? "?";
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.09em] text-slate-400 dark:text-slate-500">
      {children}
    </div>
  );
}

/**
 * Persistent workspace navigation. Rendered from `lg` upwards only — below
 * that the compact top bar and its sheet take over.
 */
export function AppSidebar({ user, title }: AppSidebarProps) {
  const pathname = usePathname();
  const tn = useTranslations("nav");
  const tapp = useTranslations("app");

  const workspace = routesInGroup("workspace", user.isAdmin);
  const tools = routesInGroup("tools", user.isAdmin);
  const footer = routesInGroup("footer", user.isAdmin);
  const initials = initialsFor(user.name, user.email);

  return (
    <aside
      aria-label={tn("primary")}
      className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col gap-6 overflow-y-auto border-r border-slate-200/80 bg-slate-100/60 px-3 pb-4 pt-5 dark:border-white/8 dark:bg-white/[0.02] lg:flex xl:w-56"
    >
      <Link href="/" className="nexus-focus-ring flex items-center gap-2.5 rounded-lg px-2 py-1">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white dark:bg-[#5e6ad2]">
          <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="truncate text-sm font-semibold tracking-[-0.02em] text-slate-950 dark:text-[#f7f8f8]">
          {title || tapp("title")}
        </span>
      </Link>

      <nav className="flex flex-col gap-5">
        <div>
          <GroupLabel>{tn("group_workspace")}</GroupLabel>
          <div className="space-y-0.5">
            {workspace.map((route) => (
              <SidebarLink
                key={route.href}
                route={route}
                active={isRouteActive(route.href, pathname)}
                label={tn(route.labelKey)}
              />
            ))}
          </div>
        </div>
        {tools.length > 0 && (
          <div>
            <GroupLabel>{tn("group_tools")}</GroupLabel>
            <div className="space-y-0.5">
              {tools.map((route) => (
                <SidebarLink
                  key={route.href}
                  route={route}
                  active={isRouteActive(route.href, pathname)}
                  label={tn(route.labelKey)}
                />
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="mt-auto space-y-0.5">
        {footer.map((route) => (
          <SidebarLink
            key={route.href}
            route={route}
            active={isRouteActive(route.href, pathname)}
            label={tn(route.labelKey)}
          />
        ))}
        <div className="mt-3 flex items-center gap-2.5 border-t border-slate-200/80 px-1.5 pt-4 dark:border-white/8">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-medium text-slate-600 dark:bg-white/8 dark:text-slate-200"
          >
            {initials || "?"}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs text-slate-800 dark:text-slate-200">
              {user.name || user.email}
            </span>
            <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
              {tn("personal_workspace")}
            </span>
          </span>
        </div>
      </div>
    </aside>
  );
}
