"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { ActionMenu, ActionMenuItem } from "./action-menu";
import { WorkspaceToolbar } from "./workspace-toolbar";
import { AiOperator } from "./ai-operator/ai-operator";
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

  const workspaceActions: ActionMenuItem[] = [
    {
      id: "toggle-archive",
      label: showArchived ? ta("show_active") : ta("show_archive"),
      hint: !showArchived && archivedApplications.length > 0 ? archivedApplications.length : undefined,
      onSelect: () => setShowArchived((value) => !value),
    },
    {
      id: "export",
      label: ta("export_csv"),
      onSelect: () => exportToCsv(visibleApplications),
    },
  ];

  if (!showArchived) {
    for (const days of ARCHIVE_THRESHOLDS) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const count = activeApplications.filter((application) => {
        const date = application.appliedAt ? new Date(application.appliedAt) : new Date(application.createdAt);
        return date < cutoff;
      }).length;
      workspaceActions.push({
        id: `archive-age-${days}`,
        label: ta("archive_old_option", { days }),
        hint: count || undefined,
        disabled: count === 0 || bulkArchiveMutation.isPending,
        separatorBefore: days === ARCHIVE_THRESHOLDS[0],
        onSelect: () => handleBulkArchive(days),
      });
    }
    for (const stars of RATING_THRESHOLDS) {
      const count = activeApplications.filter(
        (application) => application.rating != null && application.rating <= stars,
      ).length;
      workspaceActions.push({
        id: `archive-rating-${stars}`,
        label: ta(stars === 1 ? "archive_rating_option_one" : "archive_rating_option", { stars }),
        hint: count || undefined,
        disabled: count === 0 || bulkArchiveMutation.isPending,
        separatorBefore: stars === RATING_THRESHOLDS[0],
        onSelect: () => handleBulkArchiveByRating(stars),
      });
    }
  }

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
      <div className="nexus-shell">
        <AppHeader user={user} shareUrl={shareUrl} title={customTitle || undefined} />
        <OnboardingWizard onComplete={() => {
          setOnboardingComplete(true);
          queryClient.invalidateQueries({ queryKey: ["applications"] });
        }} />
        <AiOperator />
      </div>
    );
  }

  return (
    <div className="nexus-shell">
      <AppHeader user={user} shareUrl={shareUrl} title={customTitle || undefined} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Overdue follow-up banners */}
        {overdueFollowUps.length > 0 && (
          <div className="mb-6 space-y-2">
            {overdueFollowUps.map((app) => (
              <div
                key={app.id}
                className="flex items-center gap-3 rounded-2xl border border-red-200/80 bg-red-50/90 p-3 text-sm text-red-700 shadow-sm backdrop-blur dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
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

        {/* Decision-oriented overview */}
        <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-4 shadow-sm backdrop-blur-xl dark:border-white/8 dark:bg-white/[0.035] sm:px-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
            <StatItem label={ts("total")} value={stats.total} className="text-blue-600 dark:text-blue-300" />
            <StatItem label={ts("active")} value={stats.active} className="text-amber-600 dark:text-amber-300" />
            <StatItem label={ts("new_this_week")} value={triageStats.thisWeek} className="text-slate-900 dark:text-white" />
            <StatItem label={ts("high_priority")} value={triageStats.highPriority} className="text-emerald-600 dark:text-emerald-300" />
          </div>
        </section>

        <WorkspaceToolbar
          title={showArchived ? ta("archive") : t("applications")}
          count={visibleApplications.length}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          moreMenu={<ActionMenu label={ta("more_actions")} buttonText={ta("more")} items={workspaceActions} />}
          onCreate={handleNewApplication}
          createLabel={ta("new_application")}
          tableLabel={tn("table_view")}
          kanbanLabel={tn("kanban_view")}
        />

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
      <AiOperator />
    </div>
  );
}

const ARCHIVE_THRESHOLDS = [30, 60, 90, 180] as const;
const RATING_THRESHOLDS = [1, 2, 3] as const;

function StatItem({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="min-w-18">
      <div className={`text-xl font-semibold leading-6 ${className ?? ""}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
