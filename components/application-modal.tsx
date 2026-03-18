"use client";

import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Application, ApplicationStatus, Contact, STATUS_COLORS, STATUS_ORDER, SOURCE_PRESETS } from "@/types";

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
}

interface ContactFormRow {
  id?: string;          // set when persisted
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

async function updateApplication(id: string, data: FormData): Promise<Application> {
  const res = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializeForm(data)),
  });
  if (!res.ok) throw new Error("Failed to update application");
  return res.json();
}

async function createContact(applicationId: string, contact: Omit<ContactFormRow, "isDirty" | "isNew" | "id">): Promise<Contact> {
  const res = await fetch(`/api/applications/${applicationId}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contact),
  });
  if (!res.ok) throw new Error("Failed to create contact");
  return res.json();
}

async function updateContact(applicationId: string, contactId: string, contact: Partial<ContactFormRow>): Promise<Contact> {
  const res = await fetch(`/api/applications/${applicationId}/contacts/${contactId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contact),
  });
  if (!res.ok) throw new Error("Failed to update contact");
  return res.json();
}

async function deleteContact(applicationId: string, contactId: string): Promise<void> {
  const res = await fetch(`/api/applications/${applicationId}/contacts/${contactId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete contact");
}

function toDateInput(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toISOString().split("T")[0];
  } catch {
    return "";
  }
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

export function ApplicationModal({ application, onClose }: ApplicationModalProps) {
  const queryClient = useQueryClient();
  const t = useTranslations("modal");
  const ts = useTranslations("status");
  const ta = useTranslations("actions");
  const isEditing = !!application;

  const [form, setForm] = useState<FormData>({
    company: application?.company || "",
    role: application?.role || "",
    status: (application?.status as ApplicationStatus) || "inbound",
    appliedAt: toDateInput(application?.appliedAt) || (application ? "" : new Date().toISOString().split("T")[0]),
    lastContact: toDateInput(application?.lastContact),
    followUpAt: toDateInput(application?.followUpAt),
    notes: application?.notes || "",
    jobDescription: application?.jobDescription || "",
    source: application?.source || "",
    remote: application?.remote ?? false,
    salaryMin: application?.salaryMin != null ? String(application.salaryMin) : "",
    salaryMax: application?.salaryMax != null ? String(application.salaryMax) : "",
    rating: application?.rating ?? null,
  });

  const [jdOpen, setJdOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  // Contacts state – pre-filled from application if editing
  const [contacts, setContacts] = useState<ContactFormRow[]>(
    () => (application?.contacts ?? []).map(contactToRow)
  );
  const [savingContactIdx, setSavingContactIdx] = useState<number | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createApplication,
    onSuccess: async (newApp) => {
      // save any new contacts to newly created application
      await Promise.all(
        contacts
          .filter((c) => c.isNew && c.name.trim())
          .map((c) =>
            createContact(newApp.id, { name: c.name, email: c.email, role: c.role, linkedIn: c.linkedIn })
          )
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
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleContactChange(idx: number, field: keyof ContactFormRow, value: string) {
    setContacts((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value, isDirty: true } : c))
    );
  }

  function addContactRow() {
    setContacts((prev) => [
      ...prev,
      { name: "", email: "", role: "", linkedIn: "", isDirty: true, isNew: true },
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
            prev.map((row, i) => (i === idx ? { ...row, isDirty: false } : row))
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
            i === idx ? { ...row, id: saved.id, isDirty: false, isNew: false } : row
          )
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
          prev.map((row, i) => (i === idx ? { ...row, isDirty: false } : row))
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 rounded-t-2xl z-10">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white pr-2">
            {isEditing ? t("title_edit") : t("title_new")}
          </h2>
          <button
            onClick={onClose}
            className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("company")} <span className="text-red-500">{t("required")}</span>
              </label>
              <input
                type="text"
                name="company"
                value={form.company}
                onChange={handleChange}
                required
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t("company_placeholder")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("role")} <span className="text-red-500">{t("required")}</span>
              </label>
              <input
                type="text"
                name="role"
                value={form.role}
                onChange={handleChange}
                required
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t("role_placeholder")}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("status")}
            </label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {ts(value)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("source")}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                name="source"
                value={form.source}
                onChange={handleChange}
                list="source-presets"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t("source_placeholder")}
              />
              <datalist id="source-presets">
                {SOURCE_PRESETS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.remote}
                onChange={(e) => setForm((prev) => ({ ...prev, remote: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:bg-gray-700"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("remote")}</span>
            </label>
          </div>

          {/* Salary range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="hidden sm:block text-gray-400 text-sm shrink-0">–</span>
              <input
                type="number"
                name="salaryMax"
                value={form.salaryMax}
                onChange={handleChange}
                min={0}
                step={1000}
                placeholder={t("salary_max_placeholder")}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Suitability rating */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("rating")}
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, rating: prev.rating === star ? null : star }))
                  }
                  className={`text-2xl leading-none transition-colors ${
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("applied_at")}
              </label>
              <input
                type="date"
                name="appliedAt"
                value={form.appliedAt}
                onChange={handleChange}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("last_contact")}
              </label>
              <input
                type="date"
                name="lastContact"
                value={form.lastContact}
                onChange={handleChange}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              🔔 {t("follow_up")}
            </label>
            <input
              type="date"
              name="followUpAt"
              value={form.followUpAt}
              onChange={handleChange}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("notes")}
            </label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder={t("notes_placeholder")}
            />
          </div>

          {/* Job Description — collapsible */}
          <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setJdOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <span>{jdOpen ? t("job_description_toggle_hide") : t("job_description_toggle_show")}</span>
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
                  <div key={c.id ?? `new-${idx}`} className="border border-gray-100 dark:border-gray-600 rounded-lg p-3 space-y-2 bg-gray-50 dark:bg-gray-900/50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                          {t("contact_name")} <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={c.name}
                          onChange={(e) => handleContactChange(idx, "name", e.target.value)}
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
                          onChange={(e) => handleContactChange(idx, "role", e.target.value)}
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
                        onChange={(e) => handleContactChange(idx, "email", e.target.value)}
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
                        onChange={(e) => handleContactChange(idx, "linkedIn", e.target.value)}
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
                          className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {savingContactIdx === idx ? "…" : t("contact_save")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeContact(idx)}
                        disabled={deletingContactId === c.id}
                        className="px-3 py-1 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 rounded text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-50 transition-colors"
                      >
                        {deletingContactId === c.id ? "…" : t("contact_remove")}
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addContactRow}
                  className="w-full border border-dashed border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {t("contacts_add")}
                </button>
              </div>
            )}
          </div>

          {/* Resume — only when editing */}
          {isEditing && <ResumeSection applicationId={application!.id} resumeId={application!.resumeId} />}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {ta("cancel")}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

// ── Resume Section ───────────────────────────────────────────────────────────

function ResumeSection({ applicationId, resumeId }: { applicationId: string; resumeId: string | null }) {
  const t = useTranslations("modal");
  const queryClient = useQueryClient();
  const [tailoring, setTailoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState<string | null>(null);

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
      const data = await res.json();
      setEditUrl(data.editUrl);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    } catch {
      setError(t("resume_error"));
    } finally {
      setTailoring(false);
    }
  }

  // If we already have a resumeId, try to build the URL
  const existingUrl = resumeId
    ? (editUrl || `/api/applications/${applicationId}/tailor`)
    : null;

  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50">
        {t("resume_section")}
      </div>
      <div className="p-3">
        {error && (
          <div className="mb-2 p-2 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 rounded text-xs">
            {error}
          </div>
        )}
        {resumeId ? (
          <ResumeLink applicationId={applicationId} resumeId={resumeId} />
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
    </div>
  );
}

function ResumeLink({ applicationId, resumeId }: { applicationId: string; resumeId: string }) {
  const t = useTranslations("modal");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/applications/${applicationId}/tailor`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => setUrl(d.editUrl))
      .catch(() => {});
  }, [applicationId]);

  return (
    <a
      href={url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-2 w-full border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg py-2.5 text-sm text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors font-medium"
    >
      {t("resume_open")}
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}
