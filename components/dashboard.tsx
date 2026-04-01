"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApplicationTable } from "./application-table";
import { ApplicationModal } from "./application-modal";
import { KanbanView } from "./kanban-view";
import { AppHeader } from "./app-header";
import { loadAppSettings } from "./app-settings";
import { CommandPalette } from "./command-palette";
import { KeyboardShortcutBar } from "./keyboard-shortcut-bar";
import { KeyboardShortcutDialog } from "./keyboard-shortcut-dialog";
import { BulkActionBar } from "./bulk-action-bar";
import { OnboardingWizard } from "./onboarding-wizard";
import { Application, ApplicationStatus, STATUS_ORDER } from "@/types";
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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("onboarding-complete") === "true";
  });
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

  // Triage stats — single pass over activeApplications
  const triageStats = useMemo(() => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const counts = { thisWeek: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, unrated: 0 };
    for (const a of activeApplications) {
      if (new Date(a.createdAt) >= oneWeekAgo) counts.thisWeek++;
      const q = a.triageQuality;
      if (q != null && q >= 1 && q <= 5) counts[q as 1|2|3|4|5]++;
      else counts.unrated++;
    }
    return { ...counts, highPriority: counts[5] + counts[4] };
  }, [activeApplications]);

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

  // Selection helpers
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  }

  function selectAll(apps: Application[]) {
    setSelectedIds(new Set(apps.slice(0, 100).map((a) => a.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Bulk action mutations
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: ApplicationStatus }) => {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/applications/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          })
        )
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      clearSelection();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteApplication(id)));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      clearSelection();
    },
  });

  function handleBulkChangeStatus(status: ApplicationStatus) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    bulkStatusMutation.mutate({ ids, status });
  }

  function handleBulkArchiveSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (confirm(tc("bulk_archive_confirm", { count: ids.length }))) {
      bulkArchiveMutation.mutate(ids);
      clearSelection();
    }
  }

  function handleBulkDeleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (confirm(tc("bulk_delete_confirm", { count: ids.length }))) {
      bulkDeleteMutation.mutate(ids);
    }
  }

  // Global keyboard shortcuts
  useEffect(() => {
    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || (el as HTMLElement).isContentEditable;
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K / Ctrl+K always works
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // Skip shortcuts when in input fields or modals are open
      if (isInputFocused() || isModalOpen || isCommandPaletteOpen || isShortcutDialogOpen) return;

      switch (e.key) {
        case "/":
          e.preventDefault();
          setIsCommandPaletteOpen(true);
          break;
        case "?":
          e.preventDefault();
          setIsShortcutDialogOpen(true);
          break;
        case "n":
          e.preventDefault();
          handleNewApplication();
          break;
        case "t":
          e.preventDefault();
          setViewMode("table");
          break;
        case "b":
          e.preventDefault();
          setViewMode("kanban");
          break;
        case "j":
        case "ArrowDown":
          if (viewMode === "table") {
            e.preventDefault();
            setFocusedIndex((i) => Math.min(i + 1, visibleApplications.length - 1));
          }
          break;
        case "k":
        case "ArrowUp":
          if (viewMode === "table") {
            e.preventDefault();
            setFocusedIndex((i) => Math.max(0, i - 1));
          }
          break;
        case "Enter":
          if (viewMode === "table" && focusedIndex >= 0 && focusedIndex < visibleApplications.length) {
            e.preventDefault();
            handleEdit(visibleApplications[focusedIndex]);
          }
          break;
        case "e":
          if (viewMode === "table" && focusedIndex >= 0 && focusedIndex < visibleApplications.length) {
            e.preventDefault();
            handleEdit(visibleApplications[focusedIndex]);
          }
          break;
        case "x":
          if (viewMode === "table" && focusedIndex >= 0 && focusedIndex < visibleApplications.length) {
            e.preventDefault();
            toggleSelect(visibleApplications[focusedIndex].id);
          }
          break;
        case "Escape":
          if (selectedIds.size > 0) {
            e.preventDefault();
            clearSelection();
          }
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5": {
          e.preventDefault();
          const statusIdx = parseInt(e.key) - 1;
          if (statusIdx < STATUS_ORDER.length) {
            // This will be picked up by the URL - just navigate
            const status = STATUS_ORDER[statusIdx];
            window.history.replaceState(null, "", `/?status=${status}`);
            window.location.reload();
          }
          break;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen, isCommandPaletteOpen, isShortcutDialogOpen, viewMode, focusedIndex, visibleApplications, selectedIds]);

  // Show onboarding for new users
  if (!isLoading && !onboardingComplete && applications.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
        <AppHeader user={user} shareUrl={shareUrl} title={customTitle || undefined} />
        <OnboardingWizard onComplete={() => {
          setOnboardingComplete(true);
          queryClient.invalidateQueries({ queryKey: ["applications"] });
        }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      <AppHeader user={user} shareUrl={shareUrl} title={customTitle || undefined} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6 sm:gap-4 sm:mb-8">
          <StatCard label={ts("total")} value={stats.total} color="blue" onClick={() => setViewMode("table")} />
          <StatCard label={ts("inbound")} value={stats.inbound} color="teal" onClick={() => setViewMode("table")} />
          <StatCard label={ts("active")} value={stats.active} color="yellow" onClick={() => setViewMode("table")} />
          <StatCard label={ts("offers")} value={stats.offers} color="green" onClick={() => setViewMode("table")} />
          <div className="col-span-2 sm:col-span-1">
            <StatCard label={ts("rejected")} value={stats.rejected} color="red" onClick={() => setViewMode("table")} />
          </div>
        </div>

        {/* Triage Summary Widget */}
        {(triageStats[5] > 0 || triageStats[4] > 0 || triageStats.thisWeek > 0) && (
          <div className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t("triage_title")}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900/50 p-2">
                <div className="text-lg font-bold text-gray-900 dark:text-white">{triageStats.thisWeek}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{t("triage_this_week")}</div>
              </div>
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-2">
                <div className="text-lg font-bold text-green-700 dark:text-green-300">{triageStats[5]}</div>
                <div className="text-xs text-green-600 dark:text-green-400">5/5 {t("triage_perfect")}</div>
              </div>
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-2">
                <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{triageStats[4]}</div>
                <div className="text-xs text-blue-600 dark:text-blue-400">4/5 {t("triage_strong")}</div>
              </div>
              <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/30 p-2">
                <div className="text-lg font-bold text-yellow-700 dark:text-yellow-300">{triageStats[3]}</div>
                <div className="text-xs text-yellow-600 dark:text-yellow-400">3/5 {t("triage_consider")}</div>
              </div>
            </div>
            {triageStats.highPriority > 0 && (
              <p className="mt-3 text-sm text-green-700 dark:text-green-400 font-medium">
                {t("triage_action", { count: triageStats.highPriority })}
              </p>
            )}
          </div>
        )}

        {/* Toolbar */}
        <div className="mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
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
                className="col-span-2 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
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
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={() => selectAll(visibleApplications)}
            onClearSelection={clearSelection}
            focusedIndex={focusedIndex}
          />
        ) : (
          <KanbanView applications={visibleApplications} onEdit={handleEdit} />
        )}
      </main>

      {/* Modal */}
      {isModalOpen && (
        <ApplicationModal application={editingApp} onClose={handleCloseModal} />
      )}

      {/* Command Palette */}
      {isCommandPaletteOpen && (
        <CommandPalette
          applications={applications}
          onSelect={handleEdit}
          onClose={() => setIsCommandPaletteOpen(false)}
        />
      )}

      {/* Keyboard Shortcut Dialog */}
      {isShortcutDialogOpen && (
        <KeyboardShortcutDialog onClose={() => setIsShortcutDialogOpen(false)} />
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        onChangeStatus={handleBulkChangeStatus}
        onArchive={handleBulkArchiveSelected}
        onDelete={handleBulkDeleteSelected}
        onClear={clearSelection}
      />

      {/* Keyboard Shortcut Hint Bar */}
      {selectedIds.size === 0 && <KeyboardShortcutBar />}
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

  const className = `${colors[color]} rounded-xl p-4 text-center h-full${onClick ? " cursor-pointer hover:opacity-80 transition-opacity" : ""}`;

  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      <div className="text-2xl sm:text-3xl font-bold">{value}</div>
      <div className="text-sm font-medium mt-1">{label}</div>
    </button>
  ) : (
    <div className={className}>
      <div className="text-2xl sm:text-3xl font-bold">{value}</div>
      <div className="text-sm font-medium mt-1">{label}</div>
    </div>
  );
}
