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
import { useState } from "react";
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
  if (!contacts || contacts.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {contacts.map((c) => (
        <span
          key={c.id}
          title={[c.role, c.email].filter(Boolean).join(" · ")}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 whitespace-nowrap"
        >
          {c.name}
          {c.role && <span className="ml-1 text-indigo-500 font-normal">· {c.role}</span>}
        </span>
      ))}
    </div>
  );
}

function FollowUpCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-400">—</span>;
  const d = new Date(date);
  const overdue = isPast(d) && !isToday(d);
  const due = isToday(d);
  return (
    <span
      className={`text-sm font-medium ${
        overdue ? "text-red-600" : due ? "text-orange-500" : "text-gray-600"
      }`}
      title={overdue ? "Überfällig" : due ? "Heute fällig" : ""}
    >
      {overdue && "⚠ "}
      {due && "🔔 "}
      {format(d, "dd.MM.yy")}
    </span>
  );
}

interface ApplicationTableProps {
  applications: Application[];
  onEdit: (app: Application) => void;
  onDelete: (id: number) => void;
}

export function ApplicationTable({ applications, onEdit, onDelete }: ApplicationTableProps) {
  const t = useTranslations("table");
  const ta = useTranslations("actions");
  const ts = useTranslations("status");
  const locale = useLocale();
  const dateFnsLocale = locale === "de" ? de : enUS;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

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
        <span className="font-medium text-gray-900">{info.getValue()}</span>
      ),
    }),
    columnHelper.accessor("role", {
      header: t("role"),
      cell: (info) => <span className="text-gray-700">{info.getValue()}</span>,
    }),
    columnHelper.accessor("status", {
      header: t("status"),
      cell: (info) => <StatusBadge status={info.getValue() as ApplicationStatus} />,
      filterFn: "equals",
    }),
    columnHelper.accessor("appliedAt", {
      header: t("applied_at"),
      cell: (info) => (
        <span className="text-gray-500 text-sm">{formatDate(info.getValue())}</span>
      ),
    }),
    columnHelper.accessor("lastContact", {
      header: t("last_contact"),
      cell: (info) => (
        <span className="text-gray-500 text-sm">{formatDate(info.getValue())}</span>
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
          className="text-gray-500 text-sm max-w-xs truncate block"
          title={info.getValue() || ""}
        >
          {info.getValue() || "—"}
        </span>
      ),
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

  const table = useReactTable({
    data: applications,
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Filters */}
      <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3">
        <input
          type="text"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={ta("search")}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 w-52 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">{ta("all_statuses")}</option>
          {STATUS_ORDER.map((value) => (
            <option key={value} value={value}>
              {ts(value)}
            </option>
          ))}
        </select>
        {(globalFilter || statusFilter) && (
          <button
            onClick={() => {
              setGlobalFilter("");
              setColumnFilters([]);
            }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            {ta("filter_reset")}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-gray-50 border-b border-gray-100">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 ${
                      header.column.getCanSort()
                        ? "cursor-pointer select-none hover:text-gray-700"
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
                <td colSpan={columns.length} className="text-center py-12 text-gray-400">
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
                    className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${rowColor}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3">
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

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
        {t("count", {
          filtered: table.getFilteredRowModel().rows.length,
          total: applications.length,
        })}
      </div>
    </div>
  );
}
