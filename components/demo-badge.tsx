"use client";

import { useTranslations } from "next-intl";

export function DemoBadge() {
  const t = useTranslations("demoWorkspace");
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
      {t("badge")}
    </span>
  );
}
