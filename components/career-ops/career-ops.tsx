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
import { useRouter } from "next/navigation";
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
  newClientRequestId,
  type CareerOpsApplicationContext,
  type CareerOpsMessage,
  type CareerOpsStatus,
  type CareerOpsThread,
  type RunPhase,
} from "./types";
import { useCareerOpsRun } from "./use-career-ops-run";

/** Stable id linking the history disclosure button to the panel it controls. */
const HISTORY_PANEL_ID = "career-ops-history";

/**
 * Phases in which the hook still holds Hermes's event stream.
 *
 * That stream is single-consumer, so aborting it cannot be undone: whatever it
 * would have delivered is gone, and only status polling remains.
 */
/** What a capability is worth before Hermes has said otherwise: nothing. */
const UNSUPPORTED = { stop: false, approvals: false, streaming: false } as const;

/**
 * Make an untrusted status body into a `CareerOpsStatus` that is actually one.
 *
 * Defaulting only `capabilities` left the rest unchecked, and the field that
 * matters most fails in the worst direction: `enabled` missing reads as
 * "this deployment has not configured Career Ops", which removes the launcher
 * outright — so a mixed-version response or a proxy body of `{}` made the
 * feature disappear along with the retry that would have recovered it. An
 * unrecognizable body is enabled-but-unavailable, the state the user can leave.
 */
function normalizeStatus(body: Partial<CareerOpsStatus> | null | undefined): CareerOpsStatus {
  return {
    enabled: body?.enabled !== false,
    available: body?.available === true,
    reason: typeof body?.reason === "string" ? body.reason : body?.available === true ? null : "degraded",
    capabilities: { ...UNSUPPORTED, ...body?.capabilities },
    runTimeoutMs: typeof body?.runTimeoutMs === "number" ? body.runTimeoutMs : 0,
  };
}

const LIVE_RUN_PHASES: RunPhase[] = [
  "starting",
  "streaming",
  "reconnecting",
  "waiting_approval",
];

export function CareerOps({
  application,
  variant = "floating",
}: {
  application?: CareerOpsApplicationContext;
  variant?: "floating" | "inline";
}) {
  const t = useTranslations("career_ops");
  const queryClient = useQueryClient();
  const router = useRouter();

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
  /**
   * True when the active run could not be looked up.
   *
   * Distinct from "no run": an uninspected conversation may hold one, and
   * submitting into that state only earns a server-side conflict.
   */
  const [runStateUnknown, setRunStateUnknown] = useState(false);
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
  /** True while a conversation is being created, so a double click makes one. */
  const creatingRef = useRef(false);
  /**
   * A submission whose outcome the browser never learned, with the text it
   * carried. The id may only be reused for that same text: the server resolves
   * it to the run that already exists, so reusing it for an edited draft would
   * show the user one question while the agent answers another.
   */
  const pendingRequestRef = useRef<{ id: string; message: string } | null>(null);
  const [compact, setCompact] = useState(false);
  const [mounted, setMounted] = useState(false);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const onSettled = useCallback(
    (phase: RunPhase) => {
      // Every terminal phase, not just success: a run that later failed or was
      // cancelled may already have committed a CRM mutation through the MCP
      // server, and nothing rolls that back. Showing pre-run data afterwards
      // would be wrong in exactly the cases the user is most likely to check.
      if (!["completed", "failed", "cancelled"].includes(phase)) return;
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      // The keys the affected surfaces actually use. `["activity"]` reads like
      // the right prefix but nothing subscribes to it, so invalidating it left
      // the timeline and the activity feed showing pre-run data.
      void queryClient.invalidateQueries({ queryKey: ["application-events"] });
      void queryClient.invalidateQueries({ queryKey: ["application-activity"] });
      // The detail page's facts come from a server prop, not a query, so no
      // amount of cache invalidation refreshes them.
      router.refresh();
    },
    [queryClient, router],
  );

  const { state: run, start, resume, stop, decideApproval, reset } = useCareerOpsRun({
    onSettled,
    runTimeoutMs: status?.runTimeoutMs,
    streaming: status?.capabilities.streaming,
  });

  // Read the live run inside callbacks without making them depend on it.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  /**
   * The conversation currently on screen, readable after an await.
   *
   * A closure captures `activeThreadId` from the render that created it, and
   * deletion is live while the user can still switch conversations. Comparing
   * the captured value after the request had it both ways: deleting the active
   * conversation and selecting another before the response landed cleared the
   * newly loaded one, and deleting an inactive conversation the user selected
   * meanwhile left it on screen as the active one after it was gone.
   */
  const activeThreadIdRef = useRef(activeThreadId);
  /**
   * Set the selection and the ref together.
   *
   * Mirroring it from an effect was not enough: the effect runs after the
   * render commits, so a deletion resolving in between still read the previous
   * selection — the same stale comparison, in a narrower window. The ref has to
   * move in the same statement as the state.
   */
  const selectActiveThread = useCallback((threadId: string | null) => {
    activeThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
  }, []);

  /**
   * Read the availability status, and never end up in a state the user cannot
   * leave.
   *
   * Two rules, and both paths need both — the initial read and the retry button
   * used to disagree on each of them:
   *
   * - A failed read is `enabled: true, available: false`. `enabled: false` is
   *   reserved for a deployment that has not configured Career Ops at all, and
   *   it removes the launcher entirely — so answering a transient network blip
   *   with it hid the very drawer whose retry action is the way back, and only
   *   a full page reload recovered.
   * - The response is JSON, not a `CareerOpsStatus`; the cast is a claim, not a
   *   check. Normalize it, or an unexpected body (an old build, a proxy error
   *   page served as JSON) reaches `status.capabilities.streaming` and throws
   *   inside render, taking the page down with it.
   */
  const loadStatus = useCallback(async (accept: () => boolean = () => true) => {
    try {
      const result = await careerOpsJson<CareerOpsStatus>("/api/career-ops/status");
      if (accept()) setStatus(normalizeStatus(result));
    } catch {
      if (accept()) {
        setStatus({
          enabled: true,
          available: false,
          reason: "unreachable",
          capabilities: { ...UNSUPPORTED },
          runTimeoutMs: 0,
        });
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadStatus(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

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

  /**
   * Load a conversation's transcript, returning when the server took the
   * snapshot.
   *
   * The caller needs that instant, not the moment the response arrived: the
   * transcript describes Hermes as of the read, and the run-state request that
   * follows can report a run that settled after it. The instant comes from the
   * server, deliberately — comparing it against `Date.now()` here would make
   * the check depend on how far this browser's clock had drifted from Nexus',
   * and a clock a second fast silently skipped the corrective reload.
   */
  const loadMessages = useCallback(async (threadId: string, generation: number) => {
    try {
      const result = await careerOpsJson<{ messages: CareerOpsMessage[]; readAt?: string }>(
        `/api/career-ops/threads/${threadId}/messages`,
      );
      if (selectionRef.current !== generation) return;
      setMessages(result.messages);
      setTranscriptFailed(false);
      const readAt = result.readAt ? Date.parse(result.readAt) : NaN;
      return Number.isNaN(readAt) ? undefined : readAt;
    } catch (reason) {
      if (selectionRef.current !== generation) return;
      // A failed fetch is not an empty conversation. Clearing the transcript
      // would show the "no messages yet" onboarding state for a thread that
      // has history, so keep what is on screen and say the load failed.
      setTranscriptFailed(true);
      setErrorCode(reason instanceof CareerOpsRequestError ? reason.code : "error_generic");
      // A failed read is not a snapshot of anything, so there is nothing for
      // the caller to compare a settle time against.
      return undefined;
    }
  }, []);

  /**
   * Rejoin a run still in flight on this thread. Without this, a reload during
   * a run leaves an idle composer while the agent is still working — the user
   * cannot observe, stop or approve it, and could start a second one.
   */
  const rejoinActiveRun = useCallback(
    async (threadId: string, generation: number, transcriptReadAt?: number) => {
      try {
        const result = await careerOpsJson<{
          thread: CareerOpsThread;
          application: CareerOpsApplicationContext | null;
          activeRun: { id: string } | null;
          settledAt: string | null;
        }>(`/api/career-ops/threads/${threadId}`);
        if (selectionRef.current !== generation) return;
        setRunStateUnknown(false);
        // Refresh the stored record too. The scope badge is derived from it,
        // and deleting an application detaches the conversation server-side —
        // so a stale snapshot would keep naming an opportunity the agent is no
        // longer scoped to.
        setThreads((current) =>
          current.map((thread) => (thread.id === threadId ? result.thread : thread)),
        );
        setThreadApplication(result.application ?? null);
        if (!result.activeRun) {
          // The transcript just reloaded from Hermes and already contains the
          // finished reply; leaving the hook's completed answer in place would
          // render it a second time.
          reset();
          // Unless the run settled *after* that transcript was read. Then the
          // reply is not in it, nothing is in flight to produce it, and the
          // conversation would sit showing a question with no answer until
          // something else happened to reload it. Read it once more.
          // Both instants come from the Nexus server clock, so this compares
          // like with like. A missing or unparseable one means the comparison
          // cannot be made, and the reload is skipped rather than guessed at.
          const settledAt = result.settledAt ? Date.parse(result.settledAt) : NaN;
          if (transcriptReadAt !== undefined && settledAt >= transcriptReadAt) {
            await loadMessages(threadId, generation);
          }
          return;
        }
        // Already tracking this run — its stream is live and it may hold a
        // detailed approval prompt. Resuming would abort the stream and
        // downgrade that prompt to the denial-only recovered form.
        if (runRef.current.runId === result.activeRun.id) return;
        await resume(result.activeRun.id);
      } catch {
        if (selectionRef.current !== generation) return;
        // A conversation that could not be inspected is not known to be idle.
        // Both callers have already reset the run hook, so leaving it here
        // would show an enabled composer with no Stop and no approval controls
        // for a conversation that may well have a run in flight — and the only
        // feedback would be the server's conflict on the next submission.
        // Block submission and say the state is unknown; reopening retries.
        setRunStateUnknown(true);
        setErrorCode("error_run_state_unknown");
        setThreadApplication(null);
      }
    },
    [loadMessages, reset, resume],
  );

  /**
   * Re-read a conversation's stored record. The scope badge is derived from it,
   * and the server can detach a conversation from its opportunity — deleting an
   * application clears the link — so a snapshot taken when the drawer opened
   * would keep naming an opportunity the agent is no longer scoped to.
   */
  const refreshThreadScope = useCallback(async (threadId: string) => {
    const generation = selectionRef.current;
    try {
      const result = await careerOpsJson<{
        thread: CareerOpsThread;
        application: CareerOpsApplicationContext | null;
      }>(`/api/career-ops/threads/${threadId}`);
      // Safe whichever conversation is on screen: this row is keyed by id.
      setThreads((current) =>
        current.map((thread) => (thread.id === threadId ? result.thread : thread)),
      );
      // The scope badge is not. A refresh started for the conversation that
      // just settled can land after the user has selected another one, and
      // applying it then names one opportunity while messages and approvals go
      // to a different one.
      if (selectionRef.current !== generation) return;
      setThreadApplication(result.application ?? null);
    } catch {
      // Leave the last known scope in place; the next selection re-reads it.
    }
  }, []);

  const createThread = useCallback(
    async (withApplication: boolean, stillCurrent: () => boolean = () => true) => {
      setErrorCode(null);
      const body = withApplication && application ? { applicationId: application.id } : {};
      const result = await careerOpsJson<{ thread: CareerOpsThread }>("/api/career-ops/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // The conversation exists either way, so it joins the list. What must be
      // conditional is *selecting* it: a slow creation returning after the user
      // moved on would switch away from — and reset — a run that is still
      // executing, aborting its single-consumer stream for good.
      setThreads((current) => [result.thread, ...current]);
      if (!stillCurrent()) return result.thread;
      selectionRef.current += 1;
      selectActiveThread(result.thread.id);
      setThreadApplication(withApplication && application ? application : null);
      setTranscriptFailed(false);
      // A conversation created a moment ago cannot have a run in flight, so the
      // unknown-run lock left by a failed lookup on the *previous* conversation
      // does not describe this one. Left set, `busy` kept the composer disabled
      // on a conversation whose state is not in doubt at all.
      setRunStateUnknown(false);
      setMessages([]);
      setHistoryOpen(false);
      reset();
      return result.thread;
    },
    [application, reset, selectActiveThread],
  );

  /**
   * `createThread` rejects on upstream or persistence failure. The direct
   * controls discard its promise, so without this the rejection is unhandled
   * and the button just appears dead; the initial load has its own catch.
   */
  const createThreadSafely = useCallback(
    async (withApplication: boolean) => {
      // A double click enters here twice before either request has changed any
      // state, and each would create a Hermes session and a Nexus conversation.
      // `busy` cannot cover this: it only turns true once a run starts.
      if (creatingRef.current) return;
      creatingRef.current = true;
      // Creation is not serialized against selection or submission, so a slow
      // POST can return after the user has selected another conversation and
      // started a run in it. Adopting that response would advance the
      // generation, switch away, and reset — aborting the single-consumer
      // stream of a run that is still executing. Bind the response to the
      // selection it was started from.
      const startedAt = selectionRef.current;
      try {
        await createThread(withApplication, () => selectionRef.current === startedAt);
      } catch (reason) {
        setErrorCode(reason instanceof CareerOpsRequestError ? reason.code : "error_generic");
      } finally {
        creatingRef.current = false;
      }
    },
    [createThread],
  );

  const loadThreads = useCallback(async () => {
    // Closing and reopening the drawer starts another load while the first is
    // still in flight. Both would see no matching conversation and both would
    // create one — two Hermes sessions and two Nexus conversations for a user
    // who opened a drawer twice. The generation makes the later load the only
    // one allowed to create or select.
    let generation = ++selectionRef.current;
    const current = () => selectionRef.current === generation;

    setLoading(true);
    setErrorCode(null);
    try {
      const result = await careerOpsJson<{ threads: CareerOpsThread[] }>("/api/career-ops/threads");
      if (!current()) return;
      setThreads(result.threads);
      const preferred = application
        ? result.threads.find((thread) => thread.applicationId === application.id)
        : result.threads.find((thread) => thread.applicationId === null);
      if (preferred) {
        // Reopening onto the conversation whose run is still live must not
        // disturb it. The hook stays mounted while the drawer is closed and
        // holds the only subscription to Hermes's single-consumer event stream,
        // so resetting here would abort it — rejoin could then only poll
        // status, losing deltas and tool progress and downgrading any approval
        // prompt to the denial-only recovered form.
        const keepsLiveRun =
          preferred.id === activeThreadId && LIVE_RUN_PHASES.includes(runRef.current.phase);
        if (!keepsLiveRun) {
          // Commit the identity and the state that belongs to it together.
          // React batches these into one render, so the drawer never shows the
          // previous conversation's transcript, run controls or scope badge
          // under the newly selected conversation's id.
          setMessages([]);
          setThreadApplication(null);
          setTranscriptFailed(false);
          pendingRequestRef.current = null;
          reset();
        }
        selectActiveThread(preferred.id);
        const readAt = await loadMessages(preferred.id, generation);
        if (!current()) return;
        await rejoinActiveRun(preferred.id, generation, readAt);
      } else if (!creatingRef.current) {
        // The same lock the New-conversation control takes, for the same
        // reason. A first-time user opening the drawer starts this creation,
        // and the history panel's control is live while it is in flight: two
        // Hermes sessions and two Nexus conversations came out of one click
        // landing here. Serializing only the direct clicks left this path
        // outside the lock, which is where the second one came from.
        creatingRef.current = true;
        try {
          // `createThread` starts a new selection of its own, so adopt that
          // generation rather than treating this load's own creation as stale —
          // otherwise the guard below never runs and the drawer stays on the
          // loading state forever for a first-time user. A concurrent load
          // would have bumped it further, which this still detects.
          const before = selectionRef.current;
          const created = await createThread(Boolean(application));
          if (selectionRef.current !== before + 1) return;
          generation = selectionRef.current;
          selectActiveThread(created.id);
        } finally {
          creatingRef.current = false;
        }
      }
      // Otherwise a creation is already running — it will select what it
      // creates, and starting a second one here is the duplicate this guards.
    } catch (reason) {
      if (!current()) return;
      setErrorCode(reason instanceof CareerOpsRequestError ? reason.code : "error_generic");
    } finally {
      if (current()) setLoading(false);
    }
  }, [
    activeThreadId,
    application,
    createThread,
    loadMessages,
    rejoinActiveRun,
    reset,
    selectActiveThread,
  ]);

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
    // Only the compact sheet is modal. At desktop widths the drawer sits beside
    // a workspace that stays usable, and `aria-modal` is deliberately omitted —
    // trapping Tab there would tell assistive technology one thing while doing
    // the opposite, and leave keyboard-only users unable to reach the pipeline
    // the layout is inviting them to keep using.
    if (compact) document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      launcher?.focus();
    };
  }, [open, compact]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, run.answer, run.tools.length]);

  // A settled run may have changed what the conversation is scoped to.
  useEffect(() => {
    if (!open || !activeThreadId) return;
    if (!["completed", "failed", "cancelled"].includes(run.phase)) return;
    void refreshThreadScope(activeThreadId);
  }, [open, activeThreadId, run.phase, refreshThreadScope]);

  // A run awaiting a human decision is still in flight. Leaving the composer
  // and thread controls live would let a new run abort the pending one's stream
  // while the first privileged action is still undecided, or discard the only
  // visible approval prompt. Only the approval controls stay operable.
  /** A run is actually in flight — what the spinner and Stop control describe. */
  const running =
    run.phase === "starting" ||
    run.phase === "streaming" ||
    run.phase === "reconnecting" ||
    run.phase === "waiting_approval";

  /**
   * When the drawer must refuse input, which is wider than `running`.
   *
   * A selection commits the active thread id before its transcript arrives, so
   * during the load the composer would be addressing one conversation while
   * another's messages are still on screen — the user reads B and submits to A.
   * Blocking submission until the selected thread's load finishes is what makes
   * the two agree. The label stays "send" though: nothing is being sent, and
   * saying otherwise would describe a run that does not exist.
   */
  const busy = running || loading || runStateUnknown || transcriptFailed;

  async function selectThread(threadId: string) {
    // `running`, not `busy`: switching away from a conversation whose transcript
    // is still loading is fine — the generation guard discards its result — and
    // blocking it would strand the user behind a slow load. What must not be
    // interrupted is a live run, above all one waiting on a decision.
    if (running) return;
    // Claim a generation up front: any load still in flight for the previously
    // selected thread becomes stale here and will discard its own result.
    const generation = ++selectionRef.current;
    selectActiveThread(threadId);
    setHistoryOpen(false);
    setThreadApplication(null);
    setTranscriptFailed(false);
    // The lock describes the conversation being left, not this one. `loading`
    // covers the gap until the new conversation has been inspected, and the
    // rejoin below sets it again if that inspection fails.
    setRunStateUnknown(false);
    pendingRequestRef.current = null;
    // Drop the previous conversation's transcript before its successor loads.
    // Keeping it on a failed load would show one conversation's history under
    // another's identity, while submissions went to the new one.
    setMessages([]);
    reset();
    // Hold `loading` across the whole selection. Without it `busy` is false the
    // instant the id changes, so the composer accepts a submission against a
    // conversation whose messages are still blank — the user has had no chance
    // to see what they are replying to.
    setLoading(true);
    try {
      const readAt = await loadMessages(threadId, generation);
      await rejoinActiveRun(threadId, generation, readAt);
    } finally {
      if (selectionRef.current === generation) setLoading(false);
    }
  }

  async function removeThread(threadId: string) {
    if (running) return;
    try {
      await careerOpsJson(`/api/career-ops/threads/${threadId}`, { method: "DELETE" });
    } catch (reason) {
      // Deletion legitimately fails while a run is still in flight. Removing
      // the row anyway would claim it worked and hide the conversation.
      setErrorCode(reason instanceof CareerOpsRequestError ? reason.code : "error_generic");
      return;
    }
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    // The selection as it stands now, not as it stood when the request began.
    if (activeThreadIdRef.current === threadId) {
      // Invalidate first. The delete control stays live while a transcript
      // loads, so without this a late `loadMessages` still sees its generation
      // as current and restores the deleted conversation's messages — or its
      // failure state — over the cleared drawer.
      selectionRef.current += 1;
      setLoading(false);
      selectActiveThread(null);
      setMessages([]);
      setThreadApplication(null);
      setTranscriptFailed(false);
      pendingRequestRef.current = null;
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
    // Keep the request id with the unsent draft. If the response was lost, the
    // run may exist upstream, and only the same id can resolve to it — a fresh
    // one would be refused as a second concurrent run. Reuse it only for the
    // identical message, so an edited draft starts a genuinely new run.
    const carried = pendingRequestRef.current;
    const requestId = carried && carried.message === message ? carried.id : newClientRequestId();
    pendingRequestRef.current = { id: requestId, message };
    const optimisticId = `local-${Date.now()}`;
    setMessages((current) => [
      ...current,
      ...(previousAnswer
        ? [{ id: `answer-${current.length}`, role: "assistant" as const, content: previousAnswer }]
        : []),
      { id: optimisticId, role: "user" as const, content: message },
    ]);

    const outcome = await start(activeThreadId, message, requestId);
    if (outcome === "accepted") pendingRequestRef.current = null;
    if (outcome === "rejected") {
      // Nothing was sent. Drop only the unsent message: `start` has already
      // reset the live run, so the previous turn's answer now exists only in
      // the copy just made — restoring a pre-submit snapshot would erase it.
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setDraft((current) => (current === "" ? message : current));
    }
    if (outcome === "unknown") {
      // The server kept this conversation's reservation because the agent may
      // be executing. Withdrawing the message and handing the draft back would
      // say the opposite. Leave the message where it is, keep the request id so
      // a retry can resolve to the same run rather than being refused as a
      // second one, and lock the conversation until it can be inspected —
      // reopening it re-reads the run state and rejoins whatever is there.
      setRunStateUnknown(true);
      setErrorCode("error_run_state_unknown");
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
                    disabled={running}
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
                  disabled={running}
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
                          // Say it, do not just ignore the click. The handler
                          // returns silently during a run, which leaves keyboard
                          // and assistive-technology users pressing a control
                          // that looks live and does nothing — and a run waiting
                          // on a decision would lose its only prompt.
                          disabled={running}
                          className={`nexus-focus-ring min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-xs disabled:opacity-40 ${
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
                          disabled={running}
                          className="nexus-focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/10"
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
                    void loadStatus();
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

                  {!loading && transcriptFailed && (
                    // Submission stays blocked while this is on screen: replying
                    // to a conversation whose history could not be shown means
                    // answering something the user cannot see, and the agent
                    // receives the turns Hermes has rather than the ones they
                    // think they are continuing. Blocking without a way out
                    // would strand them, so the retry is part of the state.
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t("transcript_unavailable")}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeThreadId) void selectThread(activeThreadId);
                        }}
                        className="nexus-button-ghost nexus-target nexus-focus-ring"
                      >
                        {t("retry")}
                      </button>
                    </div>
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
                          : run.approval.undisclosed
                            ? t("approval_undisclosed")
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
                        if (code === "error_stop_failed") return t("error_stop_failed");
                        if (code === "error_status_unknown") return t("error_status_unknown");
                        if (code === "error_approval_unavailable") {
                          return t("error_approval_unavailable");
                        }
                        if (code === "error_run_state_unknown") {
                          return t("error_run_state_unknown");
                        }
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
                    {running && (
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
                    {/* Only once a run id exists. During `starting` the run has
                        no id yet, so Stop would render enabled and do nothing —
                        the user would believe they had stopped an agent that
                        went on to run. */}
                    {running && status.capabilities.stop && run.runId ? (
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
                        {running ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {running ? t("sending") : t("send")}
                      </button>
                    )}
                  </form>
                  {running && !status.capabilities.stop && (
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
