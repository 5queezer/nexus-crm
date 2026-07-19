"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { STATUS_COLORS, type Application } from "@/types";
import { AppHeader } from "./app-header";
import {
  updateApplication,
  UpdateConflictError,
  type ApplicationFormData,
} from "./application-form/form-data";
import { useApplicationForm } from "./application-form/use-application-form";
import { useContactRows } from "./application-form/use-contact-rows";
import { SectionCard } from "./application-form/section-card";
import { CoreFieldsSection } from "./application-form/core-fields-section";
import { DetailFieldsSection } from "./application-form/detail-fields-section";
import { NotesField } from "./application-form/notes-field";
import { JobDescriptionSection } from "./application-form/job-description-section";
import { TriageSection } from "./application-form/triage-section";
import { ContactsSection } from "./application-form/contacts-section";
import { DocumentsSection } from "./application-form/documents-section";
import { ResumeSection } from "./application-form/resume-section";

interface ApplicationDetailProps {
  user: {
    id: string;
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin: boolean;
  };
  application: Application;
}

export function ApplicationDetail({ user, application }: ApplicationDetailProps) {
  const queryClient = useQueryClient();
  const td = useTranslations("detail");
  const ta = useTranslations("actions");
  const ts = useTranslations("status");
  const tm = useTranslations("modal");

  const {
    form,
    handleChange,
    patch,
    isDirty: formDirty,
    baselineUpdatedAt,
    markSaved,
  } = useApplicationForm(application);
  const contactRows = useContactRows(application.id, application.contacts);
  // Contact rows persist individually; unsaved row edits must still guard
  // navigation even when the application form itself is clean.
  const hasUnsavedChanges = formDirty || contactRows.hasDirtyRows;

  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const updateMutation = useMutation({
    mutationFn: ({
      data,
      expectedUpdatedAt,
    }: {
      data: ApplicationFormData;
      expectedUpdatedAt: string | null;
    }) => updateApplication(application.id, data, expectedUpdatedAt),
    onSuccess: (saved, variables) => {
      // Renew the baseline so the next save sends the fresh updatedAt —
      // otherwise every subsequent PATCH would answer with 409.
      markSaved(saved, variables.data);
      setConflict(false);
      setError(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
    onError: (mutationError) => {
      if (mutationError instanceof UpdateConflictError) {
        setConflict(true);
      } else {
        setError(tm("error_update"));
      }
    },
  });

  const isPending = updateMutation.isPending;

  // Warn before closing/reloading the tab while edits are unsaved.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function handler(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  // Centralized leave guard for client-side navigation: the app router has
  // no route-change blocker, so intercept clicks on internal links (header
  // nav, back links, mobile sheet) while anything is unsaved.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function handleClick(event: MouseEvent) {
      const anchor = (event.target as HTMLElement | null)
        ?.closest?.("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      if (!window.confirm(td("leave_confirm"))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [hasUnsavedChanges, td]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setConflict(false);

    if (!form.company.trim() || !form.role.trim()) {
      setError(tm("required_fields_error"));
      return;
    }

    updateMutation.mutate({ data: form, expectedUpdatedAt: baselineUpdatedAt });
  }

  const saveLabel = isPending ? ta("saving") : ta("save");

  return (
    <div className="nexus-shell">
      <AppHeader user={user} />
      <main className="nexus-page-bottom-space mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <form onSubmit={handleSubmit}>
          {/* Title row — sticky on desktop, plain flow on mobile */}
          <div className="z-20 -mx-4 mb-5 border-b border-slate-200/80 bg-slate-50/90 px-4 py-3 backdrop-blur-xl dark:border-white/8 dark:bg-[#08090a]/90 sm:-mx-6 sm:px-6 lg:sticky lg:top-16 lg:-mx-8 lg:px-8">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="nexus-button-ghost nexus-target shrink-0"
              >
                ← {td("back")}
              </Link>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-slate-950 dark:text-[#f7f8f8] sm:text-xl">
                  {form.company || application.company} —{" "}
                  {form.role || application.role}
                </h1>
              </div>
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[form.status]}`}
              >
                {ts(form.status)}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  aria-live="polite"
                  className={`text-xs font-medium ${
                    savedFlash && !hasUnsavedChanges
                      ? "text-green-600 dark:text-green-400"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {hasUnsavedChanges
                    ? td("unsaved")
                    : savedFlash
                      ? td("saved")
                      : null}
                </span>
                <button
                  type="submit"
                  disabled={!formDirty || isPending}
                  className="nexus-button-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveLabel}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
            >
              {error}
            </div>
          )}
          {conflict && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
            >
              {td("error_conflict")}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
            <SectionCard title={td("section_details")}>
              <div className="space-y-5">
                <CoreFieldsSection form={form} onChange={handleChange} />
                <DetailFieldsSection
                  form={form}
                  onChange={handleChange}
                  patch={patch}
                />
              </div>
            </SectionCard>
            <div className="space-y-5">
              <SectionCard title={tm("notes")}>
                <NotesField
                  value={form.notes}
                  onChange={handleChange}
                  size="large"
                  showLabel={false}
                />
              </SectionCard>
              <JobDescriptionSection
                value={form.jobDescription}
                onChange={handleChange}
                applicationId={application.id}
                variant="open"
              />
            </div>
          </div>

          <div className="mt-5 space-y-5">
            <TriageSection form={form} patch={patch} variant="open" />
            <ContactsSection state={contactRows} variant="open" />
            <DocumentsSection
              applicationId={application.id}
              resumeId={application.resumeId}
              variant="open"
            />
            <ResumeSection
              applicationId={application.id}
              resumeId={application.resumeId}
              variant="open"
            />
          </div>

          {/* Mobile save bar */}
          <div className="nexus-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 px-4 pt-3 backdrop-blur-xl dark:border-white/8 dark:bg-[#0f1011]/90 lg:hidden">
            <div className="flex gap-3">
              <Link href="/" className="nexus-button-ghost flex-1">
                {td("back")}
              </Link>
              <button
                type="submit"
                disabled={!formDirty || isPending}
                className="nexus-button-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveLabel}
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
