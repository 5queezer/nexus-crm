"use client";

import { useTranslations } from "next-intl";
import { TRIAGE_COLORS } from "@/types";
import { TriagePanel } from "../triage-panel";
import { CollapsibleCard, SectionCard } from "./section-card";
import type { ApplicationFormData } from "./form-data";

interface TriageSectionProps {
  form: ApplicationFormData;
  patch: (partial: Partial<ApplicationFormData>) => void;
  variant?: "collapsible" | "open";
}

export function TriageSection({
  form,
  patch,
  variant = "collapsible",
}: TriageSectionProps) {
  const t = useTranslations("modal");

  const badge = form.triageQuality ? (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
        TRIAGE_COLORS[form.triageQuality as keyof typeof TRIAGE_COLORS] || ""
      }`}
    >
      {form.triageQuality}/5
    </span>
  ) : undefined;

  const panel = (
    <TriagePanel
      data={{
        companySize: form.companySize,
        salaryBandMentioned: form.salaryBandMentioned,
        triageQuality: form.triageQuality as 1 | 2 | 3 | 4 | 5 | null,
        triageReason: form.triageReason,
        incomingSource: form.incomingSource,
        autoRejected: form.autoRejected,
        autoRejectReason: form.autoRejectReason,
      }}
      onChange={(partial) => patch(partial)}
      jobDescription={form.jobDescription}
    />
  );

  if (variant === "open") {
    return (
      <SectionCard title={t("triage_section")} headerExtra={badge}>
        {panel}
      </SectionCard>
    );
  }

  return (
    <CollapsibleCard
      title={(open) =>
        open ? t("triage_toggle_hide") : t("triage_toggle_show")
      }
      badge={badge}
    >
      {panel}
    </CollapsibleCard>
  );
}
