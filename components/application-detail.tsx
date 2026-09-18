"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Link2 } from "lucide-react";
import { type Application } from "@/types";
import { applicationPath } from "@/lib/applications/slug";
import { AppShell } from "./app-shell";
import {
  updateApplication,
  UpdateConflictError,
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
import { ApplicationTimeline } from "./application-timeline";
import { DetailHero, formatLocations, formatSalary } from "./application-detail/detail-hero";
import { NowBanner } from "./application-detail/now-banner";
import { DetailTabs } from "./application-detail/detail-tabs";
import { DetailRail, RailProperties, RailSection } from "./application-detail/detail-rail";

type DetailTabId = "activity" | "brief" | "materials";

interface ApplicationDetailProps {
  user: {
    id: string;
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin: boolean;
  };
  application: Application;
  canonicalPath: string;
}

function EditorPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-white/8 dark:bg-white/[0.03]">
      <h3 className="mb-3 text-sm font-semibold text-slate-950 dark:text-[#f7f8f8]">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ApplicationDetail({ user, application, canonicalPath }: ApplicationDetailProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const td = useTranslations("detail");
  const ta = useTranslations("actions");
  const ts = useTranslations("status");
  const tm = useTranslations("modal");
  const tn = useTranslations("nav");

  const {
    form,
    handleChange,
    patch,
    isDirty: formDirty,
    baselineUpdatedAt,
    markSaved,
    discardChanges,
    refreshBaselineUpdatedAt,
  } = useApplicationForm(application);
  const contactRows = useContactRows(application.id, application.contacts);
  // Contact rows persist individually; unsaved row edits must still guard
  // navigation even when the application form itself is clean.
  const hasUnsavedChanges = formDirty || contactRows.hasDirtyRows;

  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [copied, setCopied] = useState(false);
  const [displayApplication, setDisplayApplication] = useState(application);
  const [tab, setTab] = useState<DetailTabId>("activity");
  const [editing, setEditing] = useState(false);
  // The timeline's record form is opened from the hero, so the page owns it.
  const [recordOpen, setRecordOpen] = useState(false);

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
      setDisplayApplication(saved);
      setConflict(false);
      setError(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      const nextPath = applicationPath(saved);
      if (nextPath !== canonicalPath) router.replace(nextPath);
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
  // no route-change blocker, so intercept clicks on internal links (sidebar,
  // breadcrumbs, back links, mobile sheet) while anything is unsaved.
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

  // Veto browser Back/Forward while dirty: the app router treats those as
  // client-side history navigation, so neither beforeunload nor the click
  // guard fires. Listening in the capture phase lets us decline before
  // Next's own popstate handler and re-push the detail URL.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function handlePopState(event: PopStateEvent) {
      if (window.confirm(td("leave_confirm"))) return;
      event.stopImmediatePropagation();
      window.history.pushState(null, "", canonicalPath);
    }
    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, [hasUnsavedChanges, td, canonicalPath]);

  async function handleCopyLink() {
    const absoluteUrl = new URL(canonicalPath, window.location.origin).toString();
    try {
      await window.navigator.clipboard.writeText(absoluteUrl);
    } catch {
      const input = document.createElement("textarea");
      input.value = absoluteUrl;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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

  function handleToggleEdit() {
    // Editing always happens in the Brief tab, so opening the editor from the
    // hero has to bring that tab along.
    setEditing((value) => {
      if (!value) setTab("brief");
      return !value;
    });
  }

  function handleRecordActivity() {
    setTab("activity");
    setRecordOpen(true);
  }

  function handleCancelEdit() {
    discardChanges();
    // Contact rows persist individually, so a dirty row is not covered by the
    // discard above. Keeping the editor open leaves it visible and savable
    // rather than stranding the user behind the leave guard with no editor.
    if (!contactRows.hasDirtyRows) setEditing(false);
  }

  function handleContactSelect(contactId: string) {
    // Click handlers flush synchronously, so the Brief panel is out of its
    // hidden state by the next frame and the anchor is scrollable.
    setTab("brief");
    const anchor = `contact-${encodeURIComponent(contactId)}`;
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ block: "center" });
    });
  }

  const saveLabel = isPending ? ta("saving") : ta("save");
  const company = form.company || application.company;
  const role = form.role || application.role;
  const primaryContact = contactRows.contacts.find((contact) => contact.name.trim());
  const locations = formatLocations(displayApplication);
  const salary = formatSalary(displayApplication);

  const optionalRows: [string, string][] = [
    displayApplication.travelPercent != null
      ? [td("travel"), `${displayApplication.travelPercent}%`]
      : null,
    displayApplication.timezoneOverlap
      ? [td("timezone_overlap"), displayApplication.timezoneOverlap]
      : null,
  ].filter((row): row is [string, string] => row !== null);

  // These are extracted, read-only facts with no field in the editor, so the
  // rail is the only place they surface.
  const recordRows: [string, string][] = [
    [tm("source"), form.source || "—"],
    [td("work_model"), displayApplication.workMode || (form.remote ? td("remote") : "—")],
    [td("locations"), locations || "—"],
    [td("salary"), salary || "—"],
    ...optionalRows,
    [tm("rating"), form.rating ? `${form.rating}/5` : td("not_rated")],
  ];

  return (
    <AppShell
      user={user}
      breadcrumbs={[
        { label: tn("opportunities"), href: "/" },
        { label: company },
      ]}
      onBeforeLogout={
        hasUnsavedChanges ? () => window.confirm(td("leave_confirm")) : undefined
      }
    >
      <main className="nexus-page-bottom-space mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <DetailHero
          application={displayApplication}
          company={company}
          role={role}
          status={form.status}
          editing={editing}
          onToggleEdit={handleToggleEdit}
          onRecordActivity={handleRecordActivity}
          recordDisabled={hasUnsavedChanges}
        />

        <NowBanner application={displayApplication} statusLabel={ts(form.status)} />

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
          >
            {error}
          </div>
        )}
        {conflict && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
          >
            {td("error_conflict")}
          </div>
        )}

        <DetailTabs
          label={td("sections")}
          active={tab}
          onSelect={(id) => setTab(id as DetailTabId)}
          tabs={[
            { id: "activity", label: td("tab_activity") },
            { id: "brief", label: td("tab_brief") },
            { id: "materials", label: td("tab_materials") },
          ]}
        />

        {/* Activity lives outside the record form: the timeline carries its
            own form for recording events, and forms cannot nest. */}
        <section
          id="application-activity-panel"
          role="tabpanel"
          aria-labelledby="application-activity-tab"
          hidden={tab !== "activity"}
          className="pt-6"
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]">
            <ApplicationTimeline
              applicationId={application.id}
              expectedUpdatedAt={baselineUpdatedAt}
              disabled={hasUnsavedChanges}
              recordOpen={recordOpen}
              onRecordOpenChange={setRecordOpen}
              onContactSelect={handleContactSelect}
              onProjectionUpdated={() => window.location.reload()}
            />
            <DetailRail label={td("context")}>
              <RailSection title={td("in_brief")}>
                {displayApplication.jobSummary || form.notes ? (
                  <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-6 text-slate-500 dark:text-slate-400">
                    {displayApplication.jobSummary || form.notes}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{td("no_brief")}</p>
                )}
                <button
                  type="button"
                  onClick={() => setTab("brief")}
                  className="nexus-focus-ring inline-flex items-center gap-1.5 rounded pt-1 text-xs text-indigo-600 dark:text-[#a5a1ff]"
                >
                  {td("read_brief")}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </RailSection>

              {primaryContact && (
                <RailSection kicker={tm("contacts_section")}>
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    {primaryContact.name}
                  </p>
                  {primaryContact.role && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {primaryContact.role}
                    </p>
                  )}
                </RailSection>
              )}

              <RailSection kicker={td("latest_material")}>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {application.resumeId ? td("resume_linked") : td("no_resume")}
                </p>
                <button
                  type="button"
                  onClick={() => setTab("materials")}
                  className="nexus-focus-ring inline-flex items-center gap-1.5 rounded pt-1 text-xs text-indigo-600 dark:text-[#a5a1ff]"
                >
                  {td("view_materials")}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </RailSection>
            </DetailRail>
          </div>
        </section>

        <form onSubmit={handleSubmit} noValidate>
          <section
            id="application-brief-panel"
            role="tabpanel"
            aria-labelledby="application-brief-tab"
            hidden={tab !== "brief"}
            className="pt-6"
          >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="min-w-0 space-y-5">
                {displayApplication.jobSummary && (
                  <div className="rounded-lg bg-slate-100/70 px-4 py-3 dark:bg-white/[0.04]">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {td("compact_summary")}
                    </h3>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {displayApplication.jobSummary}
                    </p>
                  </div>
                )}
                {editing ? (
                  <>
                    <EditorPanel title={td("section_details")}>
                      <div className="space-y-5">
                        <CoreFieldsSection form={form} onChange={handleChange} lifecycleDisabled />
                        <DetailFieldsSection
                          form={form}
                          onChange={handleChange}
                          patch={patch}
                          lifecycleDisabled
                        />
                      </div>
                    </EditorPanel>
                    <EditorPanel title={tm("summary")}>
                      <NotesField
                        value={form.notes}
                        onChange={handleChange}
                        size="large"
                        showLabel={false}
                      />
                    </EditorPanel>
                    <JobDescriptionSection
                      value={form.jobDescription}
                      onChange={handleChange}
                      applicationId={application.id}
                      variant="open"
                    />
                    <TriageSection form={form} patch={patch} variant="open" />
                    <div id="contacts">
                      <ContactsSection state={contactRows} variant="open" />
                    </div>
                    <div className="hidden items-center justify-end gap-3 lg:flex">
                      <span
                        aria-live="polite"
                        className={`text-xs font-medium ${
                          savedFlash && !hasUnsavedChanges
                            ? "text-green-600 dark:text-green-400"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {hasUnsavedChanges ? td("unsaved") : savedFlash ? td("saved") : null}
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="nexus-button-ghost min-h-10 py-2 text-sm"
                      >
                        {ta("cancel")}
                      </button>
                      <button
                        type="submit"
                        disabled={!formDirty || isPending}
                        className="nexus-button-primary min-h-10 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saveLabel}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h2 className="text-[15px] font-semibold text-slate-950 dark:text-[#f7f8f8]">
                        {td("working_brief")}
                      </h2>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600 dark:text-slate-300">
                        {form.notes || td("no_brief")}
                      </p>
                    </div>
                    <details className="border-t border-slate-200/80 pt-4 dark:border-white/8">
                      <summary className="nexus-focus-ring cursor-pointer rounded text-sm text-slate-800 dark:text-slate-200">
                        {tm("job_description")}
                      </summary>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {form.jobDescription || td("no_job_description")}
                      </p>
                    </details>
                    <details className="border-t border-slate-200/80 pt-4 dark:border-white/8">
                      <summary className="nexus-focus-ring cursor-pointer rounded text-sm text-slate-800 dark:text-slate-200">
                        {tm("triage_section")}
                      </summary>
                      <div className="mt-3">
                        <RailProperties
                          rows={[
                            [tm("triage_quality"), form.triageQuality ? `${form.triageQuality}/5` : td("not_rated")],
                            [tm("incoming_source"), form.incomingSource || "—"],
                            [tm("triage_reason"), form.triageReason || "—"],
                          ]}
                        />
                      </div>
                    </details>
                  </>
                )}
              </div>

              <DetailRail label={td("context")}>
                <RailSection title={td("record_details")}>
                  <RailProperties rows={recordRows} />
                </RailSection>
                {!editing && (
                  <RailSection kicker={tm("contacts_section")}>
                    {contactRows.contacts.filter((contact) => contact.name.trim()).length > 0 ? (
                      <ul className="space-y-2 text-xs">
                        {contactRows.contacts
                          .filter((contact) => contact.name.trim())
                          .map((contact) => (
                            <li
                              key={contact.clientId}
                              id={contact.id ? `contact-${encodeURIComponent(contact.id)}` : undefined}
                              className="scroll-mt-6"
                            >
                              <span className="block text-slate-800 dark:text-slate-200">
                                {contact.name}
                              </span>
                              {contact.role && (
                                <span className="block text-slate-500 dark:text-slate-400">
                                  {contact.role}
                                </span>
                              )}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {td("no_contacts")}
                      </p>
                    )}
                  </RailSection>
                )}
              </DetailRail>
            </div>
          </section>

          <section
            id="application-materials-panel"
            role="tabpanel"
            aria-labelledby="application-materials-tab"
            hidden={tab !== "materials"}
            className="space-y-5 pt-6"
          >
            <DocumentsSection
              applicationId={application.id}
              resumeId={application.resumeId}
              variant="open"
            />
            <ResumeSection
              applicationId={application.id}
              resumeId={application.resumeId}
              variant="open"
              onApplicationUpdated={refreshBaselineUpdatedAt}
            />
          </section>

          {/* Mobile action bar: the desktop editor row is out of reach on a
              phone, so the primary action of the current mode lives here. */}
          <div className="nexus-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 px-4 pt-3 backdrop-blur-xl dark:border-white/8 dark:bg-[#0f1011]/90 lg:hidden">
            <div className="flex gap-3">
              <Link href="/" className="nexus-button-ghost flex-1">
                {td("back")}
              </Link>
              {editing ? (
                <button
                  type="submit"
                  disabled={!formDirty || isPending}
                  className="nexus-button-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveLabel}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleToggleEdit}
                  className="nexus-button-primary flex-1"
                >
                  {td("edit")}
                </button>
              )}
            </div>
          </div>
        </form>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4 text-[11px] text-slate-500 dark:border-white/8 dark:text-slate-400">
          <span aria-live="polite">
            {hasUnsavedChanges ? td("unsaved") : savedFlash ? td("saved") : td("up_to_date")}
          </span>
          <button
            type="button"
            onClick={handleCopyLink}
            className="nexus-focus-ring inline-flex items-center gap-1.5 rounded text-[11px] transition hover:text-slate-900 dark:hover:text-white"
            aria-label={td("copy_link")}
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            {copied ? td("link_copied") : td("copy_link")}
          </button>
        </footer>
      </main>
    </AppShell>
  );
}
