"use client";

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Application, ApplicationStatus, Contact, STATUS_COLORS, STATUS_ROW_COLORS, STATUS_ORDER } from "@/types";
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
          <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white">
            {app.company || <span className="italic font-normal text-gray-400 dark:text-gray-500">—</span>}
          </h3>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{app.role}</p>
        </div>
        <div className="shrink-0 flex flex-wrap gap-1">
          <StatusBadge status={app.status} />
          {app.remote && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">Remote</span>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{t("applied_at")}</div>
          <div className="mt-1 text-gray-700 dark:text-gray-300">{formatDate(app.appliedAt)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{t("follow_up")}</div>
          <div className="mt-1"><FollowUpCell date={app.followUpAt} /></div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{t("last_contact")}</div>
          <div className="mt-1 text-gray-700 dark:text-gray-300">{formatDate(app.lastContact)}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{t("source")}</div>
          <div className="mt-1 text-gray-700 dark:text-gray-300">{app.source || "—"}</div>
        </div>
      </div>

      {app.notes && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
          {app.notes}
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
}

export function ApplicationTable({ applications, onEdit, onDelete, onArchive, showArchived }: ApplicationTableProps) {
  const t = useTranslations("table");
  const ta = useTranslations("actions");
  const ts = useTranslations("status");
  const locale = useLocale();
  const dateFnsLocale = locale === "de" ? de : enUS;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd.MM.yyyy", { locale: dateFnsLocale });
    } catch {
      return "—";
    }
  }

  const columns = [
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

  const filteredApplications = useMemo(
    () => remoteOnly ? applications.filter((a) => a.remote) : applications,
    [applications, remoteOnly]
  );

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
  });

  const statusFilter = columnFilters.find((f) => f.id === "status")?.value as string | undefined;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="border-b border-gray-100 bg-white/95 p-4 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={ta("search")}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 sm:w-52"
          />
          <select
            value={statusFilter || ""}
            onChange={(e) => {
              if (e.target.value) {
                setColumnFilters([{ id: "status", value: e.target.value }]);
              } else {
                setColumnFilters([]);
              }
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
          {(globalFilter || statusFilter || remoteOnly) && (
            <button
              onClick={() => {
                setGlobalFilter("");
                setColumnFilters([]);
                setRemoteOnly(false);
              }}
              className="text-left text-sm text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 sm:text-center"
            >
              {ta("filter_reset")}
            </button>
          )}
        </div>
      </div>

      <div className="p-3 pt-4 md:hidden">
        {table.getRowModel().rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {t("empty")}
          </div>
        ) : (
          <div className="space-y-3">
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

      <div className="hidden overflow-x-auto md:block relative">
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
              table.getRowModel().rows.map((row) => {
                const status = row.original.status as ApplicationStatus;
                const rowColor = STATUS_ROW_COLORS[status] || "";
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-50 dark:border-gray-700/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-colors ${rowColor}`}
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

      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
        {t("count", {
          filtered: table.getFilteredRowModel().rows.length,
          total: applications.length,
        })}
      </div>
    </div>
  );
}
