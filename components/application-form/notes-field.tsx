"use client";

import { useTranslations } from "next-intl";

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

  return (
    <div>
      {showLabel && (
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t("notes")}
        </label>
      )}
      <textarea
        name="notes"
        value={value}
        onChange={onChange}
        className={
          size === "large"
            ? "nexus-input nexus-scroll min-h-64 resize-y field-sizing-content"
            : "nexus-input min-h-24 resize-y field-sizing-content"
        }
        placeholder={t("notes_placeholder")}
      />
    </div>
  );
}
