"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Briefcase,
  Check,
  CircleSlash,
  Compass,
  Globe,
  History,
  Loader2,
  Plus,
  Send,
  ShieldQuestion,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  CareerOpsRequestError,
  careerOpsJson,
  type CareerOpsApplicationContext,
  type CareerOpsMessage,
  type CareerOpsStatus,
  type CareerOpsThread,
  type RunPhase,
} from "./types";
import { useCareerOpsRun } from "./use-career-ops-run";

/** Stable id linking the history disclosure button to the panel it controls. */
const HISTORY_PANEL_ID = "career-ops-history";

export function CareerOps({
  application,
  variant = "floating",
}: {
  application?: CareerOpsApplicationContext;
  variant?: "floating" | "inline";
}) {
  const t = useTranslations("career_ops");
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<CareerOpsStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threads, setThreads] = useState<CareerOpsThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CareerOpsMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /** True when the last transcript load failed, so the empty state is wrong. */
  const [transcriptFailed, setTranscriptFailed] = useState(false);
  // The opportunity the *active* thread acts on, as resolved by the server.
  // Needed because that thread is often not the one whose page is on screen.
  const [threadApplication, setThreadApplication] = useState<CareerOpsApplicationContext | null>(
    null,
  );
  /**
   * Monotonic selection counter. Two thread selections can be in flight at
   * once, and without this an older response can land after a newer selection
   * and replace the transcript, the application context, or the run controls —
   * so the user could stop or deny one conversation's run while another is on
   * screen. Every state update from an async load checks its generation first.
   */
  const selectionRef = useRef(0);
  const [compact, setCompact] = useState(false);
  const [mounted, setMounted] = useState(false);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const onSettled = useCallback(
    (phase: RunPhase) => {
      if (phase !== "completed") return;
      // An approved Career Ops action may have changed Nexus data through the
      // MCP server, so the workspace must not keep showing the pre-run state.
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
    [queryClient],
  );

  const { state: run, start, resume, stop, decideApproval, reset } = useCareerOpsRun({
    onSettled,
    runTimeoutMs: status?.runTimeoutMs,
  });

  // Read the live run inside callbacks without making them depend on it.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    let cancelled = false;
    careerOpsJson<CareerOpsStatus>("/api/career-ops/status")
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({
            enabled: false,
            available: false,
            reason: "unreachable",
            capabilities: { stop: false, approvals: false, streaming: false },
            runTimeoutMs: 0,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  // Three distinct states. A thread scoped to a *different* application must
  // never borrow the displayed application's name: the service sends the
  // thread's own id upstream, so a mismatched label would let the user approve
  // work believing it targets the opportunity on screen.
  const contextScope: "global" | "named" | "other" = !activeThread?.applicationId
    ? "global"
    : application && activeThread.applicationId === application.id
      ? "named"
      : "other";

  const loadMessages = useCallback(async (threadId: string, generation: number) => {
    try {
      const result = await careerOpsJson<{ messages: CareerOpsMessage[] }>(
        `/api/career-ops/threads/${threadId}/messages`,
      );
      if (selectionRef.current !== generation) return;
      setMessages(result.messages);
      setTranscriptFailed(false);
    } catch (reason) {
      if (selectionRef.current !== generation) return;
      // A failed fetch is not an empty conversation. Clearing the transcript
      // would show the "no messages yet" onboarding state for a thread that
      // has history, so keep what is on screen and say the load failed.
      setTranscriptFailed(true);
      setErrorCode(reason instanceof CareerOpsRequestError ? reason.code : "error_generic");
    }
  }, []);

  /**
   * Rejoin a run still in flight on this thread. Without this, a reload during
   * a run leaves an idle composer while the agent is still working — the user
   * cannot observe, stop or approve it, and could start a second one.
   */
  const rejoinActiveRun = useCallback(
    async (threadId: string, generation: number) => {
      try {
        const result = await careerOpsJson<{
          application: CareerOpsApplicationContext | null;
          activeRun: { id: string } | null;
        }>(`/api/career-ops/threads/${threadId}`);
        if (selectionRef.current !== generation) return;
        setThreadApplication(result.application ?? null);
        if (!result.activeRun) {
          // The transcript just reloaded from Hermes and already contains the
          // finished reply; leaving the hook's completed answer in place would
          // render it a second time.
          reset();
          return;
        }
        // Already tracking this run — its stream is live and it may hold a
        // detailed approval prompt. Resuming would abort the stream and
        // downgrade that prompt to the denial-only recovered form.
        if (runRef.current.runId === result.activeRun.id) return;
        await resume(result.activeRun.id);
      } catch {
        if (selectionRef.current !== generation) return;
        // A thread that cannot be inspected simply stays idle. Its context is
        // unknown rather than absent, so fall back to the unnamed badge.
        setThreadApplication(null);
      }
    },
    [reset, resume],
  );

  const createThread = useCallback(
    async (withApplication: boolean) => {
      setErrorCode(null);
      const body = withApplication && application ? { applicationId: application.id } : {};
      const result = await careerOpsJson<{ thread: CareerOpsThread }>("/api/career-ops/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      selectionRef.current += 1;
      setThreads((current) => [result.thread, ...current]);
      setActiveThreadId(result.thread.id);
      setThreadApplication(withApplication && application ? application : null);
      setTranscriptFailed(false);
      setMessages([]);
      setHistoryOpen(false);
      reset();
      return result.thread;
    },
    [application, reset],
  );

  /**
   * `createThread` rejects on upstream or persistence failure. The direct
   * controls discard its promise, so without this the rejection is unhandled
   * and the button just appears dead; the initial load has its own catch.
   */
  const createThreadSafely = useCallback(
    async (withApplication: boolean) => {
      try {
        await createThread(withApplication);
      } catch (reason) {
        setErrorCode(reason instanceof CareerOpsRequestError ? reason.code : "error_generic");
      }
    },
    [createThread],
  );

  const loadThreads = useCallback(async () => {
    setLoading(true);
    setErrorCode(null);
    try {
      const result = await careerOpsJson<{ threads: CareerOpsThread[] }>("/api/career-ops/threads");
      setThreads(result.threads);
      const preferred = application
        ? result.threads.find((thread) => thread.applicationId === application.id)
        : result.threads.find((thread) => thread.applicationId === null);
      if (preferred) {
        setActiveThreadId(preferred.id);
        const generation = ++selectionRef.current;
        await loadMessages(preferred.id, generation);
        await rejoinActiveRun(preferred.id, generation);
      } else {
        const created = await createThread(Boolean(application));
        setActiveThreadId(created.id);
      }
    } catch (reason) {
      setErrorCode(reason instanceof CareerOpsRequestError ? reason.code : "error_generic");
    } finally {
      setLoading(false);
    }
  }, [application, createThread, loadMessages, rejoinActiveRun]);

  useEffect(() => {
    if (!open || !status?.available) return;
    void loadThreads();
    // Re-running on every loadThreads identity change would restart the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status?.available]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (historyOpen) setHistoryOpen(false);
      else if (run.phase !== "waiting_approval") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, historyOpen, run.phase]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const launcher = launcherRef.current;
    if (!dialog) return;
    const selector =
      "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) {
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
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      launcher?.focus();
    };
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, run.answer, run.tools.length]);

  // A run awaiting a human decision is still in flight. Leaving the composer
  // and thread controls live would let a new run abort the pending one's stream
  // while the first privileged action is still undecided, or discard the only
  // visible approval prompt. Only the approval controls stay operable.
  const busy =
    run.phase === "starting" ||
    run.phase === "streaming" ||
    run.phase === "reconnecting" ||
    run.phase === "waiting_approval";

  async function selectThread(threadId: string) {
    if (busy) return;
    // Claim a generation up front: any load still in flight for the previously
    // selected thread becomes stale here and will discard its own result.
    const generation = ++selectionRef.current;
    setActiveThreadId(threadId);
    setHistoryOpen(false);
    setThreadApplication(null);
    setTranscriptFailed(false);
    // Drop the previous conversation's transcript before its successor loads.
    // Keeping it on a failed load would show one conversation's history under
    // another's identity, while submissions went to the new one.
    setMessages([]);
    reset();
    await loadMessages(threadId, generation);
    await rejoinActiveRun(threadId, generation);
  }

  async function removeThread(threadId: string) {
    if (busy) return;
    try {
      await careerOpsJson(`/api/career-ops/threads/${threadId}`, { method: "DELETE" });
    } catch (reason) {
      // Deletion legitimately fails while a run is still in flight. Removing
      // the row anyway would claim it worked and hide the conversation.
      setErrorCode(reason instanceof CareerOpsRequestError ? reason.code : "error_generic");
      return;
    }
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setMessages([]);
      setThreadApplication(null);
      reset();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || !activeThreadId) return;
    setDraft("");
    // Move the finished answer of the previous turn into the transcript before
    // the next run resets the live buffer, so earlier replies stay visible.
    const previousAnswer = run.answer;
    const optimisticId = `local-${Date.now()}`;
    setMessages((current) => [
      ...current,
      ...(previousAnswer
        ? [{ id: `answer-${current.length}`, role: "assistant" as const, content: previousAnswer }]
        : []),
      { id: optimisticId, role: "user" as const, content: message },
    ]);

    const accepted = await start(activeThreadId, message);
    if (!accepted) {
      // Nothing was sent. Drop only the unsent message: `start` has already
      // reset the live run, so the previous turn's answer now exists only in
      // the copy just made — restoring a pre-submit snapshot would erase it.
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setDraft((current) => (current === "" ? message : current));
    }
  }

  // The trigger is hidden entirely when the integration is not configured:
  // offering a control that cannot work is worse than not offering it.
  if (!status || !status.enabled) return null;

  const statusLabel = ((): string => {
    switch (run.phase) {
      case "starting":
        return t("status_starting");
      case "streaming":
        return t("status_streaming");
      case "waiting_approval":
        return t("status_waiting_approval");
      case "reconnecting":
        return t("status_reconnecting");
      case "completed":
        return t("status_completed");
      case "failed":
        return t("status_failed");
      case "cancelled":
        return t("status_cancelled");
      default:
        return t("status_idle");
    }
  })();

  const unavailableBody =
    status.reason === "degraded"
      ? t("unavailable_degraded")
      : status.reason === "unsupported"
        ? t("unavailable_unsupported")
        : t("unavailable_body");

  const launcherLabel = application
    ? t("launcher_with_context", { company: application.company })
    : t("launcher");

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={
          variant === "inline"
            ? "nexus-button-ghost nexus-target nexus-focus-ring inline-flex shrink-0 items-center gap-2"
            : "nexus-focus-ring group fixed bottom-5 right-4 z-40 flex h-12 items-center gap-2 rounded-2xl bg-slate-950 px-3.5 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(15,23,42,0.3)] ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:bg-indigo-600 sm:bottom-6 sm:right-6 lg:right-auto lg:left-6 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        }
      >
        <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className={variant === "inline" ? "" : "hidden sm:inline"}>{launcherLabel}</span>
      </button>

      {open &&
        mounted &&
        createPortal(
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal={compact ? true : undefined}
          aria-label={t("title")}
          tabIndex={-1}
          className="fixed inset-0 z-50 lg:pointer-events-none"
        >
          <section className="absolute inset-0 flex flex-col overflow-hidden bg-white shadow-2xl lg:pointer-events-auto lg:left-auto lg:w-[min(680px,46vw)] lg:border-l lg:border-slate-200/80 dark:bg-[#0f1011] dark:lg:border-white/10">
            <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 px-4 dark:border-white/8">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
                  <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {t("title")}
                  </p>
                  <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    {t("subtitle")}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((value) => !value)}
                  aria-label={historyOpen ? t("close_history") : t("open_history")}
                  aria-expanded={historyOpen}
                  aria-controls={HISTORY_PANEL_ID}
                  className="nexus-target nexus-focus-ring flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("close")}
                  className="nexus-target nexus-focus-ring flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="flex items-center gap-2 border-b border-slate-200/80 px-4 py-2 text-xs dark:border-white/8">
              {contextScope !== "global" ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                    <Briefcase className="h-3 w-3" aria-hidden="true" />
                    {t("context_application")}:{" "}
                    {contextScope === "named" && application
                      ? `${application.company} — ${application.role}`
                      : threadApplication
                        ? `${threadApplication.company} — ${threadApplication.role}`
                        : t("context_application_other")}
                  </span>
                  <button
                    type="button"
                    onClick={() => void createThreadSafely(false)}
                    disabled={busy}
                    className="nexus-focus-ring rounded-full px-2 py-1 font-medium text-slate-500 underline-offset-2 hover:underline disabled:opacity-40"
                  >
                    {t("context_switch_global")}
                  </button>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 dark:bg-white/5 dark:text-slate-300">
                  <Globe className="h-3 w-3" aria-hidden="true" />
                  {t("context_global")}
                </span>
              )}
            </div>

            {historyOpen && (
              <div
                id={HISTORY_PANEL_ID}
                role="region"
                aria-label={t("open_history")}
                className="max-h-64 shrink-0 overflow-y-auto border-b border-slate-200/80 px-2 py-2 dark:border-white/8"
              >
                <button
                  type="button"
                  onClick={() => void createThreadSafely(Boolean(application))}
                  disabled={busy}
                  className="nexus-focus-ring mb-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-950"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("new_thread")}
                </button>
                {threads.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-slate-400">{t("history_empty")}</p>
                ) : (
                  <ul className="space-y-1">
                    {threads.map((thread) => (
                      <li key={thread.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void selectThread(thread.id)}
                          aria-current={thread.id === activeThreadId ? "true" : undefined}
                          className={`nexus-focus-ring min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-xs ${
                            thread.id === activeThreadId
                              ? "bg-slate-100 font-semibold text-slate-950 dark:bg-white/8 dark:text-white"
                              : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-white/5"
                          }`}
                        >
                          {thread.title}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeThread(thread.id)}
                          aria-label={`${t("delete_thread")}: ${thread.title}`}
                          className="nexus-focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {!status.available ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {t("unavailable_title")}
                </p>
                <p className="max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {unavailableBody}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStatus(null);
                    void careerOpsJson<CareerOpsStatus>("/api/career-ops/status")
                      .then(setStatus)
                      .catch(() =>
                        setStatus({
                          enabled: true,
                          available: false,
                          reason: "unreachable",
                          capabilities: { stop: false, approvals: false, streaming: false },
                          runTimeoutMs: 0,
                        }),
                      );
                  }}
                  className="nexus-button-ghost nexus-target nexus-focus-ring"
                >
                  {t("retry")}
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {loading && (
                    <p className="text-center text-xs text-slate-400">{t("loading")}</p>
                  )}

                  {!loading && transcriptFailed && messages.length === 0 && (
                    <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                      {t("transcript_unavailable")}
                    </p>
                  )}

                  {!loading && !transcriptFailed && messages.length === 0 && !run.answer && (
                    <div className="mx-auto max-w-sm py-8 text-center">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {t("empty_title")}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {contextScope === "named" && application
                          ? t("empty_application_body", {
                              company: application.company,
                              role: application.role,
                            })
                          : t("empty_body")}
                      </p>
                    </div>
                  )}

                  <ul className="space-y-4">
                    {messages.map((message) => (
                      <li key={message.id} className="text-sm">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          {message.role === "user" ? t("you") : t("assistant")}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">
                          {message.content}
                        </p>
                      </li>
                    ))}
                    {run.answer && (
                      <li className="text-sm">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          {t("assistant")}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">
                          {run.answer}
                        </p>
                      </li>
                    )}
                  </ul>

                  {run.tools.length > 0 && (
                    <ul className="mt-4 space-y-1" aria-label={t("status_streaming")}>
                      {run.tools.map((tool, index) => (
                        <li
                          key={`${tool.tool}-${index}`}
                          className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
                        >
                          {tool.state === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                          ) : tool.state === "failed" ? (
                            <CircleSlash className="h-3 w-3 text-red-500" aria-hidden="true" />
                          ) : (
                            <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                          )}
                          <span>
                            {tool.state === "running"
                              ? t("tool_running", { tool: tool.tool })
                              : tool.state === "failed"
                                ? t("tool_failed", { tool: tool.tool })
                                : t("tool_done", { tool: tool.tool })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {run.approval && (
                    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                      <p className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                        <ShieldQuestion className="h-4 w-4" aria-hidden="true" />
                        {t("approval_title")}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-amber-900/90 dark:text-amber-100/90">
                        {run.approval.detailsUnavailable
                          ? t("approval_details_unavailable")
                          : run.approval.summary}
                      </p>
                      {run.approval.operation && (
                        <p className="mt-2 text-[11px] text-amber-900/80 dark:text-amber-100/80">
                          {t("approval_operation")}: <code>{run.approval.operation}</code>
                        </p>
                      )}
                      {run.approval.details && (
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-white/70 p-2 text-[11px] text-amber-950 dark:bg-black/30 dark:text-amber-100">
                          {run.approval.details}
                        </pre>
                      )}
                      {status.capabilities.approvals ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {run.approval.choices.includes("once") && (
                            <button
                              type="button"
                              onClick={() => void decideApproval("once")}
                              className="nexus-target nexus-focus-ring rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white dark:bg-white dark:text-slate-950"
                            >
                              {t("approval_approve")}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void decideApproval("deny")}
                            className="nexus-target nexus-focus-ring rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 dark:border-white/20 dark:text-slate-200"
                          >
                            {t("approval_reject")}
                          </button>
                        </div>
                      ) : (
                        <p className="mt-3 text-[11px] font-medium text-amber-900 dark:text-amber-200">
                          {t("approval_unsupported")}
                        </p>
                      )}
                    </div>
                  )}

                  {(errorCode || run.errorCode) && (
                    <p
                      role="alert"
                      className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {(() => {
                        const code = run.errorCode ?? errorCode;
                        if (code === "rate_limited") return t("error_rate_limited");
                        if (code === "conflict") return t("error_conflict");
                        return t("error_generic");
                      })()}
                    </p>
                  )}

                  <div ref={endRef} />
                </div>

                <div className="shrink-0 border-t border-slate-200/80 px-4 py-3 dark:border-white/8">
                  {/* Announces run state transitions, not individual tokens. */}
                  <p
                    aria-live="polite"
                    className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400"
                  >
                    {busy && (
                      <Loader2
                        className="h-3 w-3 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    )}
                    {statusLabel}
                  </p>
                  <form onSubmit={submit} className="flex items-end gap-2">
                    <label htmlFor="career-ops-composer" className="sr-only">
                      {t("composer_label")}
                    </label>
                    <textarea
                      id="career-ops-composer"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={
                        activeThread?.applicationId
                          ? t("composer_placeholder")
                          : t("composer_placeholder_global")
                      }
                      rows={2}
                      maxLength={8000}
                      disabled={!activeThreadId}
                      className="nexus-focus-ring min-h-[44px] w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
                    />
                    {busy && status.capabilities.stop ? (
                      <button
                        type="button"
                        onClick={() => void stop()}
                        className="nexus-target nexus-focus-ring flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 dark:border-white/20 dark:text-slate-200"
                      >
                        <Square className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("stop")}
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={busy || !draft.trim() || !activeThreadId}
                        className="nexus-target nexus-focus-ring flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-950"
                      >
                        {busy ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {busy ? t("sending") : t("send")}
                      </button>
                    )}
                  </form>
                  {busy && !status.capabilities.stop && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Wrench className="h-3 w-3" aria-hidden="true" />
                      {t("stop_unsupported")}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>,
          document.body,
        )}
    </>
  );
}
