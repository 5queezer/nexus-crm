"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, Link2 } from "lucide-react";
import { type Application } from "@/types";
import { applicationPath } from "@/lib/applications/slug";
import { frontendCapabilityCommandSchema } from "@/lib/assistant/frontend-capabilities";
import { publishAssistantContext } from "./ai-operator/context";
import { AppHeader } from "./app-header";
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
import { SectionCard } from "./application-form/section-card";
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

interface SubmissionSummary {
  id: string;
  submittedAt: string;
  atsName: string | null;
  requisitionId: string | null;
  documentIds: string[];
}

function SubmissionHistory({ applicationId }: { applicationId: string }) {
  const td = useTranslations("detail");
  const locale = useLocale();
  const submissions = useQuery<SubmissionSummary[]>({
    queryKey: ["application-submissions", applicationId],
    queryFn: async () => {
      const response = await fetch(`/api/applications/${applicationId}/submissions`);
      if (!response.ok) throw new Error("submission_history_failed");
      return response.json() as Promise<SubmissionSummary[]>;
    },
  });

  return (
    <SectionCard title={td("submission_history")}>
      {submissions.isLoading ? (
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          {td("submission_history_loading")}
        </p>
      ) : submissions.isError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {td("submission_history_error")}
        </p>
      ) : !submissions.data?.length ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {td("submission_history_empty")}
        </p>
      ) : (
        <ol className="space-y-3">
          {submissions.data.map((submission) => (
            <li key={submission.id} className="rounded-lg border border-slate-200/80 px-3 py-2.5 text-sm dark:border-white/8">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {submission.atsName || td("submission_destination_unknown")}
                </span>
                <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={submission.submittedAt}>
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(submission.submittedAt))}
                </time>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                {submission.requisitionId && <span>{submission.requisitionId}</span>}
                <span>{submission.documentIds.length} {td("submission_documents")}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

export function ApplicationDetail({ user, application, canonicalPath }: ApplicationDetailProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const requestedTab = searchParams.get("tab");
  const initialTab: DetailTabId = requestedTab === "brief" || requestedTab === "materials"
    ? requestedTab
    : requestedTab === "contacts"
      ? "brief"
      : "activity";
  const [tab, setTab] = useState<DetailTabId>(initialTab);
  const [editing, setEditing] = useState(false);
  // The timeline's record form is opened from the hero, so the page owns it.
  const [recordOpen, setRecordOpen] = useState(false);
  // Tailoring creates the link, so the id has to live here rather than in the
  // server-rendered prop — otherwise every view reading it stays pre-tailor.
  const [resumeId, setResumeId] = useState(application.resumeId);

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

  useEffect(() => {
    publishAssistantContext({
      route: canonicalPath,
      activeRecordId: application.id,
      dirtyEditorIds: hasUnsavedChanges ? [application.id] : [],
      capabilities: ["open_tab", "highlight_field"],
    });
  }, [application.id, canonicalPath, hasUnsavedChanges]);

  useEffect(() => {
    function handleAssistantCapability(event: Event) {
      const parsed = frontendCapabilityCommandSchema.safeParse(
        (event as CustomEvent<unknown>).detail,
      );
      if (!parsed.success) return;
      const command = parsed.data;
      if (
        command.name !== "open_tab" &&
        command.name !== "highlight_field"
      ) return;
      if (command.arguments.applicationId !== application.id) return;

      if (command.name === "open_tab") {
        setTab(command.arguments.tab === "contacts" ? "brief" : command.arguments.tab);
        return;
      }

      setTab("brief");
      setEditing(true);
      requestAnimationFrame(() => {
        const field = Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
            "input[name], select[name], textarea[name]",
          ),
        ).find((candidate) => candidate.name === command.arguments.field);
        field?.scrollIntoView({ block: "center" });
        field?.focus();
      });
    }
    window.addEventListener("nexus:assistant-capability", handleAssistantCapability);
    return () => window.removeEventListener("nexus:assistant-capability", handleAssistantCapability);
  }, [application.id]);

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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setConflict(false);

    // Native validation is turned off on the form, because the browser cannot
    // focus a constrained field that sits in a hidden tab panel — it would
    // just refuse to submit with nothing on screen to explain why. Run the
    // same constraints here instead, reveal the offending field, and let the
    // browser report it in its own words.
    const fields = event.currentTarget.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input, select, textarea");
    const invalid = Array.from(fields).find((field) => !field.checkValidity());
    if (invalid) {
      setTab("brief");
      setEditing(true);
      requestAnimationFrame(() => {
        invalid.reportValidity();
      });
      return;
    }

    // `required` accepts whitespace, so the trimmed check still has a job.
    if (!form.company.trim() || !form.role.trim()) {
      setTab("brief");
      setEditing(true);
      setError(tm("required_fields_error"));
      return;
    }

    updateMutation.mutate({ data: form, expectedUpdatedAt: baselineUpdatedAt });
  }

  function handleToggleEdit() {
    if (editing) {
      // Closing over unsaved work would hide the only Save and Cancel while
      // the leave guard stays armed, so finishing requires resolving it first.
      if (hasUnsavedChanges) return;
      setEditing(false);
      return;
    }
    // Editing always happens in the Brief tab, so opening the editor from the
    // hero has to bring that tab along.
    setTab("brief");
    setEditing(true);
  }

  function handleRecordActivity() {
    setTab("activity");
    setRecordOpen(true);
  }

  function handleCancelEdit() {
    // A discard mid-flight would restore the old baseline, and the save's
    // success handler would then set the baseline to the submitted draft —
    // leaving the page dirty and stale despite the server accepting it.
    if (isPending) return;
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
    <div className="nexus-shell">
      <AppHeader
        user={user}
        onBeforeLogout={
          hasUnsavedChanges ? () => window.confirm(td("leave_confirm")) : undefined
        }
      />
      <main className="nexus-page-bottom-space mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <DetailHero
          application={displayApplication}
          company={company}
          role={role}
          status={form.status}
          editing={editing}
          onToggleEdit={handleToggleEdit}
          closeDisabled={hasUnsavedChanges}
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
                  {resumeId ? td("resume_linked") : td("no_resume")}
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
                        disabled={isPending}
                        className="nexus-button-ghost min-h-10 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
                <RailSection title={td("stack")}>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {td("stack_not_recorded")}
                  </p>
                </RailSection>
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
              resumeId={resumeId}
              variant="open"
            />
            <SubmissionHistory applicationId={application.id} />
            <ResumeSection
              applicationId={application.id}
              resumeId={resumeId}
              variant="open"
              onApplicationUpdated={refreshBaselineUpdatedAt}
              onResumeLinked={setResumeId}
            />
          </section>

          {/* Mobile action bar: the desktop editor row is out of reach on a
              phone, so the primary action of the current mode lives here. */}
          <div className="nexus-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 px-4 pt-3 backdrop-blur-xl dark:border-white/8 dark:bg-[#0f1011]/90 lg:hidden">
            <div className="flex gap-3">
              {editing ? (
                <>
                  {/* Discarding has to be reachable here: the editor's own
                      Cancel sits in a row that only exists from `lg` up. */}
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={isPending}
                    className="nexus-button-ghost flex-1 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ta("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={!formDirty || isPending}
                    className="nexus-button-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saveLabel}
                  </button>
                </>
              ) : (
                <>
                  <Link href="/" className="nexus-button-ghost flex-1">
                    {td("back")}
                  </Link>
                  <button
                    type="button"
                    onClick={handleToggleEdit}
                    className="nexus-button-primary flex-1"
                  >
                    {td("edit")}
                  </button>
                </>
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
    </div>
  );
}
