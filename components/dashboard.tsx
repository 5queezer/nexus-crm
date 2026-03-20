"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApplicationTable } from "./application-table";
import { ApplicationModal } from "./application-modal";
import { KanbanView } from "./kanban-view";
import { AppHeader } from "./app-header";
import { loadAppSettings } from "./app-settings";
import { Application, ApplicationStatus } from "@/types";
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
  initialStatus?: string;
  initialSource?: string;
  initialSearch?: string;
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

export function Dashboard({ user, shareUrl, initialStatus, initialSource, initialSearch }: DashboardProps) {
  const queryClient = useQueryClient();
  const t = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const ts = useTranslations("stats");
  const ta = useTranslations("actions");
  const tc = useTranslations("confirm");

  const [customTitle] = useState(() => {
    if (typeof window === "undefined") return "";
    return loadAppSettings().appTitle || "";
  });

  useEffect(() => {
    if (customTitle) {
      document.title = customTitle;
    }
  }, [customTitle]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [showArchived, setShowArchived] = useState(false);
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

  const bulkArchiveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => archiveApplication(id, true)));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  // Filter by archive status
  const activeApplications = applications.filter((a) => !a.archivedAt);
  const archivedApplications = applications.filter((a) => !!a.archivedAt);
  const visibleApplications = showArchived ? archivedApplications : activeApplications;

  function handleBulkArchive(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const old = activeApplications.filter((a) => {
      const d = a.appliedAt ? new Date(a.appliedAt) : new Date(a.createdAt);
      return d < cutoff;
    });
    if (old.length === 0) return;
    if (confirm(ta("archive_old_confirm", { count: old.length, days }))) {
      bulkArchiveMutation.mutate(old.map((a) => a.id));
    }
  }

  function handleBulkArchiveByRating(maxRating: number) {
    const lowRated = activeApplications.filter(
      (a) => a.rating !== null && a.rating !== undefined && a.rating <= maxRating
    );
    if (lowRated.length === 0) return;
    if (confirm(ta("archive_rating_confirm", { count: lowRated.length, stars: maxRating }))) {
      bulkArchiveMutation.mutate(lowRated.map((a) => a.id));
    }
  }

  const stats = {
    total: activeApplications.length,
    inbound: activeApplications.filter((a) => a.status === "inbound").length,
    active: activeApplications.filter((a) =>
      (["applied", "interview"] as ApplicationStatus[]).includes(a.status)
    ).length,
    offers: activeApplications.filter((a) => a.status === "offer").length,
    rejected: activeApplications.filter((a) => a.status === "rejected").length,
  };

  // Overdue follow-ups banner (only active pipeline statuses, non-archived)
  const [dismissedOverdue, setDismissedOverdue] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("dismissed-overdue");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const overdueFollowUps = activeApplications.filter((a) => {
    if (!a.followUpAt) return false;
    // Only show for active pipeline statuses
    if (a.status === "offer" || a.status === "rejected") return false;
    const d = new Date(a.followUpAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d >= today) return false;
    // Check if dismissed
    const key = `${a.id}:${a.followUpAt}`;
    return !dismissedOverdue.has(key);
  });

  function dismissOverdue(app: Application) {
    const key = `${app.id}:${app.followUpAt}`;
    setDismissedOverdue((prev) => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem("dismissed-overdue", JSON.stringify([...next]));
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      <AppHeader user={user} shareUrl={shareUrl} title={customTitle || undefined} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overdue follow-up banners */}
        {overdueFollowUps.length > 0 && (
          <div className="mb-6 space-y-2">
            {overdueFollowUps.map((app) => (
              <div
                key={app.id}
                className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-xl flex items-center gap-2 text-red-700 dark:text-red-400 text-sm"
              >
                <span className="text-base">⚠</span>
                <button
                  onClick={() => handleEdit(app)}
                  className="flex-1 text-left hover:underline font-medium"
                >
                  Overdue follow-up: {app.company}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); dismissOverdue(app); }}
                  className="ml-auto shrink-0 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors text-red-500 dark:text-red-400"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
          <StatCard label={ts("total")} value={stats.total} color="blue" onClick={() => setViewMode("table")} />
          <StatCard label={ts("inbound")} value={stats.inbound} color="teal" onClick={() => setViewMode("table")} />
          <StatCard label={ts("active")} value={stats.active} color="yellow" onClick={() => setViewMode("table")} />
          <StatCard label={ts("offers")} value={stats.offers} color="green" onClick={() => setViewMode("table")} />
          <StatCard label={ts("rejected")} value={stats.rejected} color="red" onClick={() => setViewMode("table")} />
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

              {!showArchived && <ArchiveOldDropdown applications={activeApplications} onArchive={handleBulkArchive} onArchiveByRating={handleBulkArchiveByRating} isPending={bulkArchiveMutation.isPending} />}

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
            initialStatusFilter={initialStatus}
            initialSourceFilter={initialSource}
            initialGlobalFilter={initialSearch}
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

const ARCHIVE_THRESHOLDS = [30, 60, 90, 180] as const;
const RATING_THRESHOLDS = [1, 2, 3] as const;

function ArchiveOldDropdown({
  applications,
  onArchive,
  onArchiveByRating,
  isPending,
}: {
  applications: Application[];
  onArchive: (days: number) => void;
  onArchiveByRating: (maxRating: number) => void;
  isPending: boolean;
}) {
  const ta = useTranslations("actions");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const countForDays = useCallback(
    (days: number) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return applications.filter((a) => {
        const d = a.appliedAt ? new Date(a.appliedAt) : new Date(a.createdAt);
        return d < cutoff;
      }).length;
    },
    [applications]
  );

  const countForRating = useCallback(
    (maxRating: number) =>
      applications.filter((a) => a.rating !== null && a.rating !== undefined && a.rating <= maxRating).length,
    [applications]
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={ref} className="relative w-full sm:w-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:w-auto ${
          open
            ? "border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300"
            : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        } ${isPending ? "opacity-50 cursor-wait" : ""}`}
      >
        {isPending ? ta("archive_old_archiving") : ta("bulk_archive")}
        <span className="text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {ARCHIVE_THRESHOLDS.map((days) => {
            const count = countForDays(days);
            return (
              <button
                key={`age-${days}`}
                onClick={() => {
                  setOpen(false);
                  onArchive(days);
                }}
                disabled={count === 0}
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed first:rounded-t-lg"
              >
                <span className="text-gray-700 dark:text-gray-200">
                  {ta("archive_old_option", { days })}
                </span>
                {count > 0 && (
                  <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          <div className="border-t border-gray-200 dark:border-gray-600 px-4 py-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {ta("archive_by_rating")}
            </span>
          </div>
          {RATING_THRESHOLDS.map((stars) => {
            const count = countForRating(stars);
            return (
              <button
                key={`rating-${stars}`}
                onClick={() => {
                  setOpen(false);
                  onArchiveByRating(stars);
                }}
                disabled={count === 0}
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed last:rounded-b-lg"
              >
                <span className="text-gray-700 dark:text-gray-200">
                  {ta(stars === 1 ? "archive_rating_option_one" : "archive_rating_option", { stars })}
                </span>
                {count > 0 && (
                  <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: number;
  color: "blue" | "teal" | "yellow" | "green" | "gray" | "red";
  onClick?: () => void;
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    teal: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
    yellow: "bg-yellow-50 text-yellow-700 dark:bg-amber-500/15 dark:text-amber-300",
    green: "bg-green-50 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    gray: "bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-200",
    red: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300",
  };

  const className = `${colors[color]} rounded-xl p-4 text-center${onClick ? " cursor-pointer hover:opacity-80 transition-opacity" : ""}`;

  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm font-medium mt-1">{label}</div>
    </button>
  ) : (
    <div className={className}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm font-medium mt-1">{label}</div>
    </div>
  );
}
