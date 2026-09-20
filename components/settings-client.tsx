"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { publishAssistantContext } from "./ai-operator/context";
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
import { BEFORE_HISTORY_NAVIGATION } from "./history-navigation-guard";

interface SettingsClientProps {
  user: { id: string; name?: string | null; email: string; image?: string | null; isAdmin: boolean };
}

type SettingsSection = "preferences" | "email" | "models" | "mcp" | "api" | "users" | "audit" | "assistant";

const PERSONAL: SettingsSection[] = ["preferences", "assistant"];
const CONNECTIONS: SettingsSection[] = ["email", "models", "mcp", "api"];
const ADMINISTRATION: SettingsSection[] = ["users", "audit"];

function SectionPanel({ id, label, active, children }: { id: SettingsSection; label: string; active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <section role="tabpanel" tabIndex={0} id={`settings-panel-${id}`} aria-labelledby={`settings-tab-${id}`} aria-label={label} className="nexus-focus-ring min-w-0">{children}</section>;
}

export function SettingsClient({ user }: SettingsClientProps) {
  const t = useTranslations("settings.workspace");
  const [hash, setHash] = useState("");
  const [dirty, setDirty] = useState(false);
  const approvedNavigation = useRef<string | null>(null);
  const candidate = hash.replace("#", "") as SettingsSection;
  const validHash = [...PERSONAL, ...CONNECTIONS, ...(user.isAdmin ? ADMINISTRATION : [])].includes(candidate);
  const active = validHash ? candidate : "preferences";
  const groups = [
    { id: "personal", items: PERSONAL },
    { id: "connections", items: CONNECTIONS },
    ...(user.isAdmin ? [{ id: "administration", items: ADMINISTRATION }] : []),
  ];

  useEffect(() => {
    // Fragments are browser-only; initialize after hydration without a
    // second live URL subscription racing the guarded history listener.
    const frame = requestAnimationFrame(() => setHash(window.location.hash));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    publishAssistantContext({ route: "/settings", dirtyEditorIds: dirty ? ["settings"] : [], capabilities: [] });
    return () => publishAssistantContext({ dirtyEditorIds: [] });
  }, [dirty]);

  useEffect(() => {
    approvedNavigation.current = null;
    const currentUrl = `/settings${window.location.search}#${active}`;
    // Keep this entry's router tree: at popstate, history.state already
    // describes the destination, not the editor the user chose to keep.
    const currentHistoryState = window.history.state;
    let approvalExpiry: ReturnType<typeof setTimeout> | undefined;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirty && !approvedNavigation.current) event.preventDefault();
      approvedNavigation.current = null;
    }
    function click(event: MouseEvent) {
      if (!dirty) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.getAttribute("href")!, window.location.href);
      if (url.href === window.location.href) return;
      const settingsHashLink = url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search;
      const requestedSection = url.hash.slice(1) as SettingsSection;
      const linkedSection = [...PERSONAL, ...CONNECTIONS, ...(user.isAdmin ? ADMINISTRATION : [])].includes(requestedSection) ? requestedSection : "preferences";
      if (settingsHashLink && linkedSection === active) {
        event.preventDefault();
        return;
      }
      if (!window.confirm(t("unsaved_changes"))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        if (settingsHashLink) {
          // Own same-document routing so a confirmed hash link cannot prompt
          // again, or leave an unload bypass armed after a no-op transition.
          event.preventDefault();
          window.history.pushState(null, "", url.href);
          setDirty(false);
          setHash(url.hash);
          return;
        }
        approvedNavigation.current = url.href;
        approvalExpiry = setTimeout(() => { approvedNavigation.current = null; }, 0);
      }
    }
    function historyNavigation(event: Event) {
      const changed = `${window.location.pathname}${window.location.search}${window.location.hash || "#preferences"}` !== currentUrl;
      if (dirty && changed && !window.confirm(t("unsaved_changes"))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.history.pushState(currentHistoryState, "", currentUrl);
        return;
      }
      // Update the tab only after the leave guard. A separate synchronous
      // URL-store subscription can unmount the editor before this check runs.
      if (changed) setDirty(false);
      setHash(window.location.hash);
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    window.addEventListener(BEFORE_HISTORY_NAVIGATION, historyNavigation);
    window.addEventListener("hashchange", historyNavigation, true);
    return () => {
      clearTimeout(approvalExpiry);
      approvedNavigation.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      window.removeEventListener(BEFORE_HISTORY_NAVIGATION, historyNavigation);
      window.removeEventListener("hashchange", historyNavigation, true);
    };
  }, [active, dirty, t, user.isAdmin]);

  function select(section: SettingsSection) {
    if (section === active) return true;
    if (dirty && !window.confirm(t("unsaved_changes"))) return false;
    setDirty(false);
    window.history.pushState(null, "", `#${section}`);
    setHash(`#${section}`);
    return true;
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, item: SettingsSection) {
    const items = groups.flatMap(group => group.items);
    const index = items.indexOf(item);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : ["ArrowDown", "ArrowRight"].includes(event.key) ? (index + 1) % items.length
      : ["ArrowUp", "ArrowLeft"].includes(event.key) ? (index - 1 + items.length) % items.length : -1;
    if (next < 0) return;
    event.preventDefault();
    if (select(items[next])) document.getElementById(`settings-tab-${items[next]}`)?.focus();
  }

  return <div className="nexus-shell min-h-screen">
    <AppHeader user={user} onBeforeLogout={() => !dirty || window.confirm(t("unsaved_changes"))} />
    <main className="nexus-page-bottom-space @container mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
      <header className="mb-8"><h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{t("title")}</h1><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("subtitle")}</p></header>
      <div className="grid items-start gap-8 @min-[760px]:grid-cols-[180px_minmax(0,1fr)] @min-[1000px]:gap-12">
        <nav aria-label={t("nav_label")} role="tablist" aria-orientation="vertical" className="flex flex-wrap gap-1 border-b border-slate-200 pb-4 @min-[760px]:block @min-[760px]:border-b-0 @min-[760px]:pb-0 dark:border-white/10">
          {groups.map((group) => <div key={group.id} className="contents @min-[760px]:block @min-[760px]:pb-5">
            <p className="hidden px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 @min-[760px]:block">{t(`groups.${group.id}`)}</p>
            {group.items.map((item) => <button key={item} id={`settings-tab-${item}`} type="button" role="tab" tabIndex={active === item ? 0 : -1} aria-selected={active === item} aria-controls={`settings-panel-${item}`} onClick={() => select(item)} onKeyDown={(event) => moveTab(event, item)} className={`nexus-focus-ring min-h-11 rounded-md px-3 py-2 text-left text-sm font-medium transition @min-[760px]:mb-1 @min-[760px]:block @min-[760px]:w-full ${active === item ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"}`}>{t(`sections.${item}`)}</button>)}
          </div>)}
        </nav>

        <div className="min-w-0">
          <SectionPanel id="preferences" label={t("sections.preferences")} active={active === "preferences"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.preferences")}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("preferences_description")}</p>
            <div className="my-6 grid gap-3 border-b border-slate-200 pb-6 sm:grid-cols-2 dark:border-white/10"><ThemeSwitcher variant="settings" label={t("appearance")} /><LanguageSwitcher variant="settings" label={t("language")} /></div>
            <AppSettingsPanel onDirtyChange={setDirty} />
          </SectionPanel>

          <SectionPanel id="email" label={t("sections.email")} active={active === "email"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("email_title")}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("email_description")}</p>
            <div className="my-5"><EmailIntegration /></div>
            <div className="mt-6 border-t border-slate-200 pt-5 text-sm text-indigo-700 dark:border-white/10 dark:text-indigo-300"><Link href="/activity#email-review" className="nexus-focus-ring font-medium hover:underline">{t("review_email")}</Link></div>
          </SectionPanel>

          <SectionPanel id="models" label={t("sections.models")} active={active === "models"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.models")}</h2><p className="mb-6 mt-1 text-sm text-slate-500 dark:text-slate-400">{t("models_description")}</p><AgentSettingsSection section="models" onDirtyChange={setDirty} />
          </SectionPanel>

          <SectionPanel id="mcp" label={t("sections.mcp")} active={active === "mcp"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.mcp")}</h2><p className="mb-5 mt-1 text-sm text-slate-500 dark:text-slate-400">{t("mcp_description")}</p><AgentSettingsSection section="connectors" onDirtyChange={setDirty} /><div className="mt-8 border-t border-slate-200 pt-6 dark:border-white/10"><McpClientHelp /></div>
          </SectionPanel>

          <SectionPanel id="api" label={t("sections.api")} active={active === "api"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.api")}</h2><p className="mb-5 mt-1 text-sm text-slate-500 dark:text-slate-400">{t("api_description")}</p><ApiToken /><Link href="/api-docs" className="mt-4 inline-flex text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">{t("api_docs")}</Link>
          </SectionPanel>

          {user.isAdmin && <SectionPanel id="users" label={t("sections.users")} active={active === "users"}><h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.users")}</h2><p className="mb-5 mt-1 text-sm text-slate-500 dark:text-slate-400">{t("users_description")}</p><AdminUsers currentUserId={user.id} /></SectionPanel>}
          {user.isAdmin && <SectionPanel id="audit" label={t("sections.audit")} active={active === "audit"}><h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.audit")}</h2><p className="mb-5 mt-1 text-sm text-slate-500 dark:text-slate-400">{t("audit_description")}</p><AuditLog /></SectionPanel>}

          <SectionPanel id="assistant" label={t("sections.assistant")} active={active === "assistant"}>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{t("sections.assistant")}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("assistant_description")}</p>
            <div className="mt-7 divide-y divide-slate-200 text-sm leading-6 text-slate-700 dark:divide-white/10 dark:text-slate-300"><div className="pb-6"><h3 className="font-semibold text-slate-950 dark:text-white">{t("approval_title")}</h3><p className="mt-2">{t("approval_description")}</p></div><div className="pt-6"><h3 className="font-semibold text-slate-950 dark:text-white">{t("permissions_title")}</h3><p className="mt-2">{t("permissions_description")}</p></div></div>
          </SectionPanel>
        </div>
      </div>
    </main>
  </div>;
}
