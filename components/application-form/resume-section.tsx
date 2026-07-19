"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { openExternalUrl } from "@/lib/external-url";
import { CollapsibleCard, SectionCard } from "./section-card";

interface TailoredResume {
  resumeId: string;
  editUrl: string;
}

export function ResumeSection({
  applicationId,
  resumeId,
  variant = "collapsible",
}: {
  applicationId: string;
  resumeId: string | null;
  variant?: "collapsible" | "open";
}) {
  const t = useTranslations("modal");
  const queryClient = useQueryClient();
  const [tailoring, setTailoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tailoredResume, setTailoredResume] = useState<TailoredResume | null>(
    null,
  );

  useEffect(() => {
    if (!resumeId || tailoredResume) return;
    let cancelled = false;
    fetch(`/api/applications/${applicationId}/tailor`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load resume");
        return (await response.json()) as TailoredResume;
      })
      .then((resume) => {
        if (!cancelled) setTailoredResume(resume);
      })
      .catch(() => {
        if (!cancelled) setError(t("resume_error"));
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, resumeId, t, tailoredResume]);

  async function handleTailor() {
    setError(null);
    setTailoring(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/tailor`, {
        method: "POST",
      });
      if (res.status === 501) {
        setError(t("resume_not_configured"));
        return;
      }
      if (!res.ok) {
        setError(t("resume_error"));
        return;
      }
      const resume = (await res.json()) as TailoredResume;
      setTailoredResume(resume);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    } catch {
      setError(t("resume_error"));
    } finally {
      setTailoring(false);
    }
  }

  const body = (
    <>
      {error && (
        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400">
          {error}
        </div>
      )}
      {resumeId || tailoredResume ? (
        <ResumeLink editUrl={tailoredResume?.editUrl ?? null} />
      ) : (
        <button
          type="button"
          onClick={handleTailor}
          disabled={tailoring}
          className="w-full rounded-xl border border-dashed border-indigo-300 py-2.5 text-sm font-medium text-indigo-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-600 dark:text-indigo-400 dark:hover:border-indigo-500 dark:hover:bg-indigo-950/30"
        >
          {tailoring ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400/40 border-t-indigo-600 dark:border-t-indigo-400" />
              {t("resume_tailoring")}
            </span>
          ) : (
            t("resume_tailor")
          )}
        </button>
      )}
    </>
  );

  if (variant === "open") {
    return <SectionCard title={t("resume_section")}>{body}</SectionCard>;
  }

  return <CollapsibleCard title={t("resume_section")}>{body}</CollapsibleCard>;
}

function ResumeLink({ editUrl }: { editUrl: string | null }) {
  const t = useTranslations("modal");

  return (
    <button
      type="button"
      disabled={!editUrl}
      onClick={() => openExternalUrl(editUrl)}
      className="nexus-target flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 py-2.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/50"
    >
      {t("resume_open")}
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </button>
  );
}
