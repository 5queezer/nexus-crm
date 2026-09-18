"use client";

import { AppSidebar } from "./app-sidebar";
import { AppHeader, type Breadcrumb } from "./app-header";

interface AppShellProps {
  user: {
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin?: boolean;
  };
  breadcrumbs?: Breadcrumb[];
  shareUrl?: string;
  title?: string;
  onBeforeLogout?: () => boolean;
  children: React.ReactNode;
}

/**
 * Application frame: persistent sidebar on `lg` and up, slim top bar with the
 * breadcrumb trail, and the page content in the remaining column.
 */
export function AppShell({
  user,
  breadcrumbs,
  shareUrl,
  title,
  onBeforeLogout,
  children,
}: AppShellProps) {
  return (
    <div className="nexus-shell flex min-h-dvh">
      <AppSidebar user={user} title={title} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          user={user}
          breadcrumbs={breadcrumbs}
          shareUrl={shareUrl}
          title={title}
          onBeforeLogout={onBeforeLogout}
        />
        {children}
      </div>
    </div>
  );
}
