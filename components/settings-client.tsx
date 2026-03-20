"use client";

import { AdminUsers } from "./admin-users";
import { AuditLog } from "./audit-log";
import { AppSettingsPanel } from "./app-settings";
import { EmailIntegration } from "./email-integration";
import { ScannedEmails } from "./scanned-emails";
import { ApiToken } from "./api-token";
import { AppHeader } from "./app-header";

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
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader user={user} />

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
