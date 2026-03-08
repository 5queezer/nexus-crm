"use client";

import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Application, ApplicationStatus, Contact, STATUS_COLORS, STATUS_ORDER } from "@/types";

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

async function createApplication(data: FormData): Promise<Application> {
  const res = await fetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...data,
      appliedAt: data.appliedAt || null,
      lastContact: data.lastContact || null,
      followUpAt: data.followUpAt || null,
      notes: data.notes || null,
      jobDescription: data.jobDescription || null,
    }),
  });
  if (!res.ok) throw new Error("Failed to create application");
  return res.json();
}

async function updateApplication(id: string, data: FormData): Promise<Application> {
  const res = await fetch(`/api/applications/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...data,
      appliedAt: data.appliedAt || null,
      lastContact: data.lastContact || null,
      followUpAt: data.followUpAt || null,
      notes: data.notes || null,
      jobDescription: data.jobDescription || null,
    }),
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
    status: (application?.status as ApplicationStatus) || "applied",
    appliedAt: toDateInput(application?.appliedAt),
    lastContact: toDateInput(application?.lastContact),
    followUpAt: toDateInput(application?.followUpAt),
    notes: application?.notes || "",
    jobDescription: application?.jobDescription || "",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? t("title_edit") : t("title_new")}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("company")} <span className="text-red-500">{t("required")}</span>
              </label>
              <input
                type="text"
                name="company"
                value={form.company}
                onChange={handleChange}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t("company_placeholder")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("role")} <span className="text-red-500">{t("required")}</span>
              </label>
              <input
                type="text"
                name="role"
                value={form.role}
                onChange={handleChange}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t("role_placeholder")}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("status")}
            </label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {ts(value)}
                </option>
              ))}
            </select>
            <div className="mt-1.5">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[form.status]}`}>
                {ts(form.status)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("applied_at")}
              </label>
              <input
                type="date"
                name="appliedAt"
                value={form.appliedAt}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("last_contact")}
              </label>
              <input
                type="date"
                name="lastContact"
                value={form.lastContact}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              🔔 {t("follow_up")}
            </label>
            <input
              type="date"
              name="followUpAt"
              value={form.followUpAt}
              onChange={handleChange}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("notes")}
            </label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder={t("notes_placeholder")}
            />
          </div>

          {/* Job Description — collapsible */}
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setJdOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y font-mono text-xs"
                  placeholder={t("job_description_placeholder")}
                />
              </div>
            )}
          </div>

          {/* Contacts — collapsible */}
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setContactsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
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
                  <div className="p-2 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
                    {contactError}
                  </div>
                )}
                {contacts.map((c, idx) => (
                  <div key={c.id ?? `new-${idx}`} className="border border-gray-100 rounded-lg p-3 space-y-2 bg-gray-50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-0.5">
                          {t("contact_name")} <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={c.name}
                          onChange={(e) => handleContactChange(idx, "name", e.target.value)}
                          placeholder={t("contact_name_placeholder")}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-0.5">
                          {t("contact_role")}
                        </label>
                        <input
                          type="text"
                          value={c.role}
                          onChange={(e) => handleContactChange(idx, "role", e.target.value)}
                          placeholder={t("contact_role_placeholder")}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-0.5">
                        {t("contact_email")}
                      </label>
                      <input
                        type="email"
                        value={c.email}
                        onChange={(e) => handleContactChange(idx, "email", e.target.value)}
                        placeholder={t("contact_email_placeholder")}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-0.5">
                        {t("contact_linkedin")}
                      </label>
                      <input
                        type="url"
                        value={c.linkedIn}
                        onChange={(e) => handleContactChange(idx, "linkedIn", e.target.value)}
                        placeholder={t("contact_linkedin_placeholder")}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        className="px-3 py-1 border border-red-200 text-red-600 rounded text-xs font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                      >
                        {deletingContactId === c.id ? "…" : t("contact_remove")}
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addContactRow}
                  className="w-full border border-dashed border-gray-300 rounded-lg py-2 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                >
                  {t("contacts_add")}
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
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
