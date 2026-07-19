"use client";

import { useTranslations, useLocale } from "next-intl";
import { STATUS_ORDER } from "@/types";
import type { ApplicationFormData } from "./form-data";

interface CoreFieldsSectionProps {
  form: ApplicationFormData;
  onChange: (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => void;
}

export function CoreFieldsSection({ form, onChange }: CoreFieldsSectionProps) {
  const t = useTranslations("modal");
  const ts = useTranslations("status");
  const locale = useLocale();

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("company")} <span className="text-red-500">{t("required")}</span>
          </label>
          <input
            type="text"
            name="company"
            value={form.company}
            onChange={onChange}
            required
            className="nexus-input"
            placeholder={t("company_placeholder")}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("role")} <span className="text-red-500">{t("required")}</span>
          </label>
          <input
            type="text"
            name="role"
            value={form.role}
            onChange={onChange}
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
          onChange={onChange}
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
          onChange={onChange}
          lang={locale}
          className="nexus-input"
        />
      </div>
    </>
  );
}
