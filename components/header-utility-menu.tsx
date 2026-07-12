"use client";

import { KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { ChevronDown, ExternalLink, LogOut } from "lucide-react";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";

interface HeaderUtilityUser {
  name?: string | null;
  email: string;
  image?: string | null;
}

interface HeaderUtilityMenuProps {
  user: HeaderUtilityUser;
  shareUrl?: string;
  onLogout: () => void | Promise<void>;
}

interface HeaderUtilityMenuPanelProps extends HeaderUtilityMenuProps {
  onRequestClose?: () => void;
}

export function getNextMenuItemIndex(
  currentIndex: number,
  itemCount: number,
  key: "ArrowDown" | "ArrowUp",
): number {
  if (itemCount <= 0) return -1;
  if (currentIndex === -1) return key === "ArrowDown" ? 0 : itemCount - 1;
  const direction = key === "ArrowDown" ? 1 : -1;
  return (currentIndex + direction + itemCount) % itemCount;
}

export function getHeaderUtilityMenuDisclosureKey(pathname: string): string {
  return pathname;
}

export function shouldDismissMenuForPointer(insideRoot: boolean, insideMenu: boolean): boolean {
  return !insideRoot && !insideMenu;
}

export function getMenuKeyboardDismissal(key: string): { close: boolean; restoreFocus: boolean } {
  if (key === "Escape") return { close: true, restoreFocus: true };
  if (key === "Tab") return { close: true, restoreFocus: false };
  return { close: false, restoreFocus: false };
}

export function HeaderUtilityMenuPanel({
  user,
  shareUrl,
  onLogout,
  onRequestClose,
}: HeaderUtilityMenuPanelProps) {
  const tn = useTranslations("nav");

  return (
    <div role="none" className="p-1.5">
      <div role="none" className="border-b border-slate-100 px-3 py-2.5 dark:border-white/8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          {tn("signed_in_as")}
        </div>
        {user.name && (
          <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">
            {user.name}
          </div>
        )}
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</div>
      </div>

      <div role="none" className="py-1">
        {shareUrl && (
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={onRequestClose}
            className="flex min-h-10 items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[0.07]"
          >
            <span>{tn("share")}</span>
            <ExternalLink className="h-4 w-4 text-slate-400" />
          </a>
        )}
        <ThemeSwitcher
          variant="menu"
          label={tn("theme")}
          themeLabels={{
            light: tn("theme_light"),
            dark: tn("theme_dark"),
            system: tn("theme_system"),
          }}
          onChange={onRequestClose}
        />
        <LanguageSwitcher variant="menu" label={tn("language")} onChange={onRequestClose} />
      </div>

      <div role="none" className="border-t border-slate-100 pt-1 dark:border-white/8">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onRequestClose?.();
            void onLogout();
          }}
          className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
        >
          <span>{tn("logout")}</span>
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function HeaderUtilityMenu(props: HeaderUtilityMenuProps) {
  const pathname = usePathname();
  return <HeaderUtilityMenuDisclosure key={getHeaderUtilityMenuDisclosureKey(pathname)} {...props} />;
}

function HeaderUtilityMenuDisclosure({ user, shareUrl, onLogout }: HeaderUtilityMenuProps) {
  const tn = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const userInitial = (user.name || user.email || "N").trim().charAt(0).toUpperCase();

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 256;
    setPosition({
      top: rect.bottom + 8,
      left: Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8),
    });
  }

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (shouldDismissMenuForPointer(
        rootRef.current?.contains(target) ?? false,
        menuRef.current?.contains(target) ?? false,
      )) closeMenu();
    }

    function closeOnDocumentKey(event: KeyboardEvent) {
      const dismissal = getMenuKeyboardDismissal(event.key);
      if (dismissal.close) closeMenu({ restoreFocus: dismissal.restoreFocus });
    }

    function closeOnViewportChange() {
      closeMenu();
    }

    document.addEventListener("mousedown", closeOnOutsidePointer);
    document.addEventListener("touchstart", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnDocumentKey);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });

    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer);
      document.removeEventListener("touchstart", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnDocumentKey);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    items[getNextMenuItemIndex(currentIndex, items.length, event.key)].focus();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={tn("account_menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) updatePosition();
          setOpen((value) => !value);
        }}
        className="flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white/70 p-1 pr-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 dark:border-white/8 dark:bg-white/4 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-8 w-8 rounded-lg object-cover" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-semibold text-white">
            {userInitial}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={tn("account_menu")}
          onKeyDown={handleMenuKeyDown}
          style={{ top: position.top, left: position.left }}
          className="fixed z-100 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#151617]"
        >
          <HeaderUtilityMenuPanel
            user={user}
            shareUrl={shareUrl}
            onLogout={onLogout}
            onRequestClose={() => closeMenu({ restoreFocus: true })}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
