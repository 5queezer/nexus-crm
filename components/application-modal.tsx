"use client";

import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Application } from "@/types";
import {
  createApplication,
  updateApplication,
  type ApplicationFormData,
} from "./application-form/form-data";
import { useApplicationForm } from "./application-form/use-application-form";
import { useContactRows } from "./application-form/use-contact-rows";
import { CoreFieldsSection } from "./application-form/core-fields-section";
import { DetailFieldsSection } from "./application-form/detail-fields-section";
import { NotesField } from "./application-form/notes-field";
import { JobDescriptionSection } from "./application-form/job-description-section";
import { TriageSection } from "./application-form/triage-section";
import { ContactsSection } from "./application-form/contacts-section";
import { DocumentsSection } from "./application-form/documents-section";
import { ResumeSection } from "./application-form/resume-section";

interface ApplicationModalProps {
  application: Application | null;
  onClose: () => void;
  onCreated?: (application: Application) => void;
}

export function ApplicationModal({
  application,
  onClose,
  onCreated,
}: ApplicationModalProps) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const t = useTranslations("modal");
  const ta = useTranslations("actions");
  const isEditing = !!application;

  const { form, handleChange, patch } = useApplicationForm(application);
  const contactRows = useContactRows(
    application?.id ?? null,
    application?.contacts,
  );

  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableSelector =
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
    requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => opener?.focus());
    };
  }, []);

  const createMutation = useMutation({
    mutationFn: createApplication,
    onSuccess: async (newApp) => {
      // save any new contacts to the newly created application before leaving
      await contactRows.persistPending(newApp.id);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      if (onCreated) {
        onCreated(newApp);
        return;
      }
      onClose();
    },
    onError: () => setError(t("error_create")),
  });

  const updateMutation = useMutation({
    mutationFn: (data: ApplicationFormData) =>
      updateApplication(application!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      onClose();
    },
    onError: () => setError(t("error_update")),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.company.trim() || !form.role.trim()) {
      setError(t("required_fields_error"));
      return;
    }

    if (isEditing) {
      updateMutation.mutate(form);
    } else {
      createMutation.mutate(form);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-md sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-modal-title"
        tabIndex={-1}
        className="nexus-scroll w-full max-w-3xl max-h-[95vh] overflow-y-auto rounded-t-[1.75rem] border border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/8 dark:bg-[#0f1011]/95 sm:max-h-[90vh] sm:rounded-[1.75rem]"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-4 backdrop-blur-xl dark:border-white/8 dark:bg-[#0f1011]/90 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              Nexus CRM
            </p>
            <h2
              id="application-modal-title"
              className="pr-2 text-base font-semibold tracking-[-0.02em] text-slate-950 dark:text-[#f7f8f8] sm:text-lg"
            >
              {isEditing ? t("title_edit") : t("title_new")}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label={t("close")}
            className="nexus-target nexus-focus-ring flex shrink-0 items-center justify-center rounded-xl border border-slate-200 text-xl leading-none text-slate-400 transition hover:bg-slate-50 hover:text-slate-700 dark:border-white/8 dark:hover:bg-white/6 dark:hover:text-slate-200"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5 p-4 sm:p-6">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <CoreFieldsSection form={form} onChange={handleChange} />

          <section className="space-y-3">
            <button
              type="button"
              aria-expanded={secondaryOpen}
              onClick={() => setSecondaryOpen((value) => !value)}
              className="nexus-button-ghost nexus-target w-full justify-between lg:hidden"
            >
              <span>{t("secondary_details")}</span>
              <span aria-hidden="true">{secondaryOpen ? "▲" : "▼"}</span>
            </button>
            <div
              className={`${secondaryOpen ? "space-y-5" : "hidden"} lg:block lg:space-y-5`}
            >
              <DetailFieldsSection
                form={form}
                onChange={handleChange}
                patch={patch}
              />
              <NotesField
                value={form.notes}
                onChange={handleChange}
                size="compact"
              />
            </div>
          </section>

          <JobDescriptionSection
            value={form.jobDescription}
            onChange={handleChange}
            applicationId={application?.id ?? null}
          />

          <TriageSection form={form} patch={patch} />

          <ContactsSection state={contactRows} />

          {/* Documents — only when editing */}
          {isEditing && (
            <DocumentsSection
              applicationId={application!.id}
              resumeId={application!.resumeId}
            />
          )}

          {/* Resume — only when editing */}
          {isEditing && (
            <ResumeSection
              applicationId={application!.id}
              resumeId={application!.resumeId}
            />
          )}

          {/* Actions */}
          <div className="nexus-safe-bottom sticky bottom-0 -mx-4 -mb-4 flex gap-3 border-t border-slate-200/80 bg-white/90 p-4 backdrop-blur-xl dark:border-white/8 dark:bg-[#0f1011]/90 sm:-mx-6 sm:-mb-6 sm:p-6">
            <button
              type="button"
              onClick={onClose}
              className="nexus-button-ghost flex-1"
            >
              {ta("cancel")}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="nexus-button-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {ta("saving")}
                </span>
              ) : isEditing ? (
                ta("save")
              ) : (
                ta("add")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
