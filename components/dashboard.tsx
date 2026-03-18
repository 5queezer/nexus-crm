"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { ApplicationTable } from "./application-table";
import { ApplicationModal } from "./application-modal";
import { KanbanView } from "./kanban-view";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import { loadAppSettings } from "./app-settings";
import { Application, ApplicationStatus } from "@/types";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";

interface DashboardProps {
  user: {
    id: string;
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin: boolean;
  };
  shareUrl: string;
}

async function fetchApplications(): Promise<Application[]> {
  const res = await fetch("/api/applications");
  if (!res.ok) throw new Error("Failed to fetch applications");
  return res.json();
}

async function deleteApplication(id: string): Promise<void> {
  const res = await fetch(`/api/applications/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete application");
}

async function archiveApplication(id: string, archive: boolean): Promise<void> {
  const res = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archivedAt: archive ? new Date().toISOString() : null }),
  });
  if (!res.ok) throw new Error("Failed to archive application");
}

function exportToCsv(applications: Application[], filename = "applications.csv") {
  const headers = ["Company", "Role", "Status", "Source", "Applied", "Last Contact", "Follow-up", "Notes"];
  const rows = applications.map((a) => [
    a.company,
    a.role,
    a.status,
    a.source ?? "",
    a.appliedAt ? format(new Date(a.appliedAt), "yyyy-MM-dd") : "",
    a.lastContact ? format(new Date(a.lastContact), "yyyy-MM-dd") : "",
    a.followUpAt ? format(new Date(a.followUpAt), "yyyy-MM-dd") : "",
    a.notes?.replace(/\n/g, " ") ?? "",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type ViewMode = "table" | "kanban";

export function Dashboard({ user, shareUrl }: DashboardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const ts = useTranslations("stats");
  const ta = useTranslations("actions");
  const tc = useTranslations("confirm");
  const tapp = useTranslations("app");

  const [customTitle, setCustomTitle] = useState("");

  useEffect(() => {
    const settings = loadAppSettings();
    if (settings.appTitle) {
      setCustomTitle(settings.appTitle);
      document.title = settings.appTitle;
    }
  }, []);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [showArchived, setShowArchived] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: applications = [], isLoading, isError } = useQuery({
    queryKey: ["applications"],
    queryFn: fetchApplications,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteApplication,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      archiveApplication(id, archive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  async function handleLogout() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleEdit(app: Application) {
    setEditingApp(app);
    setIsModalOpen(true);
  }

  function handleDelete(id: string) {
    if (confirm(tc("delete"))) {
      deleteMutation.mutate(id);
    }
  }

  function handleNewApplication() {
    setEditingApp(null);
    setIsModalOpen(true);
  }

  function handleCloseModal() {
    setIsModalOpen(false);
    setEditingApp(null);
  }

  function handleArchive(id: string, archive: boolean) {
    archiveMutation.mutate({ id, archive });
  }

  // Filter by archive status
  const activeApplications = applications.filter((a) => !a.archivedAt);
  const archivedApplications = applications.filter((a) => !!a.archivedAt);
  const visibleApplications = showArchived ? archivedApplications : activeApplications;

  const stats = {
    total: activeApplications.length,
    active: activeApplications.filter((a) =>
      (["applied", "interview"] as ApplicationStatus[]).includes(a.status)
    ).length,
    offers: activeApplications.filter((a) => a.status === "offer").length,
    rejected: activeApplications.filter((a) => a.status === "rejected").length,
  };

  // Overdue follow-ups banner (only active, non-archived)
  const overdueFollowUps = activeApplications.filter((a) => {
    if (!a.followUpAt) return false;
    const d = new Date(a.followUpAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today;
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 text-2xl">📊</span>
              <h1 className="truncate text-lg font-bold text-gray-900 dark:text-white sm:text-xl">
                {customTitle || tapp("title")}
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
              <span className="text-sm text-gray-600 dark:text-gray-300">{user.name || user.email}</span>
              {user.isAdmin && (
                <Link
                  href="/settings"
                  className="flex items-center min-h-[44px] px-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
                >
                  🛡️ {tn("settings")}
                </Link>
              )}
              <Link
                href="/documents"
                className="flex items-center min-h-[44px] px-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                📁 {tn("documents")}
              </Link>
              <Link
                href="/analytics"
                className="flex items-center min-h-[44px] px-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                📊 {tn("analytics")}
              </Link>
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center min-h-[44px] px-2 text-sm text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                title="Client portal link"
              >
                🔗 Share
              </a>
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
                {mobileMenuOpen ? "✕" : "☰"}
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
            <Link
              href="/documents"
              className="flex items-center gap-2 min-h-[44px] px-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              📁 {tn("documents")}
            </Link>
            <Link
              href="/analytics"
              className="flex items-center gap-2 min-h-[44px] px-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              📊 {tn("analytics")}
            </Link>
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 min-h-[44px] px-2 text-sm text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              🔗 Share
            </a>
            <button
              onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
              className="flex items-center gap-2 min-h-[44px] px-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors w-full text-left"
            >
              {tn("logout")}
            </button>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overdue follow-up banner */}
        {overdueFollowUps.length > 0 && (
          <div className="mb-6 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-xl flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
            <span className="text-base">⚠</span>
            <span>
              {overdueFollowUps.length === 1
                ? `Overdue follow-up: ${overdueFollowUps[0].company}`
                : `${overdueFollowUps.length} overdue follow-ups`}
            </span>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard label={ts("total")} value={stats.total} color="blue" />
          <StatCard label={ts("active")} value={stats.active} color="yellow" />
          <StatCard label={ts("offers")} value={stats.offers} color="green" />
          <StatCard label={ts("rejected")} value={stats.rejected} color="gray" />
        </div>

        {/* Toolbar */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
              {showArchived ? ta("archive") : t("applications")} ({visibleApplications.length})
            </h2>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="inline-flex w-full items-center overflow-hidden rounded-lg border border-gray-200 text-sm dark:border-gray-600 sm:w-auto">
              <button
                onClick={() => setViewMode("table")}
                className={`flex-1 px-3 py-1.5 font-medium transition-colors whitespace-nowrap sm:flex-none ${
                  viewMode === "table"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {tn("table_view")}
              </button>
              <button
                onClick={() => setViewMode("kanban")}
                className={`flex-1 px-3 py-1.5 font-medium transition-colors whitespace-nowrap sm:flex-none ${
                  viewMode === "kanban"
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {tn("kanban_view")}
              </button>
            </div>

            <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
              <button
                onClick={() => setShowArchived((v) => !v)}
                className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:w-auto ${
                  showArchived
                    ? "border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300"
                    : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {showArchived ? ta("show_active") : ta("show_archive")}
                {archivedApplications.length > 0 && !showArchived && (
                  <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gray-200 px-1 text-xs font-bold text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                    {archivedApplications.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => exportToCsv(visibleApplications)}
                title={ta("export_csv")}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 sm:w-auto"
              >
                <span>↓</span>
                {ta("export_csv")}
              </button>

              <button
                onClick={handleNewApplication}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
              >
                <span>+</span>
                {ta("new_application")}
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="text-center py-20 text-red-500">{t("loading_error")}</div>
        ) : viewMode === "table" ? (
          <ApplicationTable
            applications={visibleApplications}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onArchive={handleArchive}
            showArchived={showArchived}
          />
        ) : (
          <KanbanView applications={visibleApplications} onEdit={handleEdit} />
        )}
      </main>

      {/* Modal */}
      {isModalOpen && (
        <ApplicationModal application={editingApp} onClose={handleCloseModal} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "yellow" | "green" | "gray";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    yellow: "bg-yellow-50 text-yellow-700 dark:bg-amber-500/15 dark:text-amber-300",
    green: "bg-green-50 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    gray: "bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-200",
  };

  return (
    <div className={`${colors[color]} rounded-xl p-4 text-center`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm font-medium mt-1">{label}</div>
    </div>
  );
}
