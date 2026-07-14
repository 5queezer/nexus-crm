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
import { Application, ApplicationStatus, Contact, STATUS_COLORS, STATUS_ROW_COLORS, STATUS_ORDER, TRIAGE_COLORS, getSourceCategory } from "@/types";
import { format, isPast, isToday } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useLocale } from "next-intl";
import { Search } from "lucide-react";
import { ActionMenu } from "./action-menu";

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

function JobLink({ jobUrl, iconClassName }: { jobUrl: string; iconClassName: string }) {
  const ta = useTranslations("actions");

  return (
    <a
      href={jobUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      title={jobUrl}
      aria-label={ta("open_job_post")}
      className="shrink-0 text-gray-400 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
    >
      <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

interface MobileApplicationCardProps {
  app: Application;
  onEdit: (app: Application) => void;
  onDelete: (id: string) => void;
  onArchive?: (id: string, archive: boolean) => void;
  showArchived?: boolean;
}

function ApplicationActionMenu({ app, onEdit, onDelete, onArchive, showArchived, buttonText }: MobileApplicationCardProps & { buttonText?: string }) {
  const t = useTranslations("table");
  const ta = useTranslations("actions");
  return (
    <ActionMenu
      label={ta("opportunity_actions", { company: app.company || t("company") })}
      buttonText={buttonText}
      items={[
        { id: "edit", label: ta("edit"), onSelect: () => onEdit(app) },
        ...(onArchive
          ? [{ id: "archive", label: showArchived ? ta("unarchive") : ta("archive"), onSelect: () => onArchive(app.id, !showArchived) }]
          : []),
        { id: "delete", label: ta("delete"), destructive: true, separatorBefore: true, onSelect: () => onDelete(app.id) },
      ]}
    />
  );
}

function MobileApplicationCard({ app, onEdit, onDelete, onArchive, showArchived }: MobileApplicationCardProps) {
  const t = useTranslations("table");
  const ta = useTranslations("actions");
  const tAnalytics = useTranslations("analytics");
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
    <article
      className="cursor-pointer rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm backdrop-blur transition hover:border-indigo-300 hover:shadow-md dark:border-white/8 dark:bg-white/[0.035] dark:hover:border-indigo-500/50"
      onClick={() => onEdit(app)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit(app);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-gray-900 dark:text-white">
            <span className="truncate">{app.company || <span className="italic font-normal text-gray-400 dark:text-gray-500">—</span>}</span>
            {app.jobUrl && <JobLink jobUrl={app.jobUrl} iconClassName="h-4 w-4" />}
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
          <div className="text-gray-700 dark:text-gray-300 wrap-break-word">{formatDate(app.appliedAt)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("follow_up")}</div>
          <div className="wrap-break-word"><FollowUpCell date={app.followUpAt} /></div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("last_contact")}</div>
          <div className="text-gray-700 dark:text-gray-300 wrap-break-word">{formatDate(app.lastContact)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">{t("source")}</div>
          <div
            className="text-gray-700 dark:text-gray-300 wrap-break-word"
            title={app.source || undefined}
          >
            {app.source ? tAnalytics(`source_labels.${getSourceCategory(app.source)}`) : "—"}
          </div>
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
              onClick={(event) => {
                event.stopPropagation();
                setNotesExpanded((value) => !value);
              }}
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

      <div className="mt-4 flex justify-end" onClick={(event) => event.stopPropagation()}>
        <ApplicationActionMenu app={app} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} showArchived={showArchived} buttonText={ta("more")} />
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
  onSelectAll?: (applications: Application[]) => void;
  onDeselectAll?: (applications: Application[]) => void;
  focusedIndex?: number;
}

export function ApplicationTable({ applications, onEdit, onDelete, onArchive, showArchived, initialStatusFilter, initialSourceFilter, initialGlobalFilter, selectedIds, onToggleSelect, onSelectAll, onDeselectAll, focusedIndex }: ApplicationTableProps) {
  const t = useTranslations("table");
  const ta = useTranslations("actions");
  const tAnalytics = useTranslations("analytics");
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

  const columns = [
    ...(hasSelection
      ? [
          columnHelper.display({
            id: "select",
            header: ({ table }) => {
              const selectableApplications = table
                .getFilteredRowModel()
                .rows.slice(0, 100)
                .map((row) => row.original);
              const allSelected =
                selectableApplications.length > 0 &&
                selectableApplications.every((application) => selectedIds.has(application.id));

              return (
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => {
                    if (allSelected) onDeselectAll?.(selectableApplications);
                    else onSelectAll?.(selectableApplications);
                  }}
                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              );
            },
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
      header: t("company_role"),
      cell: (info) => (
        <div className="min-w-0 max-w-60">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onEdit(info.row.original)}
              className="truncate font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
              title={info.getValue() || undefined}
            >
              {info.getValue() || "—"}
            </button>
            {info.row.original.jobUrl && (
              <JobLink jobUrl={info.row.original.jobUrl} iconClassName="h-3.5 w-3.5" />
            )}
            {info.row.original.remote && (
              <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                Remote
              </span>
            )}
          </div>
          {info.row.original.role && (
            <div className="truncate text-xs text-gray-500 dark:text-gray-400" title={info.row.original.role}>
              {info.row.original.role}
            </div>
          )}
        </div>
      ),
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
        const rawSource = info.getValue();
        return rawSource ? (
          <span
            className="inline-flex max-w-36 items-center px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300"
            title={rawSource}
          >
            <span className="truncate">
              {tAnalytics(`source_labels.${getSourceCategory(rawSource)}`)}
            </span>
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">—</span>
        );
      },
      filterFn: (row, _columnId, filterValue) =>
        getSourceCategory(row.original.source) === String(filterValue),
    }),
    columnHelper.accessor("appliedAt", {
      header: t("applied_at"),
      cell: (info) => (
        <span className="text-gray-500 dark:text-gray-300 text-sm">{formatDate(info.getValue())}</span>
      ),
    }),
    columnHelper.accessor("followUpAt", {
      header: t("follow_up"),
      cell: (info) => <FollowUpCell date={info.getValue()} />,
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <ApplicationActionMenu app={row.original} onEdit={onEdit} onDelete={onDelete} onArchive={onArchive} showArchived={showArchived} />
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
    // Search across the full record, not just visible columns
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue).toLowerCase().trim();
      if (!q) return true;
      const a = row.original;
      const haystack = [
        a.company,
        a.role,
        a.source,
        a.notes,
        ...(a.contacts?.map((c) => c.name) ?? []),
      ];
      return haystack.some((v) => v?.toLowerCase().includes(q));
    },
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
    <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl dark:border-white/8 dark:bg-white/[0.035]">
      <div className="border-b border-slate-200/80 bg-white/70 p-4 backdrop-blur dark:border-white/8 dark:bg-black/20">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative col-span-2 sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
              aria-hidden
            />
            <input
              type="text"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={ta("search")}
              className="nexus-input pl-9!"
            />
          </div>
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
            className="nexus-input sm:w-auto"
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
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors sm:w-auto ${
              remoteOnly
                ? "border-emerald-400/60 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
                : "border-slate-200 bg-white/70 text-slate-600 hover:bg-slate-50 dark:border-white/8 dark:bg-white/3 dark:text-slate-300 dark:hover:bg-white/6"
            }`}
          >
            {ta("remote_only")}
          </button>
          <button
            onClick={() => setTriageFilter((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors sm:w-auto ${
              triageFilter
                ? "border-indigo-400/60 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300"
                : "border-slate-200 bg-white/70 text-slate-600 hover:bg-slate-50 dark:border-white/8 dark:bg-white/3 dark:text-slate-300 dark:hover:bg-white/6"
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
              className="col-span-2 text-left text-sm font-medium text-slate-500 underline underline-offset-4 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 sm:text-center"
            >
              {ta("filter_reset")}
            </button>
          )}
        </div>
      </div>

      <div className="p-2 pt-3 sm:p-3 sm:pt-4 lg:hidden">
        {table.getRowModel().rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400 dark:border-white/8 dark:text-slate-500">
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

      <div className="hidden overflow-x-auto lg:block relative [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
        <table className="w-full border-collapse">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-slate-200/80 bg-slate-50/80 dark:border-white/8 dark:bg-white/2.5">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap dark:text-slate-400 ${
                      header.id === "actions"
                        ? "sticky right-0 bg-slate-50/95 shadow-[-8px_0_16px_-12px_rgba(15,23,42,0.35)] dark:bg-[#0f1011]/95"
                        : ""
                    } ${
                      header.column.getCanSort()
                        ? "cursor-pointer select-none hover:text-slate-800 dark:hover:text-white"
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
                    className={`border-b border-slate-100/80 transition-colors hover:bg-indigo-50/40 dark:border-white/6 dark:hover:bg-white/[0.035] ${rowColor} ${
                      isSelected ? "bg-indigo-100/60 dark:bg-indigo-500/15" : ""
                    } ${isFocused ? "ring-2 ring-inset ring-indigo-400 dark:ring-[#7170ff]" : ""}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={`px-3 py-3 ${
                          cell.column.id === "actions"
                            ? "sticky right-0 bg-white/95 shadow-[-8px_0_16px_-12px_rgba(15,23,42,0.35)] dark:bg-[#0f1011]/95"
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

      <div className="flex flex-col items-center justify-between gap-2 border-t border-slate-200/80 px-4 py-3 dark:border-white/8 sm:flex-row">
        <div className="text-xs font-medium text-slate-400 dark:text-slate-500">
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
