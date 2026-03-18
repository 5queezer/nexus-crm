"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function LegalPage() {
  const t = useTranslations("legal");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Top controls */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <ThemeSwitcher />
        <LanguageSwitcher />
      </div>

      <div className="max-w-2xl mx-auto px-4 py-12">
        <Link
          href="/login"
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          &larr; {t("back")}
        </Link>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-6 mb-10">
          {t("title")}
        </h1>

        {/* Privacy Policy */}
        <section className="mb-12" id="privacy">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            {t("privacy.title")}
          </h2>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-4">
            {t("privacy.intro")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("privacy.what_collected_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("privacy.what_collected_text")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("privacy.how_used_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("privacy.how_used_text")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("privacy.cookies_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("privacy.cookies_text")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("privacy.data_storage_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("privacy.data_storage_text")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("privacy.deletion_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("privacy.deletion_text")}
          </p>
        </section>

        {/* Terms of Use */}
        <section className="mb-12" id="terms">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            {t("terms.title")}
          </h2>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-4">
            {t("terms.intro")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("terms.as_is_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("terms.as_is_text")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("terms.no_liability_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("terms.no_liability_text")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("terms.backups_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("terms.backups_text")}
          </p>

          <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mt-4 mb-1">
            {t("terms.changes_title")}
          </h3>
          <p className="text-gray-600 dark:text-slate-400 text-sm mb-3">
            {t("terms.changes_text")}
          </p>
        </section>

        {/* Impressum */}
        <section className="mb-12" id="impressum">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            {t("impressum.title")}
          </h2>
          <p className="text-gray-600 dark:text-slate-400 text-sm italic mb-4">
            {t("impressum.disclaimer")}
          </p>
          <div className="text-gray-600 dark:text-slate-400 text-sm space-y-1">
            <p className="font-semibold text-gray-800 dark:text-slate-200">
              {t("impressum.operated_by")}
            </p>
            <p>{t("impressum.name")}</p>
            <p>{t("impressum.address")}</p>
          </div>
          <div className="text-gray-600 dark:text-slate-400 text-sm space-y-1 mt-4">
            <p className="font-semibold text-gray-800 dark:text-slate-200">
              {t("impressum.contact")}
            </p>
            <p>
              <a
                href="https://github.com/5queezer"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-800 dark:hover:text-slate-200 transition-colors"
              >
                github.com/5queezer
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
