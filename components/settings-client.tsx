"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { AdminUsers } from "./admin-users";
import { AgentSettingsSection } from "./agent-settings-section";
import { ApiToken } from "./api-token";
import { AppHeader } from "./app-header";
import { AppSettingsPanel } from "./app-settings";
import { AuditLog } from "./audit-log";
import { EmailIntegration } from "./email-integration";
import { LanguageSwitcher } from "./language-switcher";
import { McpClientHelp } from "./mcp-client-help";
import { ThemeSwitcher } from "./theme-switcher";

interface SettingsClientProps {
  user: { id: string; name?: string | null; email: string; image?: string | null; isAdmin: boolean };
}

type SettingsSection = "preferences" | "email" | "models" | "mcp" | "api" | "users" | "audit" | "assistant";

const PERSONAL: SettingsSection[] = ["preferences", "assistant"];
const CONNECTIONS: SettingsSection[] = ["email", "models", "mcp", "api"];
const ADMINISTRATION: SettingsSection[] = ["users", "audit"];

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getHash() { return window.location.hash; }
function getServerHash() { return ""; }

function SectionPanel({ id, label, active, children }: { id: SettingsSection; label: string; active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <section role="tabpanel" id={`settings-panel-${id}`} aria-labelledby={`settings-tab-${id}`} aria-label={label} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-[#111214]">{children}</section>;
}

export function SettingsClient({ user }: SettingsClientProps) {
  const t = useTranslations("settings.workspace");
  const hash = useSyncExternalStore(subscribeToHash, getHash, getServerHash);
  const [selectedSection, setSelectedSection] = useState<SettingsSection | null>(null);
  const candidate = hash.replace("#", "") as SettingsSection;
  const validHash = [...PERSONAL, ...CONNECTIONS, ...(user.isAdmin ? ADMINISTRATION : [])].includes(candidate);
  const active = selectedSection ?? (validHash ? candidate : "preferences");
  const groups = [
    { id: "personal", items: PERSONAL },
    { id: "connections", items: CONNECTIONS },
    ...(user.isAdmin ? [{ id: "administration", items: ADMINISTRATION }] : []),
  ];

  function select(section: SettingsSection) {
    setSelectedSection(section);
    window.history.replaceState(null, "", `#${section}`);
  }

  return <div className="nexus-shell min-h-screen">
    <AppHeader user={user} />
    <main className="nexus-page-bottom-space mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6"><h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{t("title")}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("subtitle")}</p></header>
      <div className="grid items-start gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t("nav_label")} role="tablist" aria-orientation="vertical" className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-2 md:block md:overflow-visible md:border-b-0 md:pb-0 dark:border-white/10">
          {groups.map((group) => <div key={group.id} className="contents md:block md:pb-5">
            <p className="hidden px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 md:block">{t(`groups.${group.id}`)}</p>
            {group.items.map((item) => <button key={item} id={`settings-tab-${item}`} type="button" role="tab" aria-selected={active === item} aria-controls={`settings-panel-${item}`} onClick={() => select(item)} className={`min-h-11 shrink-0 rounded-lg px-3 py-2 text-left text-sm font-medium transition md:mb-1 md:block md:w-full ${active === item ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"}`}>{t(`sections.${item}`)}</button>)}
          </div>)}
        </nav>

        <div className="min-w-0">
          <SectionPanel id="preferences" label={t("sections.preferences")} active={active === "preferences"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.preferences")}</h2><p className="mt-1 text-sm text-slate-500">{t("preferences_description")}</p>
            <div className="my-5 grid gap-3 sm:grid-cols-2"><ThemeSwitcher variant="menu" label={t("appearance")} /><LanguageSwitcher variant="menu" label={t("language")} /></div>
            <AppSettingsPanel />
          </SectionPanel>

          <SectionPanel id="email" label={t("sections.email")} active={active === "email"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("email_title")}</h2><p className="mt-1 text-sm text-slate-500">{t("email_description")}</p>
            <div className="my-5"><EmailIntegration /></div>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200"><Link href="/activity#email-review" className="font-semibold hover:underline">{t("review_email")}</Link></div>
          </SectionPanel>

          <SectionPanel id="models" label={t("sections.models")} active={active === "models"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.models")}</h2><p className="mb-5 mt-1 text-sm text-slate-500">{t("models_description")}</p><AgentSettingsSection section="models" />
          </SectionPanel>

          <SectionPanel id="mcp" label={t("sections.mcp")} active={active === "mcp"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.mcp")}</h2><p className="mb-5 mt-1 text-sm text-slate-500">{t("mcp_description")}</p><AgentSettingsSection section="connectors" /><div className="mt-6"><McpClientHelp /></div>
          </SectionPanel>

          <SectionPanel id="api" label={t("sections.api")} active={active === "api"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.api")}</h2><p className="mb-5 mt-1 text-sm text-slate-500">{t("api_description")}</p><ApiToken /><Link href="/api-docs" className="mt-4 inline-flex text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">{t("api_docs")}</Link>
          </SectionPanel>

          {user.isAdmin && <SectionPanel id="users" label={t("sections.users")} active={active === "users"}><h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.users")}</h2><p className="mb-5 mt-1 text-sm text-slate-500">{t("users_description")}</p><AdminUsers currentUserId={user.id} /></SectionPanel>}
          {user.isAdmin && <SectionPanel id="audit" label={t("sections.audit")} active={active === "audit"}><h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.audit")}</h2><p className="mb-5 mt-1 text-sm text-slate-500">{t("audit_description")}</p><AuditLog /></SectionPanel>}

          <SectionPanel id="assistant" label={t("sections.assistant")} active={active === "assistant"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.assistant")}</h2><p className="mt-1 text-sm text-slate-500">{t("assistant_description")}</p>
            <div className="mt-5 space-y-4 text-sm leading-6 text-slate-700 dark:text-slate-300"><div className="rounded-xl border border-slate-200 p-4 dark:border-white/10"><h3 className="font-semibold text-slate-950 dark:text-white">{t("approval_title")}</h3><p className="mt-1">{t("approval_description")}</p></div><div className="rounded-xl border border-slate-200 p-4 dark:border-white/10"><h3 className="font-semibold text-slate-950 dark:text-white">{t("permissions_title")}</h3><p className="mt-1">{t("permissions_description")}</p></div></div>
          </SectionPanel>
        </div>
      </div>
    </main>
  </div>;
}
