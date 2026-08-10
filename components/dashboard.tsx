"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
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
import { AiOperator } from "./ai-operator/ai-operator";
import { WorkspaceToolbar, type WorkspaceViewMode } from "./workspace-toolbar";
import { FocusQueue } from "./focus-queue";
import { OpportunityFilterControls } from "./opportunity-filter-controls";
import {
  EMPTY_OPPORTUNITY_FILTERS,
  filterOpportunities,
  hasOpportunityFilters,
  type OpportunityFilters,
} from "@/lib/applications/opportunity-filters";
import {
  Application,
  ApplicationStatus,
  STATUS_ORDER,
  getSourceCategory,
} from "@/types";
import { resolveOpportunityView } from "@/lib/applications/workspace-view";
import { parseLocalCalendarDate } from "@/lib/applications/local-calendar";
import { useApplicationStatusMutation } from "@/hooks/use-application-status-mutation";
import { applicationsToCsv } from "@/lib/applications/csv-export";
import { realApplications } from "@/lib/demo-workspace/presentation";

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

interface DemoWorkspaceStatus {
  hasDemoWorkspace: boolean;
  canCreateDemoWorkspace: boolean;
}

async function fetchDemoWorkspaceStatus(): Promise<DemoWorkspaceStatus> {
  const res = await fetch("/api/demo-workspace");
  if (!res.ok) throw new Error("Failed to fetch demo workspace status");
  return res.json();
}

async function createDemoWorkspace(): Promise<void> {
  const res = await fetch("/api/demo-workspace", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create demo workspace");
}

async function deleteDemoWorkspace(): Promise<void> {
  const res = await fetch("/api/demo-workspace", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete demo workspace");
}

async function deleteApplication(id: string): Promise<void> {
  const res = await fetch(`/api/applications/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete application");
}

async function archiveApplication(id: string, archive: boolean): Promise<void> {
  const res = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      archivedAt: archive ? new Date().toISOString() : null,
    }),
  });
  if (!res.ok) throw new Error("Failed to archive application");
}

function exportToCsv(
  applications: Application[],
  filename = "applications.csv",
) {
  const csv = applicationsToCsv(applications);

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function subscribeCompactViewport(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(max-width: 1023px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getCompactViewport(): boolean | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 1023px)").matches
    : false;
}

function getServerCompactViewport(): boolean | null {
  return null;
}

export function Dashboard({
  user,
  shareUrl,
  initialStatus,
  initialSource,
  initialSearch,
}: DashboardProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations("dashboard");
  const tn = useTranslations("nav");
  const ts = useTranslations("stats");
  const ta = useTranslations("actions");
  const tc = useTranslations("confirm");
  const tw = useTranslations("workspace");
  const tf = useTranslations("focus");

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
  const modalOpenerRef = useRef<HTMLElement | null>(null);
  const compactViewport = useSyncExternalStore(
    subscribeCompactViewport,
    getCompactViewport,
    getServerCompactViewport,
  );
  const [viewMode, setViewMode] = useState<WorkspaceViewMode | null>(null);
  const [filters, setFilters] = useState<OpportunityFilters>(() => ({
    ...EMPTY_OPPORTUNITY_FILTERS,
    search: initialSearch ?? "",
    status: STATUS_ORDER.includes(initialStatus as ApplicationStatus)
      ? (initialStatus as ApplicationStatus)
      : "",
    source: initialSource ? getSourceCategory(initialSource) : "",
  }));
  const [showArchived, setShowArchived] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("onboarding-complete") === "true";
  });
  const statusMutation = useApplicationStatusMutation({
    onRollback: () => setStatusAnnouncement(tf("status_rollback")),
  });
  const {
    data: applications = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["applications"],
    queryFn: fetchApplications,
  });
  const { data: demoWorkspaceStatus } = useQuery({
    queryKey: ["demo-workspace-status"],
    queryFn: fetchDemoWorkspaceStatus,
  });

  const refreshDemoQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["applications"] }),
      queryClient.invalidateQueries({ queryKey: ["activity"] }),
      queryClient.invalidateQueries({ queryKey: ["demo-workspace-status"] }),
    ]);
  }, [queryClient]);

  const createDemoMutation = useMutation({
    mutationFn: createDemoWorkspace,
    onSuccess: refreshDemoQueries,
  });

  const deleteDemoMutation = useMutation({
    mutationFn: deleteDemoWorkspace,
    onSuccess: async () => {
      const demoIds = new Set(
        applications.filter((application) => application.isDemo).map(({ id }) => id),
      );
      setSelectedIds((previous) =>
        new Set([...previous].filter((id) => !demoIds.has(id))),
      );
      await refreshDemoQueries();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteApplication,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["demo-workspace-status"] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      archiveApplication(id, archive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const handleEdit = useCallback(
    (app: Application) => {
      router.push(`/applications/${app.id}`);
    },
    [router],
  );

  function handleDelete(id: string) {
    if (applications.find((application) => application.id === id)?.isDemo) return;
    if (confirm(tc("delete"))) {
      removeFromSelection(id);
      deleteMutation.mutate(id);
    }
  }

  function handleNewApplication() {
    modalOpenerRef.current = document.activeElement as HTMLElement | null;
    setIsModalOpen(true);
  }

  function handleRemoveDemoWorkspace() {
    if (confirm(tc("remove_demo"))) {
      deleteDemoMutation.mutate();
    }
  }

  function handleCloseModal() {
    setIsModalOpen(false);
    requestAnimationFrame(() => {
      const opener = modalOpenerRef.current;
      if (opener?.isConnected) {
        opener.focus();
        return;
      }
      document
        .querySelector<HTMLElement>(
          `[data-dashboard-create-control="${compactViewport ? "mobile" : "desktop"}"]`,
        )
        ?.focus();
    });
  }

  function handleArchive(id: string, archive: boolean) {
    if (applications.some((application) => application.id === id && application.isDemo)) return;
    removeFromSelection(id);
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
  const activeApplications = useMemo(
    () => applications.filter((application) => !application.archivedAt),
    [applications],
  );
  const archivedApplications = useMemo(
    () => applications.filter((application) => !!application.archivedAt),
    [applications],
  );
  const realActiveApplications = useMemo(
    () => realApplications(activeApplications),
    [activeApplications],
  );
  const visibleApplications = showArchived
    ? archivedApplications
    : activeApplications;
  const visibleApplicationIds = useMemo(
    () => new Set(visibleApplications.map((application) => application.id)),
    [visibleApplications],
  );
  const scopedSelectedIds = useMemo(
    () =>
      new Set(
        [...selectedIds].filter((selectedId) =>
          visibleApplicationIds.has(selectedId),
        ),
      ),
    [selectedIds, visibleApplicationIds],
  );
  const resolvedView = resolveOpportunityView(
    viewMode,
    compactViewport,
    showArchived,
  );
  const filteredApplications = useMemo(
    () => filterOpportunities(visibleApplications, filters),
    [visibleApplications, filters],
  );
  const filteredApplicationIds = useMemo(
    () => new Set(filteredApplications.map((application) => application.id)),
    [filteredApplications],
  );
  const hiddenSelectedCount = useMemo(
    () =>
      [...scopedSelectedIds].filter(
        (selectedId) => !filteredApplicationIds.has(selectedId),
      ).length,
    [scopedSelectedIds, filteredApplicationIds],
  );
  const filtersActive = hasOpportunityFilters(filters);
  const isTrueEmpty = !isLoading && visibleApplications.length === 0;
  const isFilteredEmpty =
    !isLoading &&
    filtersActive &&
    visibleApplications.length > 0 &&
    filteredApplications.length === 0;
  const sources = useMemo(
    () =>
      Array.from(
        new Set(
          visibleApplications
            .filter((application) => Boolean(application.source))
            .map((application) => getSourceCategory(application.source)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [visibleApplications],
  );

  function clearFilters() {
    setFilters(EMPTY_OPPORTUNITY_FILTERS);
  }

  function handleBulkArchive(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const old = realActiveApplications.filter((a) => {
      const d = a.appliedAt ? new Date(a.appliedAt) : new Date(a.createdAt);
      return d < cutoff;
    });
    if (old.length === 0) return;
    if (confirm(ta("archive_old_confirm", { count: old.length, days }))) {
      const ids = old.map((application) => application.id);
      removeFromSelection(...ids);
      bulkArchiveMutation.mutate(ids);
    }
  }

  function handleBulkArchiveByRating(maxRating: number) {
    const lowRated = realActiveApplications.filter(
      (a) =>
        a.rating !== null && a.rating !== undefined && a.rating <= maxRating,
    );
    if (lowRated.length === 0) return;
    if (
      confirm(
        ta("archive_rating_confirm", {
          count: lowRated.length,
          stars: maxRating,
        }),
      )
    ) {
      const ids = lowRated.map((application) => application.id);
      removeFromSelection(...ids);
      bulkArchiveMutation.mutate(ids);
    }
  }

  const stats = {
    total: realActiveApplications.length,
    inbound: realActiveApplications.filter((a) => a.status === "inbound").length,
    active: realActiveApplications.filter((a) =>
      (["applied", "interview"] as ApplicationStatus[]).includes(a.status),
    ).length,
    offers: realActiveApplications.filter((a) => a.status === "offer").length,
    rejected: realActiveApplications.filter((a) => a.status === "rejected").length,
  };

  // Triage stats — single pass over activeApplications
  const triageStats = useMemo(() => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const counts = { thisWeek: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, unrated: 0 };
    for (const a of realActiveApplications) {
      if (new Date(a.createdAt) >= oneWeekAgo) counts.thisWeek++;
      const q = a.triageQuality;
      if (q != null && q >= 1 && q <= 5) counts[q as 1 | 2 | 3 | 4 | 5]++;
      else counts.unrated++;
    }
    return { ...counts, highPriority: counts[5] + counts[4] };
  }, [realActiveApplications]);

  function navigateToDataset(archived: boolean) {
    if (archived === showArchived) return;
    clearSelection();
    setShowArchived(archived);
  }

  const workspaceActions: ActionMenuItem[] = [
    {
      id: "toggle-archive",
      label: showArchived ? ta("show_active") : ta("show_archive"),
      hint:
        !showArchived && archivedApplications.length > 0
          ? archivedApplications.length
          : undefined,
      onSelect: () => navigateToDataset(!showArchived),
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
      const count = realActiveApplications.filter((application) => {
        const date = application.appliedAt
          ? new Date(application.appliedAt)
          : new Date(application.createdAt);
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
      const count = realActiveApplications.filter(
        (application) =>
          application.rating != null && application.rating <= stars,
      ).length;
      workspaceActions.push({
        id: `archive-rating-${stars}`,
        label: ta(
          stars === 1 ? "archive_rating_option_one" : "archive_rating_option",
          { stars },
        ),
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

  const overdueFollowUps = realActiveApplications.filter((a) => {
    if (!a.followUpAt) return false;
    // Only show for active pipeline statuses
    if (a.status === "offer" || a.status === "rejected") return false;
    const followUp = parseLocalCalendarDate(a.followUpAt);
    if (!followUp) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (followUp >= today) return false;
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
  const reconcileSelection = useCallback(
    (selection: Set<string>) =>
      new Set(
        [...selection].filter((selectedId) =>
          visibleApplicationIds.has(selectedId),
        ),
      ),
    [visibleApplicationIds],
  );

  const toggleSelect = useCallback(
    (id: string) => {
      if (!visibleApplicationIds.has(id)) return;
      setSelectedIds((previous) => {
        const next = reconcileSelection(previous);
        if (next.has(id)) next.delete(id);
        else if (next.size < 100) next.add(id);
        return next;
      });
    },
    [reconcileSelection, visibleApplicationIds],
  );

  function selectAll(apps: Application[]) {
    setSelectedIds((previous) => {
      const next = reconcileSelection(previous);
      for (const app of apps) {
        if (!visibleApplicationIds.has(app.id) || next.has(app.id)) continue;
        if (next.size >= 100) break;
        next.add(app.id);
      }
      return next;
    });
  }

  function deselectAll(apps: Application[]) {
    setSelectedIds((previous) => {
      const next = reconcileSelection(previous);
      for (const app of apps) next.delete(app.id);
      return next;
    });
  }

  function removeFromSelection(...ids: string[]) {
    setSelectedIds((previous) => {
      const next = reconcileSelection(previous);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Bulk action mutations
  const bulkStatusMutation = useMutation({
    mutationFn: async ({
      ids,
      status,
    }: {
      ids: string[];
      status: ApplicationStatus;
    }) => {
      const results = await Promise.allSettled(
        ids.map((id) => statusMutation.mutateAsync({ id, status })),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;
    },
    onSettled: clearSelection,
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteApplication(id)));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["demo-workspace-status"] });
      clearSelection();
    },
  });

  function handleBulkChangeStatus(status: ApplicationStatus) {
    const ids = [...scopedSelectedIds];
    if (ids.length === 0) return;
    bulkStatusMutation.mutate({ ids, status });
  }

  function handleBulkArchiveSelected() {
    const demoIds = new Set(
      applications.filter((application) => application.isDemo).map((application) => application.id),
    );
    const ids = [...scopedSelectedIds].filter((id) => !demoIds.has(id));
    if (ids.length === 0) return;
    if (confirm(tc("bulk_archive_confirm", { count: ids.length }))) {
      bulkArchiveMutation.mutate(ids);
      clearSelection();
    }
  }

  function handleBulkDeleteSelected() {
    const ids = [...scopedSelectedIds].filter(
      (id) => !applications.find((application) => application.id === id)?.isDemo,
    );
    if (ids.length === 0) return;
    if (confirm(tc("bulk_delete_confirm", { count: ids.length }))) {
      clearSelection();
      bulkDeleteMutation.mutate(ids);
    }
  }

  // Global keyboard shortcuts
  useEffect(() => {
    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        (el as HTMLElement).isContentEditable
      );
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (document.querySelector('[aria-modal="true"]')) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // Skip shortcuts when in input fields or modals are open
      if (
        isInputFocused() ||
        isModalOpen ||
        isCommandPaletteOpen ||
        isShortcutDialogOpen
      )
        return;

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
        case "f":
          if (!showArchived) {
            e.preventDefault();
            setViewMode("focus");
          }
          break;
        case "j":
        case "ArrowDown":
          if (resolvedView === "table") {
            e.preventDefault();
            setFocusedIndex((i) =>
              Math.min(i + 1, filteredApplications.length - 1),
            );
          }
          break;
        case "k":
        case "ArrowUp":
          if (resolvedView === "table") {
            e.preventDefault();
            setFocusedIndex((i) => Math.max(0, i - 1));
          }
          break;
        case "Enter":
          if (
            resolvedView === "table" &&
            focusedIndex >= 0 &&
            focusedIndex < filteredApplications.length
          ) {
            e.preventDefault();
            handleEdit(filteredApplications[focusedIndex]);
          }
          break;
        case "e":
          if (
            resolvedView === "table" &&
            focusedIndex >= 0 &&
            focusedIndex < filteredApplications.length
          ) {
            e.preventDefault();
            handleEdit(filteredApplications[focusedIndex]);
          }
          break;
        case "x":
          if (
            resolvedView === "table" &&
            focusedIndex >= 0 &&
            focusedIndex < filteredApplications.length
          ) {
            e.preventDefault();
            toggleSelect(filteredApplications[focusedIndex].id);
          }
          break;
        case "Escape":
          if (scopedSelectedIds.size > 0) {
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
  }, [
    isModalOpen,
    isCommandPaletteOpen,
    isShortcutDialogOpen,
    resolvedView,
    focusedIndex,
    filteredApplications,
    showArchived,
    scopedSelectedIds,
    toggleSelect,
    handleEdit,
  ]);

  if (isLoading) {
    return (
      <div className="nexus-shell">
        <AppHeader
          user={user}
          shareUrl={shareUrl}
          title={customTitle || undefined}
        />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <DashboardLoadingState message={t("loading")} />
        </main>
        <AiOperator key="ai-operator" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="nexus-shell">
        <AppHeader
          user={user}
          shareUrl={shareUrl}
          title={customTitle || undefined}
        />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <DashboardErrorState
            message={t("loading_error")}
            retryLabel={t("retry")}
            onRetry={() => void refetch()}
          />
        </main>
        <AiOperator key="ai-operator" />
      </div>
    );
  }

  // Onboarding is only eligible after the initial request succeeds.
  const showOnboarding =
    !onboardingComplete &&
    applications.length === 0 &&
    demoWorkspaceStatus?.canCreateDemoWorkspace === true;

  return (
    <div className="nexus-shell">
      <AppHeader
        user={user}
        shareUrl={shareUrl}
        title={customTitle || undefined}
      />
      <p className="sr-only" aria-live="polite">
        {statusAnnouncement}
      </p>

      {showOnboarding ? (
        <OnboardingWizard
          onCreateDemo={() => createDemoMutation.mutateAsync()}
          onComplete={() => {
            setOnboardingComplete(true);
            queryClient.invalidateQueries({ queryKey: ["applications"] });
          }}
        />
      ) : (
        <>
      <main className="nexus-page-bottom-space mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        {demoWorkspaceStatus?.hasDemoWorkspace === true && (
          <section
            role="status"
            aria-label={t("demo_banner_title")}
            className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
          >
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{t("demo_banner_title")}</h2>
              <p className="mt-1 text-xs opacity-80">{t("demo_banner_description")}</p>
            </div>
            <button
              type="button"
              onClick={handleRemoveDemoWorkspace}
              disabled={deleteDemoMutation.isPending}
              className="nexus-button-ghost nexus-target disabled:cursor-wait disabled:opacity-60"
            >
              {deleteDemoMutation.isPending ? t("removing_demo") : t("remove_demo")}
            </button>
          </section>
        )}
        {deleteDemoMutation.isError && (
          <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-300">
            {t("demo_remove_error")}
          </p>
        )}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissOverdue(app);
                  }}
                  className="nexus-target ml-auto inline-flex shrink-0 items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors text-red-500 dark:text-red-400"
                  aria-label={tf("dismiss_overdue", { company: app.company })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Decision-oriented overview */}
        {!isTrueEmpty && !showArchived && (
          <section className="mb-5 rounded-2xl bg-white/80 px-4 py-3 shadow-sm ring-1 ring-slate-200/80 backdrop-blur-xl dark:bg-white/[0.035] dark:ring-white/8 sm:mb-6 sm:px-5 sm:py-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
              <StatItem
                label={ts("total")}
                value={stats.total}
                className="text-blue-600 dark:text-blue-300"
              />
              <StatItem
                label={ts("active")}
                value={stats.active}
                className="text-amber-600 dark:text-amber-300"
              />
              <StatItem
                label={ts("new_this_week")}
                value={triageStats.thisWeek}
                className="text-slate-900 dark:text-white"
              />
              <StatItem
                label={ts("high_priority")}
                value={triageStats.highPriority}
                className="text-emerald-600 dark:text-emerald-300"
              />
            </div>
          </section>
        )}

        {isTrueEmpty && (archivedApplications.length > 0 || showArchived) && (
          <div className="mb-5 flex items-center justify-between gap-3">
            <h1 className="text-xl font-semibold">
              {showArchived ? ta("archive") : t("applications")}
            </h1>
            <ActionMenu
              label={ta("more_actions")}
              buttonText={ta("more")}
              items={workspaceActions}
            />
          </div>
        )}

        {!isTrueEmpty && (
          <WorkspaceToolbar
            title={showArchived ? ta("archive") : t("applications")}
            count={visibleApplications.length}
            viewMode={resolvedView}
            onViewModeChange={setViewMode}
            moreMenu={
              <ActionMenu
                label={ta("more_actions")}
                buttonText={ta("more")}
                items={workspaceActions}
              />
            }
            onCreate={handleNewApplication}
            createLabel={ta("new_application")}
            focusLabel={tw("focus")}
            tableLabel={tn("table_view")}
            kanbanLabel={tn("kanban_view")}
            listLabel={tw("list")}
            stagesLabel={tw("stages")}
            showFocus={!showArchived}
          />
        )}

        {!isTrueEmpty && (
          <OpportunityFilterControls
            filters={filters}
            sources={sources}
            resultCount={filteredApplications.length}
            onChange={setFilters}
            onClear={clearFilters}
          />
        )}

        {/* Content */}
        {compactViewport === null ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : isTrueEmpty && showArchived ? (
          <div className="nexus-panel mx-auto max-w-xl px-6 py-14 text-center">
            <h2 className="text-xl font-semibold">
              {tw("archive_empty_title")}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {tw("archive_empty_description")}
            </p>
            <button
              type="button"
              onClick={() => navigateToDataset(false)}
              className="nexus-button-ghost nexus-target mt-6"
            >
              {ta("show_active")}
            </button>
          </div>
        ) : isTrueEmpty ? (
          <FocusQueue
            applications={[]}
            isTrueEmpty
            isFilteredEmpty={false}
            selectedIds={scopedSelectedIds}
            onToggleSelect={toggleSelect}
            onOpen={handleEdit}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onArchive={handleArchive}
            onCreate={handleNewApplication}
            onCreateDemo={demoWorkspaceStatus?.canCreateDemoWorkspace
              ? () => createDemoMutation.mutate()
              : undefined}
            demoCreationPending={createDemoMutation.isPending}
            demoCreationError={createDemoMutation.isError ? t("demo_create_error") : undefined}
            onClearFilters={clearFilters}
            statusMutation={statusMutation}
          />
        ) : resolvedView === "focus" ? (
          <FocusQueue
            applications={filteredApplications}
            isTrueEmpty={false}
            isFilteredEmpty={isFilteredEmpty}
            selectedIds={scopedSelectedIds}
            onToggleSelect={toggleSelect}
            onOpen={handleEdit}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onArchive={handleArchive}
            onCreate={handleNewApplication}
            onClearFilters={clearFilters}
            statusMutation={statusMutation}
          />
        ) : resolvedView === "table" ? (
          <ApplicationTable
            applications={filteredApplications}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onArchive={handleArchive}
            showArchived={showArchived}
            hideFilters
            selectedIds={scopedSelectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            focusedIndex={focusedIndex}
            statusMutation={statusMutation}
          />
        ) : (
          <KanbanView
            applications={filteredApplications}
            onEdit={handleEdit}
            statusMutation={statusMutation}
          />
        )}
      </main>

      {!showArchived &&
        !isTrueEmpty &&
        scopedSelectedIds.size === 0 &&
        !isModalOpen &&
        !isCommandPaletteOpen &&
        !isShortcutDialogOpen && (
          <button
            type="button"
            onClick={handleNewApplication}
            data-dashboard-create-control="mobile"
            className="nexus-fab nexus-fixed-bottom fixed right-4 z-40 lg:hidden"
          >
            <span aria-hidden="true">+</span>
            {ta("new_application")}
          </button>
        )}

      {/* Modal */}
      {isModalOpen && (
        <ApplicationModal
          onClose={handleCloseModal}
          onCreated={(app) => router.push(`/applications/${app.id}`)}
        />
      )}

      {/* Command Palette */}
      {isCommandPaletteOpen && (
        <CommandPalette
          applications={applications}
          onSelect={handleEdit}
          onFocusView={() => setViewMode("focus")}
          onClose={() => setIsCommandPaletteOpen(false)}
        />
      )}

      {/* Keyboard Shortcut Dialog */}
      {isShortcutDialogOpen && (
        <KeyboardShortcutDialog
          onClose={() => setIsShortcutDialogOpen(false)}
        />
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={scopedSelectedIds.size}
        hiddenSelectedCount={hiddenSelectedCount}
        onChangeStatus={handleBulkChangeStatus}
        onArchive={handleBulkArchiveSelected}
        onDelete={handleBulkDeleteSelected}
        onClear={clearSelection}
      />

      {/* Keyboard Shortcut Hint Bar */}
      {scopedSelectedIds.size === 0 && <KeyboardShortcutBar />}
        </>
      )}

      <AiOperator
        key="ai-operator"
        hideCompactLauncher={scopedSelectedIds.size > 0}
      />
    </div>
  );
}

const ARCHIVE_THRESHOLDS = [30, 60, 90, 180] as const;
const RATING_THRESHOLDS = [1, 2, 3] as const;

export function DashboardLoadingState({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="nexus-panel mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-14 text-center"
    >
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
      />
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
        {message}
      </p>
    </div>
  );
}

export function DashboardErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="nexus-panel mx-auto max-w-xl px-6 py-14 text-center"
    >
      <p className="text-sm font-medium text-red-600 dark:text-red-300">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="nexus-button-ghost nexus-target mt-5"
      >
        {retryLabel}
      </button>
    </div>
  );
}

function StatItem({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="min-w-18">
      <div className={`text-xl font-semibold leading-6 ${className ?? ""}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </div>
    </div>
  );
}
