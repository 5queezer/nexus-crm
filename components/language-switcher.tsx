"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

interface LanguageSwitcherProps {
  variant?: "compact" | "menu";
  label?: string;
  onChange?: () => void;
}

export function LanguageSwitcher({
  variant = "compact",
  label = "Language",
  onChange,
}: LanguageSwitcherProps = {}) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = locale === "de" ? "en" : "de";
    document.cookie = `locale=${next}; path=/; max-age=31536000; SameSite=Lax`;
    onChange?.();
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      type="button"
      role={variant === "menu" ? "menuitem" : undefined}
      aria-label={label}
      title={locale === "de" ? "Switch to English" : "Zu Deutsch wechseln"}
      className={variant === "menu"
        ? "language-menu-control flex min-h-12 w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/[0.07]"
        : "flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-700"
      }
    >
      {variant === "menu" && <span>{label}</span>}
      <span className="text-base leading-none">
        {locale === "de" ? "🇩🇪" : "🇬🇧"}
      </span>
      <span className={variant === "menu" ? "text-xs font-normal text-slate-500 dark:text-slate-400" : ""}>
        {locale === "de" ? "DE" : "EN"}
      </span>
    </button>
  );
}
