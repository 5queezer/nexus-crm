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
        bg-white dark:bg-gray-800 border rounded-lg p-3 cursor-pointer transition-all group
        ${isDragging
          ? "border-blue-400 shadow-xl opacity-90 rotate-1 scale-105"
          : "border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-500"
        }
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span
              className="font-semibold text-gray-900 dark:text-white text-sm group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate"
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
                className="shrink-0 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-300 mt-0.5 truncate" title={app.role}>{app.role}</div>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[app.status]}`}>
          {ts(app.status)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400 dark:text-gray-400">
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
    <div className="flex flex-col w-full">
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${colorClass}`}>
          {ts(status)}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-400 font-medium">{apps.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={`
          flex flex-col gap-2 flex-1 min-h-[80px] max-h-[calc(100vh-220px)]
          overflow-y-auto rounded-lg p-1 transition-colors
          ${isOver ? "bg-blue-50 dark:bg-blue-950/30 ring-2 ring-blue-300 dark:ring-blue-600 ring-inset" : ""}
        `}
      >
        {apps.length === 0 && !isOver ? (
          <div className="text-xs text-gray-300 dark:text-gray-500 italic py-6 text-center border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50/50 dark:bg-gray-800/30">
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  );

  const grouped = useMemo(() => {
    const next = {} as Record<ApplicationStatus, Application[]>;
    for (const status of STATUS_ORDER) {
      next[status] = applications.filter((a) => a.status === status);
    }
    return next;
  }, [applications]);

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
      <div className="md:hidden space-y-4">
        {mobileStatuses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {tk("empty")}
          </div>
        ) : (
          mobileStatuses.map((status) => (
            <section key={status} className="space-y-2">
              <div className="sticky top-16 z-[5] -mx-1 rounded-xl border border-gray-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
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
          <div className="overflow-x-auto pb-4 -mx-1 px-1">
            <div className="flex flex-nowrap gap-4">
              {STATUS_ORDER.map((status) => (
                <div
                  key={status}
                  className="flex-1 min-w-[220px] flex flex-col"
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
