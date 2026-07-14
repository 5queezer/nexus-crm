"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  History,
  Loader2,
  Menu,
  MessageSquare,
  PanelRightClose,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { OperatorSettings } from "./operator-settings";
import {
  ActionProposal,
  AgentMessage,
  AgentThread,
  apiJson,
  Credential,
  ProviderId,
  ProviderOption,
} from "./types";

const STARTERS = ["starter_pipeline", "starter_followups", "starter_priorities", "starter_notes"] as const;

export function AiOperator() {
  const t = useTranslations("ai_operator");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [activeThread, setActiveThread] = useState<AgentThread | null>(null);
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [message, setMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actingProposal, setActingProposal] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeThreadRef = useRef<AgentThread | null>(null);

  useEffect(() => {
    activeThreadRef.current = activeThread;
  }, [activeThread]);

  const configuredProviders = useMemo(
    () => providers.filter((item) => credentials.some((credential) => credential.provider === item.id)),
    [credentials, providers],
  );
  const currentCredential = credentials.find((item) => item.provider === provider);
  const currentProvider = providers.find((item) => item.id === provider);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [credentialResult, threadResult] = await Promise.all([
        apiJson<{ providers: ProviderOption[]; credentials: Credential[] }>("/api/agent/credentials"),
        apiJson<{ threads: AgentThread[] }>("/api/agent/threads"),
      ]);
      setProviders(credentialResult.providers);
      setCredentials(credentialResult.credentials);
      setThreads(threadResult.threads);
      const firstConfigured = credentialResult.credentials[0]?.provider;
      if (firstConfigured) setProvider(firstConfigured);
      if (!activeThreadRef.current && threadResult.threads[0]) {
        const result = await apiJson<{ thread: AgentThread }>(`/api/agent/threads/${threadResult.threads[0].id}`);
        setActiveThread(result.thread);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error_generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void loadInitial();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, settingsOpen, loadInitial]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const launcher = launcherRef.current;
    if (!dialog) return;
    const focusableSelector = "button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    focusable()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      launcher?.focus();
    };
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [activeThread?.messages, streaming, proposals]);

  const loadProposals = useCallback(async (threadId: string) => {
    try {
      const result = await apiJson<{ proposals: ActionProposal[] }>(`/api/agent/proposals?threadId=${encodeURIComponent(threadId)}`);
      setProposals(result.proposals);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error_generic"));
    }
  }, [t]);

  const activeThreadId = activeThread?.id;
  useEffect(() => {
    if (activeThreadId) void loadProposals(activeThreadId);
    else setProposals([]);
  }, [activeThreadId, loadProposals]);

  async function createThread(title?: string): Promise<AgentThread> {
    const result = await apiJson<{ thread: AgentThread }>("/api/agent/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(title ? { title: title.slice(0, 72) } : {}),
    });
    const thread = { ...result.thread, messages: result.thread.messages ?? [] };
    setThreads((current) => [thread, ...current]);
    setActiveThread(thread);
    setProposals([]);
    setSidebarOpen(false);
    return thread;
  }

  async function selectThread(id: string) {
    if (streaming) return;
    setLoading(true); setError("");
    try {
      const result = await apiJson<{ thread: AgentThread }>(`/api/agent/threads/${id}`);
      setActiveThread(result.thread);
      setSidebarOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("error_generic")); } finally { setLoading(false); }
  }

  async function deleteThread(id: string) {
    if (streaming) return;
    try {
      await apiJson<void>(`/api/agent/threads/${id}`, { method: "DELETE" });
      setThreads((current) => current.filter((item) => item.id !== id));
      if (activeThread?.id === id) { setActiveThread(null); setProposals([]); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("error_generic")); }
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    if (!currentCredential) { setSettingsOpen(true); return; }
    setError("");
    let thread = activeThread;
    try {
      if (!thread) thread = await createThread(content);
      const now = new Date().toISOString();
      const userMessage: AgentMessage = { id: `local-user-${Date.now()}`, role: "user", content, createdAt: now };
      const assistantMessage: AgentMessage = { id: `local-assistant-${Date.now()}`, role: "assistant", content: "", createdAt: now };
      const threadId = thread.id;
      setActiveThread((current) => current?.id === threadId ? { ...current, messages: [...(current.messages ?? []), userMessage, assistantMessage] } : current);
      setMessage("");
      setStreaming(true);
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, provider, message: content }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || t("run_failed"));
      }
      if (!response.body) throw new Error(t("run_failed"));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setActiveThread((current) => current?.id === threadId ? { ...current, messages: (current.messages ?? []).map((item) => item.id === assistantMessage.id ? { ...item, content: assistantText } : item) } : current);
      }
      const refreshed = await apiJson<{ thread: AgentThread }>(`/api/agent/threads/${threadId}`);
      setActiveThread(refreshed.thread);
      setThreads((current) => [refreshed.thread, ...current.filter((item) => item.id !== threadId)]);
      await loadProposals(threadId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("run_failed"));
      setActiveThread((current) => current ? { ...current, messages: (current.messages ?? []).filter((item) => !item.id.startsWith("local-assistant-") || item.content) } : current);
    } finally {
      setStreaming(false);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function actOnProposal(id: string, action: "approve" | "reject") {
    setActingProposal(id); setError("");
    try {
      await apiJson<unknown>(`/api/agent/proposals/${id}/${action}`, { method: "POST" });
      if (action === "approve") {
        await queryClient.invalidateQueries({ queryKey: ["applications"] });
      }
      if (activeThread) await loadProposals(activeThread.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("error_generic")); } finally { setActingProposal(null); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void sendMessage(message); }

  return <>
    <button ref={launcherRef} onClick={() => setOpen(true)} className="group fixed bottom-5 right-4 z-40 flex h-12 items-center gap-2 rounded-2xl bg-slate-950 px-3.5 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(15,23,42,0.3)] ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400 sm:bottom-6 sm:right-6" aria-label={t("open_operator")}>
      <span className="relative"><Sparkles className="h-4 w-4" /><span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-slate-950 group-hover:ring-indigo-600" /></span><span className="hidden sm:inline">{t("launcher")}</span>
    </button>

    {open && <div ref={dialogRef} className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("title")} tabIndex={-1}>
      <button className="absolute inset-0 hidden bg-slate-950/35 backdrop-blur-[2px] lg:block" onClick={() => setOpen(false)} aria-label={t("close")} />
      <section className="absolute inset-0 flex overflow-hidden bg-white shadow-2xl dark:bg-[#0f1011] lg:inset-y-3 lg:left-auto lg:right-3 lg:w-[min(920px,calc(100vw-24px))] lg:rounded-[24px] lg:border lg:border-slate-200/80 dark:lg:border-white/10">
        <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} absolute inset-y-0 left-0 z-20 flex w-[min(82vw,260px)] flex-col border-r border-slate-200 bg-slate-50/95 transition-transform dark:border-white/8 dark:bg-[#0b0c0d] lg:static lg:w-60 lg:translate-x-0`}>
          <div className="flex h-16 items-center justify-between px-4"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm"><Sparkles className="h-3.5 w-3.5" /></span><div><p className="text-xs font-semibold text-slate-900 dark:text-white">{t("title")}</p><p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">{t("workspace")}</p></div></div><button aria-label={t("close_history")} onClick={() => setSidebarOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/60 dark:hover:bg-white/5 lg:hidden"><X className="h-4 w-4" /></button></div>
          <div className="px-3"><button onClick={() => void createThread()} disabled={streaming} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-xs font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-40 dark:bg-white dark:text-slate-950"><Plus className="h-3.5 w-3.5" />{t("new_thread")}</button></div>
          <div className="mt-5 flex items-center gap-2 px-4 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400"><History className="h-3 w-3" />{t("history")}</div>
          <div className="mt-2 flex-1 overflow-y-auto px-2 pb-3">
            {threads.length === 0 && <p className="px-2 py-5 text-center text-xs leading-5 text-slate-400">{t("history_empty")}</p>}
            {threads.map((thread) => <div key={thread.id} className={`group flex items-center rounded-xl transition ${activeThread?.id === thread.id ? "bg-white shadow-sm ring-1 ring-slate-200 dark:bg-white/[0.06] dark:ring-white/8" : "hover:bg-slate-200/50 dark:hover:bg-white/[0.03]"}`}><button onClick={() => void selectThread(thread.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left"><span className={`block truncate text-xs font-medium ${activeThread?.id === thread.id ? "text-slate-950 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>{thread.title}</span><span className="mt-1 block text-[10px] text-slate-400">{relativeDate(thread.updatedAt, t("today"))}</span></button><button onClick={() => void deleteThread(thread.id)} aria-label={t("delete_thread")} className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-red-500/10"><Trash2 className="h-3 w-3" /></button></div>)}
          </div>
          <div className="border-t border-slate-200 p-3 dark:border-white/8"><button onClick={() => setSettingsOpen(true)} className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-xs font-medium text-slate-600 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-white/5"><Settings2 className="h-3.5 w-3.5" />{t("settings_title")}<span className={`ml-auto h-1.5 w-1.5 rounded-full ${credentials.length ? "bg-emerald-500" : "bg-amber-500"}`} /></button></div>
        </aside>
        {sidebarOpen && <button className="absolute inset-0 z-10 bg-slate-950/30 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label={t("close_history")} />}

        <div className="relative flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-3 dark:border-white/8 sm:px-5"><button aria-label={t("open_history")} onClick={() => setSidebarOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 lg:hidden"><Menu className="h-4 w-4" /></button><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">{activeThread?.title || t("new_thread")}</h2><div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t("secure_byok")}</div></div>
            {configuredProviders.length > 0 && <div className="relative"><select aria-label={t("provider_label")} value={provider} onChange={(event) => setProvider(event.target.value as ProviderId)} className="h-9 appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-8 text-xs font-medium text-slate-700 outline-none dark:border-white/8 dark:bg-white/[0.04] dark:text-slate-300">{configuredProviders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-3 w-3 text-slate-400" /></div>}
            <button onClick={() => setSettingsOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5" aria-label={t("settings_title")}><Settings2 className="h-4 w-4" /></button><button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5" aria-label={t("close")}><PanelRightClose className="h-4 w-4" /></button>
          </header>

          <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.06),transparent_35%)] px-4 py-5 dark:bg-[radial-gradient(circle_at_50%_0%,rgba(113,112,255,0.08),transparent_35%)] sm:px-7">
            {loading && !activeThread ? <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-indigo-500" /></div> : !credentials.length ? <SetupEmpty onSetup={() => setSettingsOpen(true)} /> : !(activeThread?.messages?.length) ? <Welcome providerLabel={currentProvider?.label} model={currentCredential?.defaultModel} onStarter={(key) => void sendMessage(t(key))} /> : <div className="mx-auto max-w-2xl space-y-5">{activeThread.messages.filter((item) => item.role === "user" || item.role === "assistant").map((item) => <ChatMessage key={item.id} message={item} streaming={streaming && item.role === "assistant" && !item.content} />)}{proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} busy={actingProposal === proposal.id} onApprove={() => void actOnProposal(proposal.id, "approve")} onReject={() => void actOnProposal(proposal.id, "reject")} />)}<div ref={endRef} /></div>}
          </main>

          <footer className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-white/8 dark:bg-[#0f1011] sm:p-4">{error && <div role="alert" className="mx-auto mb-2 max-w-2xl rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</div>}<form onSubmit={submit} className="mx-auto max-w-2xl"><div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2 shadow-sm transition focus-within:border-indigo-400 focus-within:ring-3 focus-within:ring-indigo-500/10 dark:border-white/10 dark:bg-white/[0.035]"><textarea aria-label={t("message_label")} ref={inputRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (message.trim()) void sendMessage(message); } }} disabled={streaming || !credentials.length} rows={1} placeholder={credentials.length ? t("message_placeholder") : t("configure_first")} className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-50 dark:text-white dark:placeholder:text-slate-600" /><button aria-label={t("send_message")} type="submit" disabled={!message.trim() || streaming || !credentials.length} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-indigo-500 dark:hover:bg-indigo-400">{streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</button></div><div className="mt-2 flex items-center justify-between px-1 text-[10px] text-slate-400"><span>{t("enter_hint")}</span><span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />{t("approval_hint")}</span></div></form></footer>
          {settingsOpen && <OperatorSettings providers={providers} credentials={credentials} onCredentialsChange={(next) => { setCredentials(next); if (!next.some((item) => item.provider === provider) && next[0]) setProvider(next[0].provider); }} onClose={() => setSettingsOpen(false)} />}
        </div>
      </section>
    </div>}
  </>;
}

function SetupEmpty({ onSetup }: { onSetup: () => void }) { const t = useTranslations("ai_operator"); return <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20"><ShieldCheck className="h-6 w-6" /></span><h3 className="mt-5 text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">{t("setup_title")}</h3><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{t("setup_description")}</p><button onClick={onSetup} className="mt-6 flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-indigo-600 dark:bg-indigo-500">{t("setup_action")}<ArrowRight className="h-3.5 w-3.5" /></button></div>; }

function Welcome({ providerLabel, model, onStarter }: { providerLabel?: string; model?: string; onStarter: (key: typeof STARTERS[number]) => void }) { const t = useTranslations("ai_operator"); return <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center py-6"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg dark:bg-indigo-500"><Sparkles className="h-5 w-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-indigo-500 dark:text-indigo-300">{t("operator_online")}</p><h3 className="text-xl font-semibold tracking-[-0.035em] text-slate-950 dark:text-white">{t("welcome_title")}</h3></div></div><p className="mt-4 max-w-lg text-sm leading-6 text-slate-500 dark:text-slate-400">{t("welcome_description")}</p><div className="mt-7 grid gap-2 sm:grid-cols-2">{STARTERS.map((key, index) => <button key={key} onClick={() => onStarter(key)} className="group flex min-h-20 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-white/8 dark:bg-white/[0.025] dark:hover:border-indigo-500/40"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:bg-white/5 dark:group-hover:bg-indigo-500/10 dark:group-hover:text-indigo-300">{index === 0 ? <MessageSquare className="h-3.5 w-3.5" /> : index === 1 ? <Clock3 className="h-3.5 w-3.5" /> : index === 2 ? <Sparkles className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}</span><span className="text-xs font-medium leading-5 text-slate-700 dark:text-slate-300">{t(key)}</span><ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" /></button>)}</div><p className="mt-5 text-[10px] text-slate-400">{providerLabel} · {model}</p></div>; }

function ChatMessage({ message, streaming }: { message: AgentMessage; streaming: boolean }) { const t = useTranslations("ai_operator"); const assistant = message.role === "assistant"; return <div className={`flex gap-3 ${assistant ? "" : "justify-end"}`}>{assistant && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><Sparkles className="h-3 w-3" /></span>}<div className={`max-w-[85%] ${assistant ? "" : "rounded-2xl rounded-br-md bg-slate-950 px-4 py-3 text-white dark:bg-indigo-500"}`}>{assistant && <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-indigo-500 dark:text-indigo-300">{t("assistant_label")}</div>}<div className={`whitespace-pre-wrap text-sm leading-6 ${assistant ? "text-slate-700 dark:text-slate-300" : "text-white"}`}>{message.content || (streaming && <span className="inline-flex gap-1"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400 [animation-delay:150ms]" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400 [animation-delay:300ms]" /></span>)}</div></div></div>; }

function ProposalCard({ proposal, busy, onApprove, onReject }: { proposal: ActionProposal; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const t = useTranslations("ai_operator");
  const pending = proposal.status === "pending";
  const mcpPayload = proposal.kind === "mcp_tool" ? proposal.sanitizedPayload : null;
  return <div className="ml-10 overflow-hidden rounded-2xl border border-indigo-200 bg-indigo-50/50 shadow-sm dark:border-indigo-500/20 dark:bg-indigo-500/[0.06]">
    <div className="flex items-center justify-between border-b border-indigo-100 px-4 py-3 dark:border-indigo-500/15"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"><ShieldCheck className="h-3.5 w-3.5" /></span><div><p className="text-xs font-semibold text-slate-900 dark:text-white">{t("proposal_title")}</p><p className="text-[10px] text-slate-500">{proposal.targetType === "application" ? t("proposal_target", { id: proposal.targetId }) : t("proposal_target_connector", { id: proposal.targetId })}</p></div></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${pending ? "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" : proposal.status === "applied" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-white/5"}`}>{t(`status_${proposal.status}` as "status_pending")}</span></div>
    <div className="space-y-2 p-4">
      {proposal.assumptions?.reason && <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">{proposal.assumptions.reason}</p>}
      {mcpPayload?.toolName && <div className="text-xs"><span className="font-medium text-slate-500">{t("proposal_tool")}</span><span className="ml-3 font-mono font-semibold text-slate-800 dark:text-slate-200">{mcpPayload.toolName}</span></div>}
      {mcpPayload?.arguments && <div className="text-xs"><div className="mb-1 font-medium text-slate-500">{t("proposal_arguments")}</div><pre className="overflow-x-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">{JSON.stringify(mcpPayload.arguments, null, 2)}</pre></div>}
      {proposal.expectedDiff.map((diff) => <div key={diff.field} className="grid grid-cols-[90px_1fr] gap-3 text-xs"><span className="font-medium capitalize text-slate-500">{fieldLabel(diff.field)}</span><span className="min-w-0 text-slate-700 dark:text-slate-300"><span className="line-through opacity-50">{formatValue(diff.from)}</span><ArrowRight className="mx-1.5 inline h-3 w-3 text-indigo-400" /><span className="font-medium">{formatValue(diff.to)}</span></span></div>)}
    </div>
    {pending && <div className="flex justify-end gap-2 border-t border-indigo-100 px-4 py-3 dark:border-indigo-500/15"><button onClick={onReject} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-white disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/5"><XCircle className="h-3.5 w-3.5" />{t("reject")}</button><button onClick={onApprove} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{t("approve")}</button></div>}
  </div>;
}

function formatValue(value: unknown) { if (value === null || value === undefined || value === "") return "—"; if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value); return JSON.stringify(value); }
function fieldLabel(field: string) { return field.replace(/([A-Z])/g, " $1").trim(); }
function relativeDate(value: string, today: string) { const date = new Date(value); const now = new Date(); if (date.toDateString() === now.toDateString()) return today; return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
