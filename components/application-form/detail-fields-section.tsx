"use client";

import { useTranslations, useLocale } from "next-intl";
import { SOURCE_PRESETS } from "@/types";
import type { ApplicationFormData } from "./form-data";
import { JobUrlField } from "./job-url-field";

interface DetailFieldsSectionProps {
  form: ApplicationFormData;
  onChange: (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => void;
  patch: (partial: Partial<ApplicationFormData>) => void;
}

export function DetailFieldsSection({
  form,
  onChange,
  patch,
}: DetailFieldsSectionProps) {
  const t = useTranslations("modal");
  const ta = useTranslations("actions");
  const locale = useLocale();

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t("source")}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            name="source"
            value={form.source}
            onChange={onChange}
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
        onChange={(value) => patch({ jobUrl: value })}
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
            onChange={(e) => patch({ remote: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-white/20 dark:bg-white/10"
          />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("remote")}
          </span>
        </label>
      </div>

      {/* Salary range */}
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t("salary_range")}
        </label>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <input
            type="number"
            name="salaryMin"
            value={form.salaryMin}
            onChange={onChange}
            min={0}
            step={1000}
            placeholder={t("salary_min_placeholder")}
            className="nexus-input"
          />
          <span className="hidden shrink-0 text-sm text-slate-400 sm:block">
            –
          </span>
          <input
            type="number"
            name="salaryMax"
            value={form.salaryMax}
            onChange={onChange}
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
                patch({ rating: form.rating === star ? null : star })
              }
              className={`nexus-target inline-flex items-center justify-center text-2xl leading-none transition-colors ${
                (form.rating ?? 0) >= star
                  ? "text-yellow-400 hover:text-yellow-500"
                  : "text-slate-300 hover:text-yellow-300 dark:text-slate-600"
              }`}
              title={`${star} / 5`}
            >
              ★
            </button>
          ))}
          {form.rating && (
            <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
              {form.rating}/5
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t("applied_at")}
          </label>
          <input
            type="date"
            name="appliedAt"
            value={form.appliedAt}
            onChange={onChange}
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
            onChange={onChange}
            lang={locale}
            className="nexus-input"
          />
        </div>
      </div>
    </div>
  );
}
