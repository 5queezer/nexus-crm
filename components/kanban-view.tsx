"use client";

import { useTranslations } from "next-intl";
import { format, isPast, isToday } from "date-fns";
import { Application, ApplicationStatus, STATUS_COLORS, STATUS_ORDER } from "@/types";

interface KanbanViewProps {
  applications: Application[];
  onEdit: (app: Application) => void;
}

function KanbanCard({ app, onEdit }: { app: Application; onEdit: (a: Application) => void }) {
  const hasFollowUp = !!app.followUpAt;
  const followUpDate = app.followUpAt ? new Date(app.followUpAt) : null;
  const isOverdue = followUpDate && isPast(followUpDate) && !isToday(followUpDate);
  const isDueToday = followUpDate && isToday(followUpDate);

  return (
    <div
      onClick={() => onEdit(app)}
      className="bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all group"
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

      {hasFollowUp && (
        <div
          className={`text-xs mt-1 font-medium ${
            isOverdue ? "text-red-600" : isDueToday ? "text-orange-500" : "text-blue-600"
          }`}
        >
          {isOverdue ? "⚠ " : isDueToday ? "🔔 " : "📅 "}
          {format(followUpDate!, "dd.MM.yy")}
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

interface KanbanColumnProps {
  status: ApplicationStatus;
  apps: Application[];
  onEdit: (app: Application) => void;
}

function KanbanColumn({ status, apps, onEdit }: KanbanColumnProps) {
  const ts = useTranslations("status");
  const tk = useTranslations("kanban");
  const colorClass = STATUS_COLORS[status];

  return (
    <div className="flex flex-col min-w-[200px] w-full">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${colorClass}`}
        >
          {ts(status)}
        </span>
        <span className="text-xs text-gray-400 font-medium">{apps.length}</span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 flex-1">
        {apps.length === 0 ? (
          <div className="text-xs text-gray-300 italic py-2 text-center border border-dashed border-gray-200 rounded-lg">
            {tk("empty")}
          </div>
        ) : (
          apps.map((app) => (
            <KanbanCard key={app.id} app={app} onEdit={onEdit} />
          ))
        )}
      </div>
    </div>
  );
}

export function KanbanView({ applications, onEdit }: KanbanViewProps) {
  const grouped: Record<ApplicationStatus, Application[]> = {} as Record<ApplicationStatus, Application[]>;
  for (const status of STATUS_ORDER) {
    grouped[status] = applications.filter((a) => a.status === status);
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="grid grid-cols-7 gap-4 min-w-[1050px]">
        {STATUS_ORDER.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            apps={grouped[status]}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}
