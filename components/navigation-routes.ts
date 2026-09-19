import {
  Activity,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  FolderOpen,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavigationGroup = "workspace" | "tools" | "footer";

export interface NavigationRoute {
  href: string;
  /** Key inside the `nav` message namespace. */
  labelKey: string;
  icon: LucideIcon;
  group: NavigationGroup;
  adminOnly?: boolean;
}

/**
 * Single source of truth for the primary navigation. The sidebar, the compact
 * top bar and the mobile sheet all render from this list so a new destination
 * only has to be added once.
 */
export const NAVIGATION_ROUTES: NavigationRoute[] = [
  { href: "/", labelKey: "opportunities", icon: BriefcaseBusiness, group: "workspace" },
  { href: "/activity", labelKey: "activity", icon: Activity, group: "workspace" },
  { href: "/documents", labelKey: "documents", icon: FolderOpen, group: "workspace" },
  { href: "/analytics", labelKey: "analytics", icon: BarChart3, group: "workspace" },
  { href: "/resume-review", labelKey: "resume_ai", icon: Bot, group: "tools" },
  { href: "/settings", labelKey: "settings", icon: Settings, group: "footer", adminOnly: true },
];

export function visibleRoutes(isAdmin?: boolean): NavigationRoute[] {
  return NAVIGATION_ROUTES.filter((route) => !route.adminOnly || isAdmin);
}

export function routesInGroup(group: NavigationGroup, isAdmin?: boolean): NavigationRoute[] {
  return visibleRoutes(isAdmin).filter((route) => route.group === group);
}

/**
 * Prefix match so `/applications/:id` still highlights Opportunities. The
 * pathname is typed as non-null by Next but can be absent when the hook is
 * rendered outside a router, so treat that as "nothing active".
 */
export function isRouteActive(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/" || pathname.startsWith("/applications");
  return pathname === href || pathname.startsWith(`${href}/`);
}
