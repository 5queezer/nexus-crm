"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
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

export function ActionMenu({ label, items, buttonText, align = "right", className = "" }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsidePointer);
    document.addEventListener("touchstart", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer);
      document.removeEventListener("touchstart", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={buttonText
          ? "nexus-button-ghost min-h-10 whitespace-nowrap px-3"
          : "flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.07] dark:hover:text-white"
        }
      >
        {buttonText ? (
          <><span>{buttonText}</span><MoreHorizontal className="h-4 w-4" /></>
        ) : (
          <MoreHorizontal className="h-5 w-5" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute z-40 mt-2 min-w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-white/[0.1] dark:bg-[#151617] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((item) => (
            <div key={item.id} className={item.separatorBefore ? "mt-1 border-t border-slate-100 pt-1 dark:border-white/[0.08]" : ""}>
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={`flex min-h-10 w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  item.destructive
                    ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.07]"
                }`}
              >
                <span>{item.label}</span>
                {item.hint && <span className="text-xs font-normal text-slate-400 dark:text-slate-500">{item.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
