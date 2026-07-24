"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

interface NotesFieldProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  size: "compact" | "large";
  showLabel?: boolean;
}

/**
 * The notes editor. `field-sizing-content` lets the textarea grow with its
 * content where supported; the `min-h-*` + `resize-y` fallback keeps a
 * generous, manually resizable area everywhere else.
 */
export function NotesField({
  value,
  onChange,
  size,
  showLabel = true,
}: NotesFieldProps) {
  const t = useTranslations("modal");
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const warningId = `${inputId}-warning`;
  const nearLimit = value.length >= 9_000;

  return (
    <div>
      {showLabel && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t("summary")}
        </label>
      )}
      <textarea
        id={inputId}
        name="notes"
        value={value}
        onChange={onChange}
        maxLength={10_000}
        aria-describedby={nearLimit ? `${helpId} ${warningId}` : helpId}
        className={
          size === "large"
            ? "nexus-input nexus-scroll min-h-64 resize-y field-sizing-content"
            : "nexus-input min-h-24 resize-y field-sizing-content"
        }
        placeholder={t("notes_placeholder")}
      />
      <div id={helpId} className="mt-1 flex justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>{t("notes_summary_help")}</span>
        <span>{String(value.length)}/10,000</span>
      </div>
      {nearLimit && <p id={warningId} role="alert" className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">{t("notes_limit_warning")}</p>}
    </div>
  );
}
