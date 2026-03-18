"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Settings } from "lucide-react";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import { AdminUsers } from "./admin-users";
import { AuditLog } from "./audit-log";
import { AppSettingsPanel } from "./app-settings";
import { EmailIntegration } from "./email-integration";
import { ScannedEmails } from "./scanned-emails";
import { ApiToken } from "./api-token";

interface SettingsClientProps {
  user: {
    id: string;
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin: boolean;
  };
}

export function SettingsClient({ user }: SettingsClientProps) {
  const t = useTranslations("settings");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-3">
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-blue-600" />
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                {t("title")}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <ThemeSwitcher />
              <LanguageSwitcher />
              {user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt={user.name || user.email}
                  className="w-8 h-8 rounded-full"
                />
              )}
              <Link
                href="/"
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                {t("back")}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <EmailIntegration />
        <ScannedEmails />
        <ApiToken />
        <AppSettingsPanel />
        {user.isAdmin && (
          <>
            <AdminUsers currentUserId={user.id} />
            <AuditLog />
          </>
        )}
      </main>
    </div>
  );
}
