"use client";

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Application, ApplicationStatus, Contact, STATUS_COLORS, STATUS_ROW_COLORS, STATUS_ORDER, TRIAGE_COLORS } from "@/types";
import { format, isPast, isToday } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";

const columnHelper = createColumnHelper<Application>();

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useTranslations("status");
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}
    >
      {t(status)}
    </span>
  );
}

function ContactPills({ contacts }: { contacts?: Contact[] }) {
  if (!contacts || contacts.length === 0) return <span className="text-gray-400 dark:text-gray-500">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {contacts.map((c) => (
        <span
          key={c.id}
          title={[c.role, c.email].filter(Boolean).join(" · ")}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400 whitespace-nowrap"
        >
          {c.name}
          {c.role && <span className="ml-1 text-indigo-500 dark:text-indigo-400 font-normal">· {c.role}</span>}
        </span>
      ))}
    </div>
  );
}

function FollowUpCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-400 dark:text-gray-500">—</span>;
  const d = new Date(date);
  const overdue = isPast(d) && !isToday(d);
  const due = isToday(d);
  return (
    <span
      className={`text-sm font-medium ${
        overdue ? "text-red-600 dark:text-red-400" : due ? "text-orange-500 dark:text-orange-400" : "text-gray-600 dark:text-gray-400"
      }`}
      title={overdue ? "Überfällig" : due ? "Heute fällig" : ""}
    >
      {overdue && "⚠ "}
      {due && "🔔 "}
      {format(d, "dd.MM.yyyy")}
    </span>
  );
}

interface MobileApplicationCardProps {
  app: Application;
  onEdit: (app: Application) => void;
  onDelete: (id: string) => void;
  onArchive?: (id: string, archive: boolean) => void;
  showArchived?: boolean;
}

function MobileApplicationCard({ app, onEdit, onDelete, onArchive, showArchived }: MobileApplicationCardProps) {
  const t = useTranslations("table");
  const ta = useTranslations("actions");
  const locale = useLocale();
  const dateFnsLocale = locale === "de" ? de : enUS;
  const [notesExpanded, setNotesExpanded] = useState(false);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd.MM.yyyy", { locale: dateFnsLocale });
    } catch {
      return "—";
    }
  }

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-gray-900 dark:text-white">
            <span className="truncate">{app.company || <span className="italic font-normal text-gray-400 dark:text-gray-500">—</span>}</span>
            {app.jobUrl && (
              <a
                href={app.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={app.jobUrl}
                className="shrink-0 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </h3>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{app.role}</p>
        </div>
        <div className="shrink-0 flex flex-wrap gap-1">
          <StatusBadge status={app.status} />
          {app.remote && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">Remote</span>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("applied_at")}</div>
          <div className="text-gray-700 dark:text-gray-300 break-words">{formatDate(app.appliedAt)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("follow_up")}</div>
          <div className="break-words"><FollowUpCell date={app.followUpAt} /></div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("last_contact")}</div>
          <div className="text-gray-700 dark:text-gray-300 break-words">{formatDate(app.lastContact)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("source")}</div>
          <div className="text-gray-700 dark:text-gray-300 break-words">{app.source || "—"}</div>
        </div>
        {app.rating && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("rating")}</div>
            <div className="text-yellow-400 text-sm tracking-tight" title={`${app.rating}/5`}>
              {"★".repeat(app.rating)}{"☆".repeat(5 - app.rating)}
            </div>
          </div>
        )}
        {app.triageQuality && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("triage")}</div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${TRIAGE_COLORS[app.triageQuality] || ""}`}>
              {app.triageQuality}/5
            </span>
          </div>
        )}
      </div>

      {app.notes && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
          <div className={notesExpanded ? "" : "line-clamp-3"}>{app.notes}</div>
          {app.notes.length > 120 && (
            <button
              onClick={() => setNotesExpanded((v) => !v)}
              className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {notesExpanded ? ta("show_less") : ta("show_more")}
            </button>
          )}
        </div>
      )}

      {app.contacts && app.contacts.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{t("contacts")}</div>
          <ContactPills contacts={app.contacts} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => onEdit(app)}
          className="flex min-h-[44px] items-center justify-center rounded-lg bg-blue-50 px-3 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25"
        >
          {ta("edit")}
        </button>
        {onArchive && (
          <button
            onClick={() => onArchive(app.id, !showArchived)}
            className="flex min-h-[44px] items-center justify-center rounded-lg bg-amber-50 px-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25"
          >
            {showArchived ? ta("unarchive") : ta("archive")}
          </button>
        )}
        <button
          onClick={() => onDelete(app.id)}
          className="flex min-h-[44px] items-center justify-center rounded-lg bg-red-50 px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
        >
          {ta("delete")}
        </button>
      </div>
    </article>
  );
}

interface ApplicationTableProps {
  applications: Application[];
  onEdit: (app: Application) => void;
  onDelete: (id: string) => void;
  onArchive?: (id: string, archive: boolean) => void;
  showArchived?: boolean;
  initialStatusFilter?: string;
  initialSourceFilter?: string;
  initialGlobalFilter?: string;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  focusedIndex?: number;
}

export function ApplicationTable({ applications, onEdit, onDelete, onArchive, showArchived, initialStatusFilter, initialSourceFilter, initialGlobalFilter, selectedIds, onToggleSelect, onSelectAll, onClearSelection, focusedIndex }: ApplicationTableProps) {
  const t = useTranslations("table");
  const ta = useTranslations("actions");
  const ts = useTranslations("status");
  const locale = useLocale();
  const dateFnsLocale = locale === "de" ? de : enUS;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() => {
    const filters: ColumnFiltersState = [];
    if (initialStatusFilter) filters.push({ id: "status", value: initialStatusFilter });
    if (initialSourceFilter) filters.push({ id: "source", value: initialSourceFilter });
    return filters;
  });
  const [globalFilter, setGlobalFilter] = useState(initialGlobalFilter ?? "");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [triageFilter, setTriageFilter] = useState(false);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd.MM.yyyy", { locale: dateFnsLocale });
    } catch {
      return "—";
    }
  }

  const hasSelection = !!selectedIds && !!onToggleSelect;
  const allSelected = hasSelection && selectedIds.size > 0 && applications.every((a) => selectedIds.has(a.id));

  const columns = [
    ...(hasSelection
      ? [
          columnHelper.display({
            id: "select",
            header: () => (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  if (allSelected) onClearSelection?.();
                  else onSelectAll?.();
                }}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            ),
            cell: ({ row }: { row: { original: Application } }) => (
              <input
                type="checkbox"
                checked={selectedIds.has(row.original.id)}
                onChange={() => onToggleSelect(row.original.id)}
                onClick={(e) => e.stopPropagation()}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            ),
          }),
        ]
      : []),
    columnHelper.accessor("company", {
      header: t("company"),
      cell: (info) => (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onEdit(info.row.original)}
            className="font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
          >
            {info.getValue()}
          </button>
          {info.row.original.jobUrl && (
            <a
              href={info.row.original.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={info.row.original.jobUrl}
              className="shrink-0 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          {info.row.original.remote && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
              Remote
            </span>
          )}
        </div>
      ),
    }),
    columnHelper.accessor("role", {
      header: t("role"),
      cell: (info) => <span className="text-gray-700 dark:text-gray-300">{info.getValue()}</span>,
    }),
    columnHelper.accessor("status", {
      header: t("status"),
      cell: (info) => <StatusBadge status={info.getValue() as ApplicationStatus} />,
      filterFn: "equals",
    }),
    columnHelper.accessor("rating", {
      header: t("rating"),
      cell: (info) => {
        const r = info.getValue();
        if (!r) return <span className="text-gray-400 dark:text-gray-500">—</span>;
        return (
          <span className="text-yellow-400 text-sm tracking-tight" title={`${r}/5`}>
            {"★".repeat(r)}{"☆".repeat(5 - r)}
          </span>
        );
      },
      sortingFn: (a, b) => (a.original.rating ?? 0) - (b.original.rating ?? 0),
    }),
    columnHelper.accessor("triageQuality", {
      header: t("triage"),
      cell: (info) => {
        const q = info.getValue();
        if (!q) return <span className="text-gray-400 dark:text-gray-500">—</span>;
        const colorClass = TRIAGE_COLORS[q] || "";
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${colorClass}`}
            title={info.row.original.triageReason || ""}
          >
            {q}/5
          </span>
        );
      },
      sortingFn: (a, b) => (a.original.triageQuality ?? 0) - (b.original.triageQuality ?? 0),
    }),
    columnHelper.accessor("source", {
      header: t("source"),
      cell: (info) => {
        const val = info.getValue();
        return val ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300 whitespace-nowrap">
            {val}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">—</span>
        );
      },
      filterFn: "equals",
    }),
    columnHelper.accessor("appliedAt", {
      header: t("applied_at"),
      cell: (info) => (
        <span className="text-gray-500 dark:text-gray-300 text-sm">{formatDate(info.getValue())}</span>
      ),
    }),
    columnHelper.accessor("lastContact", {
      header: t("last_contact"),
      cell: (info) => (
        <span className="text-gray-500 dark:text-gray-300 text-sm">{formatDate(info.getValue())}</span>
      ),
    }),
    columnHelper.accessor("followUpAt", {
      header: t("follow_up"),
      cell: (info) => <FollowUpCell date={info.getValue()} />,
    }),
    columnHelper.accessor("notes", {
      header: t("notes"),
      cell: (info) => (
        <span
          className="text-gray-500 dark:text-gray-300 text-sm max-w-[200px] truncate block"
          title={info.getValue() || ""}
        >
          {info.getValue() || "—"}
        </span>
      ),
    }),
    columnHelper.accessor("salaryMin", {
      header: t("salary"),
      cell: (info) => {
        const min = info.row.original.salaryMin;
        const max = info.row.original.salaryMax;
        if (!min && !max) return <span className="text-gray-400 dark:text-gray-500">—</span>;
        const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
        if (min && max) return <span className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">€{fmt(min)}–{fmt(max)}</span>;
        if (min) return <span className="text-sm text-gray-700 dark:text-gray-300">€{fmt(min)}+</span>;
        return <span className="text-sm text-gray-700 dark:text-gray-300">≤€{fmt(max!)}</span>;
      },
      sortingFn: (a, b) => (a.original.salaryMin ?? 0) - (b.original.salaryMin ?? 0),
    }),
    columnHelper.display({
      id: "contacts",
      header: t("contacts"),
      cell: ({ row }) => <ContactPills contacts={row.original.contacts} />,
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(row.original)}
            className="flex items-center min-h-[44px] px-2 text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors"
          >
            {ta("edit")}
          </button>
          {onArchive && (
            <button
              onClick={() => onArchive(row.original.id, !showArchived)}
              className="flex items-center min-h-[44px] px-2 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 text-sm font-medium transition-colors"
            >
              {showArchived ? ta("unarchive") : ta("archive")}
            </button>
          )}
          <button
            onClick={() => onDelete(row.original.id)}
            className="flex items-center min-h-[44px] px-2 text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
          >
            {ta("delete")}
          </button>
        </div>
      ),
    }),
  ];

  const filteredApplications = useMemo(() => {
    let result = applications;
    if (remoteOnly) result = result.filter((a) => a.remote);
    if (triageFilter) result = result.filter((a) => a.triageQuality != null && a.triageQuality >= 4);
    return result;
  }, [applications, remoteOnly, triageFilter]);

  const table = useReactTable({
    data: filteredApplications,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  const statusFilter = columnFilters.find((f) => f.id === "status")?.value as string | undefined;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="border-b border-gray-100 bg-white/95 p-4 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={ta("search")}
            className="col-span-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 sm:w-52"
          />
          <select
            value={statusFilter || ""}
            onChange={(e) => {
              setColumnFilters((prev) => {
                const other = prev.filter((f) => f.id !== "status");
                return e.target.value
                  ? [...other, { id: "status", value: e.target.value }]
                  : other;
              });
            }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 sm:w-auto"
          >
            <option value="">{ta("all_statuses")}</option>
            {STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {ts(value)}
              </option>
            ))}
          </select>
          <button
            onClick={() => setRemoteOnly((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:w-auto ${
              remoteOnly
                ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {ta("remote_only")}
          </button>
          <button
            onClick={() => setTriageFilter((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors sm:w-auto ${
              triageFilter
                ? "border-green-400 bg-green-50 text-green-700 dark:border-green-600 dark:bg-green-950/40 dark:text-green-300"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {ta("triage_filter")}
          </button>
          {(globalFilter || columnFilters.length > 0 || remoteOnly || triageFilter) && (
            <button
              onClick={() => {
                setGlobalFilter("");
                setColumnFilters([]);
                setRemoteOnly(false);
                setTriageFilter(false);
              }}
              className="col-span-2 text-left text-sm text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 sm:text-center"
            >
              {ta("filter_reset")}
            </button>
          )}
        </div>
      </div>

      <div className="p-2 pt-3 sm:p-3 sm:pt-4 md:hidden">
        {table.getRowModel().rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {t("empty")}
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {table.getRowModel().rows.map((row) => (
              <MobileApplicationCard
                key={row.id}
                app={row.original}
                onEdit={onEdit}
                onDelete={onDelete}
                onArchive={onArchive}
                showArchived={showArchived}
              />
            ))}
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto md:block relative [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-track]:bg-transparent">
        <table className="w-full border-collapse">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider px-4 py-3 whitespace-nowrap ${
                      header.id === "actions"
                        ? "sticky right-0 bg-gray-50 dark:bg-gray-900/80 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]"
                        : ""
                    } ${
                      header.column.getCanSort()
                        ? "cursor-pointer select-none hover:text-gray-700 dark:hover:text-white"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === "asc" && " ↑"}
                      {header.column.getIsSorted() === "desc" && " ↓"}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-gray-400 dark:text-gray-500">
                  {t("empty")}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, rowIndex) => {
                const status = row.original.status as ApplicationStatus;
                const rowColor = STATUS_ROW_COLORS[status] || "";
                const isSelected = hasSelection && selectedIds.has(row.original.id);
                const isFocused = focusedIndex !== undefined && focusedIndex === rowIndex;
                return (
                  <tr
                    key={row.id}
                    data-row-index={rowIndex}
                    className={`border-b border-gray-50 dark:border-gray-700/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-colors ${rowColor} ${
                      isSelected ? "bg-blue-100/60 dark:bg-blue-900/30" : ""
                    } ${isFocused ? "ring-2 ring-inset ring-blue-400 dark:ring-blue-500" : ""}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={`px-4 py-3 ${
                          cell.column.id === "actions"
                            ? "sticky right-0 bg-white dark:bg-gray-800 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]"
                            : ""
                        }`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="text-xs text-gray-400 dark:text-gray-500">
          {t("count", { filtered: table.getFilteredRowModel().rows.length, total: applications.length })}
        </div>
        {table.getPageCount() > 1 && (
          <PaginationControls
            page={table.getState().pagination.pageIndex + 1}
            totalPages={table.getPageCount()}
            onPageChange={(p) => table.setPageIndex(p - 1)}
          />
        )}
      </div>
    </div>
  );
}

function PaginationControls({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (page: number) => void }) {
  const btnClass = "px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | "ellipsis")[]>((acc, p, i, arr) => {
      if (i > 0 && arr[i - 1] !== p - 1) acc.push("ellipsis");
      acc.push(p);
      return acc;
    }, []);

  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onPageChange(1)} disabled={page <= 1} className={btnClass}>«</button>
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className={btnClass}>‹</button>
      {pageNumbers.map((item, i) =>
        item === "ellipsis" ? (
          <span key={`e${i}`} className="px-1 text-xs text-gray-400 dark:text-gray-500">…</span>
        ) : (
          <button
            key={item}
            onClick={() => onPageChange(item)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              item === page
                ? "bg-blue-600 text-white border-blue-600"
                : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
          >
            {item}
          </button>
        )
      )}
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className={btnClass}>›</button>
      <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} className={btnClass}>»</button>
    </div>
  );
}
