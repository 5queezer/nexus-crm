"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { format, isPast, isToday } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  UniqueIdentifier,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Application, ApplicationStatus, STATUS_COLORS, STATUS_ORDER } from "@/types";

type KanbanSortKey = "rating_desc" | "updated_desc" | "created_desc" | "company_asc";

const KANBAN_SORT_OPTIONS: KanbanSortKey[] = [
  "rating_desc",
  "updated_desc",
  "created_desc",
  "company_asc",
];

const SORT_COMPARATORS: Record<KanbanSortKey, (a: Application, b: Application) => number> = {
  rating_desc: (a, b) => {
    const diff = (b.rating ?? 0) - (a.rating ?? 0);
    if (diff !== 0) return diff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  },
  updated_desc: (a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  created_desc: (a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  company_asc: (a, b) => a.company.localeCompare(b.company),
};

async function patchStatus(id: string, status: ApplicationStatus): Promise<Application> {
  const res = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update status");
  return res.json();
}

interface CardProps {
  app: Application;
  onEdit: (a: Application) => void;
  isDragging?: boolean;
}

function KanbanCard({ app, onEdit, isDragging = false }: CardProps) {
  const ts = useTranslations("status");
  const followUpDate = app.followUpAt ? new Date(app.followUpAt) : null;
  const isOverdue = followUpDate && isPast(followUpDate) && !isToday(followUpDate);
  const isDueToday = followUpDate && isToday(followUpDate);

  return (
    <div
      onClick={() => onEdit(app)}
      className={`
        group cursor-pointer rounded-2xl border bg-white/85 p-3 shadow-sm backdrop-blur transition-all dark:bg-white/[0.035]
        ${isDragging
          ? "rotate-1 scale-105 border-indigo-400 shadow-xl opacity-95 dark:border-[#7170ff]"
          : "border-slate-200/80 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-white/8 dark:hover:border-[#7170ff]/60"
        }
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span
              className="truncate text-sm font-semibold text-slate-950 transition group-hover:text-indigo-700 dark:text-[#f7f8f8] dark:group-hover:text-[#828fff]"
              title={app.company}
            >
              {app.company}
            </span>
            {app.jobUrl && (
              <a
                href={app.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={app.jobUrl}
                className="shrink-0 text-slate-400 transition hover:text-indigo-600 dark:hover:text-[#828fff]"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400" title={app.role}>{app.role}</div>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[app.status]}`}>
          {ts(app.status)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
        {app.remote && (
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">Remote</span>
        )}
        {app.appliedAt && <span>{format(new Date(app.appliedAt), "dd.MM.yyyy")}</span>}
        {followUpDate && (
          <span
            className={`font-medium ${
              isOverdue ? "text-red-600 dark:text-red-400" : isDueToday ? "text-orange-500 dark:text-orange-400" : "text-blue-600 dark:text-blue-400"
            }`}
          >
            {isOverdue ? "⚠ " : isDueToday ? "🔔 " : "📅 "}
            {format(followUpDate, "dd.MM.yyyy")}
          </span>
        )}
      </div>

      {app.rating && (
        <div className="mt-2 text-yellow-400 text-xs tracking-tight" title={`${app.rating}/5`}>
          {"★".repeat(app.rating)}{"☆".repeat(5 - app.rating)}
        </div>
      )}

      {app.notes && (
        <div className="mt-2 max-h-10 overflow-hidden text-xs text-gray-500 dark:text-gray-400" title={app.notes}>
          {app.notes}
        </div>
      )}
    </div>
  );
}

function DraggableCard({ app, onEdit }: { app: Application; onEdit: (a: Application) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: app.id,
    data: { app },
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={isDragging ? "opacity-30" : undefined}
    >
      <KanbanCard app={app} onEdit={onEdit} />
    </div>
  );
}

interface KanbanColumnProps {
  status: ApplicationStatus;
  apps: Application[];
  onEdit: (app: Application) => void;
  isOver: boolean;
}

function KanbanColumn({ status, apps, onEdit, isOver }: KanbanColumnProps) {
  const ts = useTranslations("status");
  const tk = useTranslations("kanban");
  const colorClass = STATUS_COLORS[status];

  const { setNodeRef } = useDroppable({ id: status });

  return (
    <div className="flex w-full flex-col rounded-2xl border border-slate-200/80 bg-white/55 p-3 shadow-sm backdrop-blur dark:border-white/8 dark:bg-white/2.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${colorClass}`}>
          {ts(status)}
        </span>
        <span className="nexus-chip">{apps.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`
          flex flex-col gap-2 flex-1 min-h-[120px] max-h-[calc(100vh-260px)]
          overflow-y-auto rounded-xl p-1 transition-colors
          ${isOver ? "bg-indigo-50 ring-2 ring-indigo-300 ring-inset dark:bg-indigo-500/10 dark:ring-[#7170ff]" : ""}
        `}
      >
        {apps.length === 0 && !isOver ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-8 text-center text-xs italic text-slate-400 dark:border-white/8 dark:bg-white/2 dark:text-slate-500">
            {tk("empty")}
          </div>
        ) : (
          apps.map((app) => (
            <DraggableCard key={app.id} app={app} onEdit={onEdit} />
          ))
        )}
      </div>
    </div>
  );
}

interface KanbanViewProps {
  applications: Application[];
  onEdit: (app: Application) => void;
}

export function KanbanView({ applications, onEdit }: KanbanViewProps) {
  const ts = useTranslations("status");
  const tk = useTranslations("kanban");
  const queryClient = useQueryClient();
  const [activeApp, setActiveApp] = useState<Application | null>(null);
  const [overColumnId, setOverColumnId] = useState<UniqueIdentifier | null>(null);
  const [sortKey, setSortKey] = useState<KanbanSortKey>(() => {
    if (typeof window === "undefined") return "rating_desc";
    return (localStorage.getItem("kanban-sort") as KanbanSortKey) || "rating_desc";
  });

  function handleSortChange(key: KanbanSortKey) {
    setSortKey(key);
    localStorage.setItem("kanban-sort", key);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  );

  const grouped = useMemo(() => {
    const comparator = SORT_COMPARATORS[sortKey];
    const next = {} as Record<ApplicationStatus, Application[]>;
    for (const status of STATUS_ORDER) {
      next[status] = applications.filter((a) => a.status === status).sort(comparator);
    }
    return next;
  }, [applications, sortKey]);

  const mobileStatuses = useMemo(
    () => STATUS_ORDER.filter((status) => grouped[status].length > 0),
    [grouped]
  );

  function handleDragStart(event: DragStartEvent) {
    const app = (event.active.data.current as { app: Application }).app;
    setActiveApp(app);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverColumnId(event.over?.id ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveApp(null);
    setOverColumnId(null);

    const { active, over } = event;
    if (!over) return;

    const newStatus = over.id as ApplicationStatus;
    const app = (active.data.current as { app: Application }).app;

    if (app.status === newStatus) return;

    queryClient.setQueryData<Application[]>(["applications"], (prev) =>
      prev?.map((a) => (a.id === app.id ? { ...a, status: newStatus } : a)) ?? []
    );

    try {
      const updated = await patchStatus(app.id, newStatus);
      queryClient.setQueryData<Application[]>(["applications"], (prev) =>
        prev?.map((a) => (a.id === updated.id ? updated : a)) ?? []
      );
    } catch {
      queryClient.setQueryData<Application[]>(["applications"], (prev) =>
        prev?.map((a) => (a.id === app.id ? { ...a, status: app.status } : a)) ?? []
      );
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-2">
        <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          {tk("sort_label")}
        </label>
        <select
          value={sortKey}
          onChange={(e) => handleSortChange(e.target.value as KanbanSortKey)}
          className="nexus-input w-auto"
        >
          {KANBAN_SORT_OPTIONS.map((key) => (
            <option key={key} value={key}>
              {tk(`sort_${key}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="md:hidden space-y-4">
        {mobileStatuses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {tk("empty")}
          </div>
        ) : (
          mobileStatuses.map((status) => (
            <section key={status} className="space-y-2">
              <div className="sticky top-16 z-5 -mx-1 rounded-xl border border-gray-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${STATUS_COLORS[status]}`}>
                    {ts(status)}
                    <span>&nbsp;· {grouped[status].length}</span>
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {grouped[status].map((app) => (
                  <KanbanCard key={app.id} app={app} onEdit={onEdit} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="hidden md:block">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="-mx-1 overflow-x-auto px-1 pb-4">
            <div className="flex flex-nowrap gap-4">
              {STATUS_ORDER.map((status) => (
                <div
                  key={status}
                  className="flex min-w-[240px] flex-1 flex-col"
                >
                  <KanbanColumn
                    status={status}
                    apps={grouped[status]}
                    onEdit={onEdit}
                    isOver={overColumnId === (status as UniqueIdentifier)}
                  />
                </div>
              ))}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeApp ? (
              <div className="w-[240px]">
                <KanbanCard app={activeApp} onEdit={() => {}} isDragging />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </>
  );
}
