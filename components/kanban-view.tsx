"use client";

import { useState } from "react";
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

// ── API ──────────────────────────────────────────────────────────────────────

async function patchStatus(id: string, status: ApplicationStatus): Promise<Application> {
  const res = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update status");
  return res.json();
}

// ── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  app: Application;
  onEdit: (a: Application) => void;
  isDragging?: boolean;
}

function KanbanCard({ app, onEdit, isDragging = false }: CardProps) {
  const followUpDate = app.followUpAt ? new Date(app.followUpAt) : null;
  const isOverdue = followUpDate && isPast(followUpDate) && !isToday(followUpDate);
  const isDueToday = followUpDate && isToday(followUpDate);

  return (
    <div
      onClick={() => onEdit(app)}
      className={`
        bg-white border rounded-lg p-3 cursor-pointer transition-all group
        ${isDragging
          ? "border-blue-400 shadow-xl opacity-90 rotate-1 scale-105"
          : "border-gray-200 hover:shadow-md hover:border-blue-300"
        }
      `}
    >
      <div className="font-semibold text-gray-900 text-sm group-hover:text-blue-700 truncate">
        {app.company}
      </div>
      <div className="text-xs text-gray-500 mt-0.5 truncate">{app.role}</div>

      {app.appliedAt && (
        <div className="text-xs text-gray-400 mt-2">
          {format(new Date(app.appliedAt), "dd.MM.yy")}
        </div>
      )}

      {followUpDate && (
        <div
          className={`text-xs mt-1 font-medium ${
            isOverdue ? "text-red-600" : isDueToday ? "text-orange-500" : "text-blue-600"
          }`}
        >
          {isOverdue ? "⚠ " : isDueToday ? "🔔 " : "📅 "}
          {format(followUpDate, "dd.MM.yy")}
        </div>
      )}

      {app.notes && (
        <div className="text-xs text-gray-400 mt-1.5 truncate" title={app.notes}>
          {app.notes}
        </div>
      )}
    </div>
  );
}

// ── Draggable wrapper ─────────────────────────────────────────────────────────

function DraggableCard({ app, onEdit }: { app: Application; onEdit: (a: Application) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: app.id,
    data: { app },
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

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

// ── Droppable Column ──────────────────────────────────────────────────────────

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
    // Column: fixed width so it never gets squeezed.
    // On mobile the parent snap-scroll makes one column fill ~85vw;
    // on md+ each column is exactly 260px wide.
    <div className="flex flex-col w-full">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${colorClass}`}>
          {ts(status)}
        </span>
        <span className="text-xs text-gray-400 font-medium">{apps.length}</span>
      </div>

      {/* Drop zone — scrolls independently so long columns don't blow the page height */}
      <div
        ref={setNodeRef}
        className={`
          flex flex-col gap-2 flex-1 min-h-[80px] max-h-[calc(100vh-220px)]
          overflow-y-auto rounded-lg p-1 transition-colors
          ${isOver ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""}
        `}
      >
        {apps.length === 0 && !isOver ? (
          <div className="text-xs text-gray-300 italic py-2 text-center border border-dashed border-gray-200 rounded-lg">
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

// ── Main View ─────────────────────────────────────────────────────────────────

interface KanbanViewProps {
  applications: Application[];
  onEdit: (app: Application) => void;
}

export function KanbanView({ applications, onEdit }: KanbanViewProps) {
  const queryClient = useQueryClient();
  const [activeApp, setActiveApp] = useState<Application | null>(null);
  const [overColumnId, setOverColumnId] = useState<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require a small movement before activating drag — preserves click-to-edit
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      // Short delay + tolerance so taps still open cards, swipes drag
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  );

  const grouped: Record<ApplicationStatus, Application[]> = {} as Record<ApplicationStatus, Application[]>;
  for (const status of STATUS_ORDER) {
    grouped[status] = applications.filter((a) => a.status === status);
  }

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

    // Optimistic update — swap status in the cache immediately
    queryClient.setQueryData<Application[]>(["applications"], (prev) =>
      prev?.map((a) => (a.id === app.id ? { ...a, status: newStatus } : a)) ?? []
    );

    try {
      const updated = await patchStatus(app.id, newStatus);
      // Sync server response into cache
      queryClient.setQueryData<Application[]>(["applications"], (prev) =>
        prev?.map((a) => (a.id === updated.id ? updated : a)) ?? []
      );
    } catch {
      // Revert on error
      queryClient.setQueryData<Application[]>(["applications"], (prev) =>
        prev?.map((a) => (a.id === app.id ? { ...a, status: app.status } : a)) ?? []
      );
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/*
        Outer container scrolls horizontally on both mobile and desktop.

        Mobile  (<md): snap-x + snap-mandatory → swipe one column at a time
                       Each column: 85vw so the next one peeks from the right
        Desktop (≥md): plain flex row, each column 260px wide, no snapping needed
      */}
      <div className="overflow-x-auto pb-4 -mx-1 px-1">
        <div className="flex flex-nowrap gap-4 snap-x snap-mandatory md:snap-none">
          {STATUS_ORDER.map((status) => (
            // Snap anchor per column on mobile; fixed 260px on desktop
            <div
              key={status}
              className="snap-center flex-none w-[85vw] md:w-[260px] flex flex-col"
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

      {/* Floating drag overlay — matches column card width */}
      <DragOverlay dropAnimation={null}>
        {activeApp ? (
          <div className="w-[240px]">
            <KanbanCard app={activeApp} onEdit={() => {}} isDragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
