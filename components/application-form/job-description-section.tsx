"use client";

import { useTranslations } from "next-intl";
import { CollapsibleCard, SectionCard } from "./section-card";

interface JobDescriptionSectionProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  applicationId: string | null;
  variant?: "collapsible" | "open";
}

export function JobDescriptionSection({
  value,
  onChange,
  applicationId,
  variant = "collapsible",
}: JobDescriptionSectionProps) {
  const t = useTranslations("modal");

  const body = (
    <>
      <textarea
        name="jobDescription"
        value={value}
        onChange={onChange}
        className="nexus-input nexus-scroll max-h-[32rem] min-h-40 resize-y field-sizing-content font-mono text-xs"
        placeholder={t("job_description_placeholder")}
      />
      {applicationId && value.trim() && (
        <button
          type="button"
          onClick={() =>
            window.open(
              `/resume-review?applicationId=${applicationId}`,
              "_blank",
              "noopener,noreferrer",
            )
          }
          className="nexus-target mt-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
        >
          🤖 {t("analyze")}
        </button>
      )}
    </>
  );

  if (variant === "open") {
    return <SectionCard title={t("job_description")}>{body}</SectionCard>;
  }

  return (
    <CollapsibleCard
      title={(open) =>
        open
          ? t("job_description_toggle_hide")
          : t("job_description_toggle_show")
      }
    >
      {body}
    </CollapsibleCard>
  );
}
