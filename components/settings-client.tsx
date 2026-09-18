"use client";

import { useTranslations } from "next-intl";

import { AdminUsers } from "./admin-users";
import { AuditLog } from "./audit-log";
import { AppSettingsPanel } from "./app-settings";
import { EmailIntegration } from "./email-integration";
import { ScannedEmails } from "./scanned-emails";
import { ApiToken } from "./api-token";
import { AppShell } from "./app-shell";
import { McpClientHelp } from "./mcp-client-help";

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
  const tn = useTranslations("nav");

  return (
    <AppShell user={user} breadcrumbs={[{ label: tn("settings") }]}>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <EmailIntegration />
        <ScannedEmails />
        <McpClientHelp />
        <ApiToken />
        <AppSettingsPanel />
        {user.isAdmin && (
          <>
            <AdminUsers currentUserId={user.id} />
            <AuditLog />
          </>
        )}
      </main>
    </AppShell>
  );
}
