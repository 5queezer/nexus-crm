"use client";

import {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export interface ActionMenuItem {
  id: string;
  label: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  hint?: ReactNode;
}

interface ActionMenuProps {
  label: string;
  items: ActionMenuItem[];
  buttonText?: string;
  align?: "left" | "right";
  className?: string;
}

export function ActionMenu({
  label,
  items,
  buttonText,
  align = "right",
  className = "",
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function updateMenuPosition() {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    if (!triggerRect) return;
    const menuWidth = 224;
    const preferredLeft =
      align === "right" ? triggerRect.right - menuWidth : triggerRect.left;
    setMenuPosition({
      top: triggerRect.bottom + 8,
      left: Math.min(
        Math.max(8, preferredLeft),
        window.innerWidth - menuWidth - 8,
      ),
    });
  }

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      )
        closeMenu();
    }

    function closeOnDocumentKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu({ restoreFocus: true });
      if (event.key === "Tab") closeMenu();
    }

    const triggerRect = triggerRef.current?.getBoundingClientRect();

    function closeOnViewportChange() {
      closeMenu();
    }

    document.addEventListener("mousedown", closeOnOutsidePointer);
    document.addEventListener("touchstart", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnDocumentKey);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.bottom > window.innerHeight - 8) {
        setMenuPosition((position) => ({
          ...position,
          top: Math.max(
            8,
            triggerRect ? triggerRect.top - menuRect.height - 8 : 8,
          ),
        }));
      }
      menu
        .querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    });
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer);
      document.removeEventListener("touchstart", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnDocumentKey);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [align, open]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const enabledItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (enabledItems.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = enabledItems.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      (currentIndex + direction + enabledItems.length) % enabledItems.length;
    enabledItems[nextIndex].focus();
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (!open) updateMenuPosition();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={
          buttonText
            ? "nexus-button-ghost nexus-target whitespace-nowrap px-3"
            : "nexus-target nexus-focus-ring flex items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.07] dark:hover:text-white"
        }
      >
        {buttonText ? (
          <>
            <span>{buttonText}</span>
            <MoreHorizontal className="h-4 w-4" />
          </>
        ) : (
          <MoreHorizontal className="h-5 w-5" />
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={handleMenuKeyDown}
            style={{ top: menuPosition.top, left: menuPosition.left }}
            className="fixed z-100 min-w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-[#151617]"
          >
            {items.map((item) => (
              <div
                key={item.id}
                className={
                  item.separatorBefore
                    ? "mt-1 border-t border-slate-100 pt-1 dark:border-white/8"
                    : ""
                }
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (item.disabled) return;
                    closeMenu({ restoreFocus: true });
                    item.onSelect?.();
                  }}
                  className={`flex min-h-12 w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    item.destructive
                      ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.07]"
                  }`}
                >
                  <span>{item.label}</span>
                  {item.hint && (
                    <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                      {item.hint}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
