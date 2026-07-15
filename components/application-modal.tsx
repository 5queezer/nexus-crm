"use client";

import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Application,
  ApplicationStatus,
  Contact,
  CompanySize,
  IncomingSource,
  STATUS_ORDER,
  SOURCE_PRESETS,
  TRIAGE_COLORS,
} from "@/types";
import { toDateInputValue } from "@/lib/applications/defaults";
import { toLocalCalendarInputValue } from "@/lib/applications/local-calendar";
import { TriagePanel } from "./triage-panel";
import { openExternalUrl } from "@/lib/external-url";

interface ApplicationModalProps {
  application: Application | null;
  onClose: () => void;
}

interface FormData {
  company: string;
  role: string;
  status: ApplicationStatus;
  appliedAt: string;
  lastContact: string;
  followUpAt: string;
  notes: string;
  jobDescription: string;
  source: string;
  remote: boolean;
  salaryMin: string;
  salaryMax: string;
  rating: number | null;
  jobUrl: string;
  companySize: CompanySize | "";
  salaryBandMentioned: boolean;
  triageQuality: number | null;
  triageReason: string;
  incomingSource: IncomingSource | "";
  autoRejected: boolean;
  autoRejectReason: string;
}

interface ContactFormRow {
  id?: string; // set when persisted
  name: string;
  email: string;
  role: string;
  linkedIn: string;
  isDirty: boolean;
  isNew: boolean;
}

function serializeForm(data: FormData) {
  return {
    ...data,
    appliedAt: data.appliedAt || null,
    lastContact: data.lastContact || null,
    followUpAt: data.followUpAt || null,
    notes: data.notes || null,
    jobDescription: data.jobDescription || null,
    source: data.source || null,
    salaryMin: data.salaryMin ? parseInt(data.salaryMin, 10) : null,
    salaryMax: data.salaryMax ? parseInt(data.salaryMax, 10) : null,
    rating: data.rating,
    jobUrl: data.jobUrl || null,
    companySize: data.companySize || null,
    salaryBandMentioned: data.salaryBandMentioned,
    triageQuality: data.triageQuality,
    triageReason: data.triageReason || null,
    incomingSource: data.incomingSource || null,
    autoRejected: data.autoRejected,
    autoRejectReason: data.autoRejectReason || null,
  };
}

async function createApplication(data: FormData): Promise<Application> {
  const res = await fetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializeForm(data)),
  });
  if (!res.ok) throw new Error("Failed to create application");
  return res.json();
}

async function updateApplication(
  id: string,
  data: FormData,
): Promise<Application> {
  const res = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializeForm(data)),
  });
  if (!res.ok) throw new Error("Failed to update application");
  return res.json();
}

async function createContact(
  applicationId: string,
  contact: Omit<ContactFormRow, "isDirty" | "isNew" | "id">,
): Promise<Contact> {
  const res = await fetch(`/api/applications/${applicationId}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contact),
  });
  if (!res.ok) throw new Error("Failed to create contact");
  return res.json();
}

async function updateContact(
  applicationId: string,
  contactId: string,
  contact: Partial<ContactFormRow>,
): Promise<Contact> {
  const res = await fetch(
    `/api/applications/${applicationId}/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contact),
    },
  );
  if (!res.ok) throw new Error("Failed to update contact");
  return res.json();
}

async function deleteContact(
  applicationId: string,
  contactId: string,
): Promise<void> {
  const res = await fetch(
    `/api/applications/${applicationId}/contacts/${contactId}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) throw new Error("Failed to delete contact");
}

function toDateInput(dateStr: string | null | undefined): string {
  return toLocalCalendarInputValue(dateStr);
}

function contactToRow(c: Contact): ContactFormRow {
  return {
    id: c.id,
    name: c.name,
    email: c.email || "",
    role: c.role || "",
    linkedIn: c.linkedIn || "",
    isDirty: false,
    isNew: false,
  };
}

interface JobUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  editLabel: string;
  saveLabel: string;
}

export function JobUrlField({
  value,
  onChange,
  label,
  placeholder,
  editLabel,
  saveLabel,
}: JobUrlFieldProps) {
  const [isEditing, setIsEditing] = useState(!value);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {!isEditing && value ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openExternalUrl(value)}
            title={value}
            className="nexus-target min-w-0 flex-1 truncate rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-left text-sm font-medium text-indigo-600 shadow-sm transition hover:bg-indigo-50 hover:underline dark:border-white/8 dark:bg-white/4 dark:text-[#828fff] dark:hover:bg-white/6"
          >
            {value}
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="nexus-button-ghost shrink-0"
          >
            {editLabel}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="url"
            name="jobUrl"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="nexus-input"
            placeholder={placeholder}
          />
          {value && (
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="nexus-button-ghost shrink-0"
            >
              {saveLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ApplicationModal({
  application,
  onClose,
}: ApplicationModalProps) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const t = useTranslations("modal");
  const ts = useTranslations("status");
  const ta = useTranslations("actions");
  const locale = useLocale();
  const isEditing = !!application;

  const [form, setForm] = useState<FormData>({
    company: application?.company || "",
    role: application?.role || "",
    status: (application?.status as ApplicationStatus) || "inbound",
    appliedAt:
      toDateInput(application?.appliedAt) ||
      (application ? "" : toDateInputValue()),
    lastContact: toDateInput(application?.lastContact),
    followUpAt: toDateInput(application?.followUpAt),
    notes: application?.notes || "",
    jobDescription: application?.jobDescription || "",
    source: application?.source || "",
    remote: application?.remote ?? false,
    salaryMin:
      application?.salaryMin != null ? String(application.salaryMin) : "",
    salaryMax:
      application?.salaryMax != null ? String(application.salaryMax) : "",
    rating: application?.rating ?? null,
    jobUrl: application?.jobUrl || "",
    companySize: (application?.companySize as CompanySize) || "",
    salaryBandMentioned: application?.salaryBandMentioned ?? false,
    triageQuality: application?.triageQuality ?? null,
    triageReason: application?.triageReason || "",
    incomingSource: (application?.incomingSource as IncomingSource) || "",
    autoRejected: application?.autoRejected ?? false,
    autoRejectReason: application?.autoRejectReason || "",
  });

  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [jdOpen, setJdOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  // Contacts state – pre-filled from application if editing
  const [contacts, setContacts] = useState<ContactFormRow[]>(() =>
    (application?.contacts ?? []).map(contactToRow),
  );
  const [savingContactIdx, setSavingContactIdx] = useState<number | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(
    null,
  );

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
      // save any new contacts to newly created application
      await Promise.all(
        contacts
          .filter((c) => c.isNew && c.name.trim())
          .map((c) =>
            createContact(newApp.id, {
              name: c.name,
              email: c.email,
              role: c.role,
              linkedIn: c.linkedIn,
            }),
          ),
      );
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      onClose();
    },
    onError: () => setError(t("error_create")),
  });

  const updateMutation = useMutation({
    mutationFn: (data: FormData) => updateApplication(application!.id, data),
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

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleContactChange(
    idx: number,
    field: keyof ContactFormRow,
    value: string,
  ) {
    setContacts((prev) =>
      prev.map((c, i) =>
        i === idx ? { ...c, [field]: value, isDirty: true } : c,
      ),
    );
  }

  function addContactRow() {
    setContacts((prev) => [
      ...prev,
      {
        name: "",
        email: "",
        role: "",
        linkedIn: "",
        isDirty: true,
        isNew: true,
      },
    ]);
  }

  async function saveContact(idx: number) {
    const c = contacts[idx];
    if (!c.name.trim()) return;
    setContactError(null);
    setSavingContactIdx(idx);
    try {
      if (c.isNew) {
        if (!isEditing) {
          // Will be saved after application creation; just mark not dirty
          setContacts((prev) =>
            prev.map((row, i) =>
              i === idx ? { ...row, isDirty: false } : row,
            ),
          );
          return;
        }
        const saved = await createContact(application!.id, {
          name: c.name,
          email: c.email,
          role: c.role,
          linkedIn: c.linkedIn,
        });
        setContacts((prev) =>
          prev.map((row, i) =>
            i === idx
              ? { ...row, id: saved.id, isDirty: false, isNew: false }
              : row,
          ),
        );
        queryClient.invalidateQueries({ queryKey: ["applications"] });
      } else if (c.id) {
        await updateContact(application!.id, c.id, {
          name: c.name,
          email: c.email,
          role: c.role,
          linkedIn: c.linkedIn,
        });
        setContacts((prev) =>
          prev.map((row, i) => (i === idx ? { ...row, isDirty: false } : row)),
        );
        queryClient.invalidateQueries({ queryKey: ["applications"] });
      }
    } catch {
      setContactError(t("error_contact"));
    } finally {
      setSavingContactIdx(null);
    }
  }

  async function removeContact(idx: number) {
    const c = contacts[idx];
    setContactError(null);
    if (c.isNew || !c.id) {
      setContacts((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    setDeletingContactId(c.id);
    try {
      await deleteContact(application!.id, c.id);
      setContacts((prev) => prev.filter((_, i) => i !== idx));
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    } catch {
      setContactError(t("error_contact"));
    } finally {
      setDeletingContactId(null);
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("company")}{" "}
                <span className="text-red-500">{t("required")}</span>
              </label>
              <input
                type="text"
                name="company"
                value={form.company}
                onChange={handleChange}
                required
                className="nexus-input"
                placeholder={t("company_placeholder")}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("role")}{" "}
                <span className="text-red-500">{t("required")}</span>
              </label>
              <input
                type="text"
                name="role"
                value={form.role}
                onChange={handleChange}
                required
                className="nexus-input"
                placeholder={t("role_placeholder")}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("status")}
            </label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="nexus-input"
            >
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {ts(value)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              🔔 {t("follow_up")}
            </label>
            <input
              type="date"
              name="followUpAt"
              value={form.followUpAt}
              onChange={handleChange}
              lang={locale}
              className="nexus-input"
            />
          </div>

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
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t("source")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    name="source"
                    value={form.source}
                    onChange={handleChange}
                    list="source-presets"
                    className="nexus-input"
                    placeholder={t("source_placeholder")}
                  />
                  <datalist id="source-presets">
                    {SOURCE_PRESETS.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              </div>

              <JobUrlField
                value={form.jobUrl}
                onChange={(value) =>
                  setForm((prev) => ({ ...prev, jobUrl: value }))
                }
                label={t("job_url")}
                placeholder={t("job_url_placeholder")}
                editLabel={ta("edit")}
                saveLabel={ta("save")}
              />

              <div>
                <label className="nexus-target flex w-fit cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.remote}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, remote: e.target.checked }))
                    }
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:bg-gray-700"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("remote")}
                  </span>
                </label>
              </div>

              {/* Salary range */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t("salary_range")}
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="number"
                    name="salaryMin"
                    value={form.salaryMin}
                    onChange={handleChange}
                    min={0}
                    step={1000}
                    placeholder={t("salary_min_placeholder")}
                    className="nexus-input"
                  />
                  <span className="hidden sm:block text-gray-400 text-sm shrink-0">
                    –
                  </span>
                  <input
                    type="number"
                    name="salaryMax"
                    value={form.salaryMax}
                    onChange={handleChange}
                    min={0}
                    step={1000}
                    placeholder={t("salary_max_placeholder")}
                    className="nexus-input"
                  />
                </div>
              </div>

              {/* Suitability rating */}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t("rating")}
                </label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          rating: prev.rating === star ? null : star,
                        }))
                      }
                      className={`nexus-target inline-flex items-center justify-center text-2xl leading-none transition-colors ${
                        (form.rating ?? 0) >= star
                          ? "text-yellow-400 hover:text-yellow-500"
                          : "text-gray-300 dark:text-gray-600 hover:text-yellow-300"
                      }`}
                      title={`${star} / 5`}
                    >
                      ★
                    </button>
                  ))}
                  {form.rating && (
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                      {form.rating}/5
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("applied_at")}
                  </label>
                  <input
                    type="date"
                    name="appliedAt"
                    value={form.appliedAt}
                    onChange={handleChange}
                    lang={locale}
                    className="nexus-input"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t("last_contact")}
                  </label>
                  <input
                    type="date"
                    name="lastContact"
                    value={form.lastContact}
                    onChange={handleChange}
                    lang={locale}
                    className="nexus-input"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t("notes")}
                </label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  rows={3}
                  className="nexus-input resize-none"
                  placeholder={t("notes_placeholder")}
                />
              </div>
            </div>
          </section>

          {/* Job Description — collapsible */}
          <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setJdOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <span>
                {jdOpen
                  ? t("job_description_toggle_hide")
                  : t("job_description_toggle_show")}
              </span>
              <span className="text-gray-400">{jdOpen ? "▲" : "▼"}</span>
            </button>
            {jdOpen && (
              <div className="p-3">
                <textarea
                  name="jobDescription"
                  value={form.jobDescription}
                  onChange={handleChange}
                  rows={8}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y font-mono text-xs"
                  placeholder={t("job_description_placeholder")}
                />
                {isEditing && form.jobDescription.trim() && (
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `/resume-review?applicationId=${application!.id}`,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                    className="nexus-target mt-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 dark:hover:bg-indigo-950/50"
                  >
                    🤖 {t("analyze")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Triage — collapsible */}
          <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setTriageOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <span className="flex items-center gap-2">
                {triageOpen ? t("triage_toggle_hide") : t("triage_toggle_show")}
                {form.triageQuality && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${TRIAGE_COLORS[form.triageQuality as keyof typeof TRIAGE_COLORS] || ""}`}
                  >
                    {form.triageQuality}/5
                  </span>
                )}
              </span>
              <span className="text-gray-400">{triageOpen ? "▲" : "▼"}</span>
            </button>
            {triageOpen && (
              <div className="p-3">
                <TriagePanel
                  data={{
                    companySize: form.companySize,
                    salaryBandMentioned: form.salaryBandMentioned,
                    triageQuality: form.triageQuality as
                      | 1
                      | 2
                      | 3
                      | 4
                      | 5
                      | null,
                    triageReason: form.triageReason,
                    incomingSource: form.incomingSource,
                    autoRejected: form.autoRejected,
                    autoRejectReason: form.autoRejectReason,
                  }}
                  onChange={(partial) =>
                    setForm((prev) => ({ ...prev, ...partial }))
                  }
                  jobDescription={form.jobDescription}
                />
              </div>
            )}
          </div>

          {/* Contacts — collapsible */}
          <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setContactsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <span>
                👤 {t("contacts_section")}
                {contacts.length > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                    {contacts.length}
                  </span>
                )}
              </span>
              <span className="text-gray-400">{contactsOpen ? "▲" : "▼"}</span>
            </button>
            {contactsOpen && (
              <div className="p-3 space-y-3">
                {contactError && (
                  <div className="p-2 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 rounded text-xs">
                    {contactError}
                  </div>
                )}
                {contacts.map((c, idx) => (
                  <div
                    key={c.id ?? `new-${idx}`}
                    className="border border-gray-100 dark:border-gray-600 rounded-lg p-3 space-y-2 bg-gray-50 dark:bg-gray-900/50"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                          {t("contact_name")}{" "}
                          <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={c.name}
                          onChange={(e) =>
                            handleContactChange(idx, "name", e.target.value)
                          }
                          placeholder={t("contact_name_placeholder")}
                          className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                          {t("contact_role")}
                        </label>
                        <input
                          type="text"
                          value={c.role}
                          onChange={(e) =>
                            handleContactChange(idx, "role", e.target.value)
                          }
                          placeholder={t("contact_role_placeholder")}
                          className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                        {t("contact_email")}
                      </label>
                      <input
                        type="email"
                        value={c.email}
                        onChange={(e) =>
                          handleContactChange(idx, "email", e.target.value)
                        }
                        placeholder={t("contact_email_placeholder")}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                        {t("contact_linkedin")}
                      </label>
                      <input
                        type="url"
                        value={c.linkedIn}
                        onChange={(e) =>
                          handleContactChange(idx, "linkedIn", e.target.value)
                        }
                        placeholder={t("contact_linkedin_placeholder")}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex gap-2 justify-end pt-1">
                      {c.isDirty && (
                        <button
                          type="button"
                          onClick={() => saveContact(idx)}
                          disabled={savingContactIdx === idx}
                          className="nexus-target px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {savingContactIdx === idx ? "…" : t("contact_save")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeContact(idx)}
                        disabled={deletingContactId === c.id}
                        className="nexus-target px-3 py-1 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 rounded text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-50 transition-colors"
                      >
                        {deletingContactId === c.id ? "…" : t("contact_remove")}
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addContactRow}
                  className="nexus-target w-full border border-dashed border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {t("contacts_add")}
                </button>
              </div>
            )}
          </div>

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

// ── Documents Section ────────────────────────────────────────────────────────

function docFileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  return "📎";
}

function docFormatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface AppDocument {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

function DocShareButton({
  docId,
  docName,
}: {
  docId: string;
  docName: string;
}) {
  const t = useTranslations("modal");
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const res = await fetch("/api/share-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: "document", targetId: docId }),
    });
    if (!res.ok) return;
    const { code } = await res.json();
    const url = `${window.location.origin}/s/${code}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: docName, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      title={t("documents_share_hint")}
      className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm transition-colors"
    >
      {copied ? "✅" : "🔗"}
    </button>
  );
}

function DocumentsSection({
  applicationId,
  resumeId,
}: {
  applicationId: string;
  resumeId: string | null;
}) {
  const t = useTranslations("modal");
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useQuery<AppDocument[]>({
    queryKey: ["application-documents", applicationId],
    queryFn: async () => {
      const res = await fetch(`/api/applications/${applicationId}/documents`);
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
  });
  const documentCount = documents.length + (resumeId ? 1 : 0);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("applicationIds", JSON.stringify([applicationId]));
        const res = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Upload failed (${res.status})`);
        }
      }
      queryClient.invalidateQueries({
        queryKey: ["application-documents", applicationId],
      });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : t("documents_upload_error"),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleUnlink(docId: string) {
    try {
      const res = await fetch(
        `/api/applications/${applicationId}/documents/${docId}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({
        queryKey: ["application-documents", applicationId],
      });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch {
      setUploadError(t("documents_error"));
    }
  }

  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setDocsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <span>
          📎 {t("documents_section")}
          {documentCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
              {documentCount}
            </span>
          )}
        </span>
        <span className="text-gray-400">{docsOpen ? "▲" : "▼"}</span>
      </button>
      {docsOpen && (
        <div className="p-3 space-y-2">
          {uploadError && (
            <div className="p-2 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 rounded text-xs">
              {uploadError}
            </div>
          )}
          {isLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : documentCount === 0 ? (
            <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-2">
              {t("documents_empty")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {resumeId && (
                <li className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-600">
                  <span className="text-lg shrink-0" aria-hidden="true">
                    🔗
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {t("documents_reactive_resume")}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {t("documents_external_link")}
                    </p>
                  </div>
                  <a
                    href={`/api/applications/${applicationId}/resume`}
                    target="_blank"
                    rel="noreferrer"
                    className="nexus-target text-xs font-medium text-blue-600 transition-colors hover:text-blue-800"
                  >
                    {t("documents_open_resume")}
                  </a>
                </li>
              )}
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-600"
                >
                  <span className="text-lg shrink-0">
                    {docFileIcon(doc.mimeType)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {doc.originalName}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {docFormatBytes(doc.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = `/api/documents/${doc.id}/file`;
                        link.download = doc.originalName;
                        link.click();
                      }}
                      className="nexus-target text-xs font-medium text-blue-600 transition-colors hover:text-blue-800"
                    >
                      {t("documents_download")}
                    </button>
                    <DocShareButton docId={doc.id} docName={doc.originalName} />
                    <button
                      type="button"
                      onClick={() => handleUnlink(doc.id)}
                      className="text-red-500 hover:text-red-700 text-xs font-medium transition-colors"
                    >
                      {t("documents_unlink")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full border border-dashed border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50 transition-colors"
          >
            {uploading ? t("documents_uploading") : t("documents_add")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Resume Section ───────────────────────────────────────────────────────────

interface TailoredResume {
  resumeId: string;
  editUrl: string;
}

function ResumeSection({
  applicationId,
  resumeId,
}: {
  applicationId: string;
  resumeId: string | null;
}) {
  const t = useTranslations("modal");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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

  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="nexus-target flex w-full items-center justify-between bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 dark:bg-gray-900/50 dark:text-gray-300"
      >
        {t("resume_section")}
        <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="p-3">
          {error && (
            <div className="mb-2 p-2 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 rounded text-xs">
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
              className="w-full border border-dashed border-indigo-300 dark:border-indigo-600 rounded-lg py-2.5 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:border-indigo-400 dark:hover:border-indigo-500 disabled:opacity-50 transition-colors font-medium"
            >
              {tailoring ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-indigo-400/40 border-t-indigo-600 dark:border-t-indigo-400 rounded-full animate-spin" />
                  {t("resume_tailoring")}
                </span>
              ) : (
                t("resume_tailor")
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ResumeLink({ editUrl }: { editUrl: string | null }) {
  const t = useTranslations("modal");

  return (
    <button
      type="button"
      disabled={!editUrl}
      onClick={() => openExternalUrl(editUrl)}
      className="nexus-target flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 py-2.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/50"
    >
      {t("resume_open")}
      <svg
        className="w-4 h-4"
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
