"use client";

import { useTranslations } from "next-intl";
import { CollapsibleCard, SectionCard } from "./section-card";
import type { ContactRowsState } from "./use-contact-rows";

interface ContactsSectionProps {
  state: ContactRowsState;
  variant?: "collapsible" | "open";
}

export function ContactsSection({
  state,
  variant = "collapsible",
}: ContactsSectionProps) {
  const t = useTranslations("modal");
  const {
    contacts,
    contactError,
    savingContactIdx,
    deletingContactId,
    handleContactChange,
    addContactRow,
    saveContact,
    removeContact,
  } = state;

  const body = (
    <div className="space-y-3">
      {contactError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400">
          {contactError}
        </div>
      )}
      {contacts.map((c, idx) => (
        <div
          key={c.clientId}
          className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-white/8 dark:bg-white/4"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-0.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t("contact_name")} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={c.name}
                onChange={(e) =>
                  handleContactChange(idx, "name", e.target.value)
                }
                placeholder={t("contact_name_placeholder")}
                className="nexus-input"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t("contact_role")}
              </label>
              <input
                type="text"
                value={c.role}
                onChange={(e) =>
                  handleContactChange(idx, "role", e.target.value)
                }
                placeholder={t("contact_role_placeholder")}
                className="nexus-input"
              />
            </div>
          </div>
          <div>
            <label className="mb-0.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
              {t("contact_email")}
            </label>
            <input
              type="email"
              value={c.email}
              onChange={(e) =>
                handleContactChange(idx, "email", e.target.value)
              }
              placeholder={t("contact_email_placeholder")}
              className="nexus-input"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
              {t("contact_linkedin")}
            </label>
            <input
              type="url"
              value={c.linkedIn}
              onChange={(e) =>
                handleContactChange(idx, "linkedIn", e.target.value)
              }
              placeholder={t("contact_linkedin_placeholder")}
              className="nexus-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            {c.isDirty && (
              <button
                type="button"
                onClick={() => saveContact(idx)}
                disabled={savingContactIdx === idx}
                className="nexus-target rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {savingContactIdx === idx ? "…" : t("contact_save")}
              </button>
            )}
            <button
              type="button"
              onClick={() => removeContact(idx)}
              disabled={deletingContactId === c.id}
              className="nexus-target rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800/50 dark:text-red-400 dark:hover:bg-red-950/50"
            >
              {deletingContactId === c.id ? "…" : t("contact_remove")}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addContactRow}
        className="nexus-target w-full rounded-xl border border-dashed border-slate-300 py-2 text-sm text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-white/15 dark:text-slate-400 dark:hover:border-indigo-400 dark:hover:text-indigo-400"
      >
        {t("contacts_add")}
      </button>
    </div>
  );

  if (variant === "open") {
    return (
      <SectionCard title={`👤 ${t("contacts_section")}`}>{body}</SectionCard>
    );
  }

  return (
    <CollapsibleCard
      title={`👤 ${t("contacts_section")}`}
      badge={
        contacts.length > 0 ? (
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-300">
            {contacts.length}
          </span>
        ) : undefined
      }
    >
      {body}
    </CollapsibleCard>
  );
}
