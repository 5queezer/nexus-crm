"use client";

import {
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ApplicationStatus, STATUS_ORDER, STATUS_COLORS } from "@/types";

interface BulkActionBarProps {
  selectedCount: number;
  hiddenSelectedCount: number;
  onChangeStatus: (status: ApplicationStatus) => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function BulkActionBar(props: BulkActionBarProps) {
  return props.selectedCount > 0 ? <BulkActionBarInner {...props} /> : null;
}

function BulkActionBarInner({
  selectedCount,
  hiddenSelectedCount,
  onChangeStatus,
  onArchive,
  onDelete,
  onClear,
}: BulkActionBarProps) {
  const t = useTranslations("bulk_actions");
  const ts = useTranslations("status");
  const [statusOpen, setStatusOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!statusOpen) return;

    function updateMenuPosition() {
      const trigger = statusTriggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = 176;
      const menuHeight = statusMenuRef.current?.offsetHeight ?? 0;
      setMenuPosition({
        top: Math.max(8, trigger.top - menuHeight - 4),
        left: Math.min(
          Math.max(8, trigger.right - width),
          window.innerWidth - width - 8,
        ),
      });
    }

    function closeForOutsidePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (
        !statusTriggerRef.current?.contains(target) &&
        !statusMenuRef.current?.contains(target)
      ) {
        setStatusOpen(false);
      }
    }

    function closeForEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setStatusOpen(false);
      requestAnimationFrame(() => statusTriggerRef.current?.focus());
    }

    updateMenuPosition();
    const frame = requestAnimationFrame(() => {
      updateMenuPosition();
      statusMenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    });
    document.addEventListener("mousedown", closeForOutsidePointer);
    document.addEventListener("touchstart", closeForOutsidePointer);
    document.addEventListener("keydown", closeForEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", closeForOutsidePointer);
      document.removeEventListener("touchstart", closeForOutsidePointer);
      document.removeEventListener("keydown", closeForEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [statusOpen]);

  function toggleStatusMenu() {
    if (!statusOpen) {
      const trigger = statusTriggerRef.current?.getBoundingClientRect();
      if (trigger) {
        const width = 176;
        const estimatedMenuHeight = STATUS_ORDER.length * 48 + 2;
        setMenuPosition({
          top: Math.max(8, trigger.top - estimatedMenuHeight - 4),
          left: Math.min(
            Math.max(8, trigger.right - width),
            window.innerWidth - width - 8,
          ),
        });
      }
    }
    setStatusOpen((value) => !value);
  }

  function closeStatusMenuAndRestoreFocus() {
    setStatusOpen(false);
    requestAnimationFrame(() => statusTriggerRef.current?.focus());
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      statusMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        [],
    );
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : items.length - 1
        : (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  }

  return (
    <div className="nexus-safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white px-3 pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] dark:border-gray-700 dark:bg-gray-800 sm:px-4">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("selected", { count: selectedCount })}
          </span>
          {hiddenSelectedCount > 0 && (
            <span
              aria-live="polite"
              aria-atomic="true"
              className="text-xs text-gray-500 dark:text-gray-400"
            >
              {t("hidden_included", { count: hiddenSelectedCount })}
            </span>
          )}
          {selectedCount > 100 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {t("max_warning")}
            </span>
          )}
        </div>

        <div
          data-bulk-action-scroller
          className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0"
        >
          <button
            ref={statusTriggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={statusOpen}
            aria-controls="bulk-status-menu"
            onClick={toggleStatusMenu}
            className="nexus-target inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t("change_status")}
            <span className="text-xs" aria-hidden="true">
              {statusOpen ? "▲" : "▼"}
            </span>
          </button>

          <button
            type="button"
            onClick={onArchive}
            className="nexus-target inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50"
          >
            {t("archive_selected")}
          </button>

          <button
            type="button"
            onClick={onDelete}
            className="nexus-target inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-600 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
          >
            {t("delete_selected")}
          </button>

          <button
            type="button"
            onClick={onClear}
            className="nexus-target inline-flex items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            {t("clear")}
          </button>
        </div>
      </div>

      {statusOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id="bulk-status-menu"
            ref={statusMenuRef}
            role="menu"
            aria-label={t("change_status")}
            data-bulk-status-menu
            onKeyDown={handleMenuKeyDown}
            style={{ top: menuPosition.top, left: menuPosition.left }}
            className="fixed z-100 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
          >
            {STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                role="menuitem"
                onClick={() => {
                  closeStatusMenuAndRestoreFocus();
                  onChangeStatus(status);
                }}
                className="flex min-h-12 w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[status]}`}
                >
                  {ts(status)}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
