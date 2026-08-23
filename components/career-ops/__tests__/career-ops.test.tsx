/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "@/messages/en.json";
import { CareerOps } from "../career-ops";

const { routerRefresh } = vi.hoisted(() => ({ routerRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const invalidated: unknown[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sse(chunks: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * A stream that emits and then stays open, the way Hermes keeps a run's event
 * stream open while it waits for a human decision.
 */
function openSse(chunks: string[]) {
  let close: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      // Tolerant: the client legitimately cancels a stream it has left, which
      // closes the controller — a test tearing one down must not then throw.
      close = () => {
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      };
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
  return { response, close: () => close() };
}

const AVAILABLE = {
  enabled: true,
  available: true,
  reason: null,
  capabilities: { stop: true, approvals: true, streaming: true },
  runTimeoutMs: 20_000,
};

const THREAD = {
  id: "thread-1",
  title: "Career Ops",
  applicationId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let routes: Array<[RegExp, string, Handler]> = [];
const calls: Array<{ url: string; method: string; body: string | null }> = [];

function route(method: string, pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, method, handler]);
}

/**
 * Threads the fake has served from the list endpoint. The single-thread
 * endpoint echoes from here so a test's own thread (with its application link)
 * survives the drawer re-reading it — the real API returns the same record.
 */
let servedThreads: CareerOpsThread[] = [];

function installFetch() {
  servedThreads = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: (init?.body as string) ?? null });
    // Honour the abort signal the way the real fetch does. Without this the
    // hook's cancellation paths — aborting a stream when a new run starts, and
    // the unmount cleanup — are untestable: the fake would keep resolving after
    // an abort and every such test would pass against broken code.
    if (init?.signal?.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    for (const [pattern, routeMethod, handler] of routes) {
      if (routeMethod === method && pattern.test(url)) {
        const response = await handler(url, init);
        if (init?.signal && response.body) {
          // Tie the body to the signal, as the platform does.
          const source = response.body;
          const tied = new ReadableStream<Uint8Array>({
            async start(controller) {
              const reader = source.getReader();
              const onAbort = () => {
                reader.cancel().catch(() => undefined);
                try {
                  controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
                } catch {
                  // already settled
                }
              };
              init.signal!.addEventListener("abort", onAbort, { once: true });
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
                }
                controller.close();
              } catch {
                // aborted or upstream error; already surfaced above
              } finally {
                init.signal!.removeEventListener("abort", onAbort);
              }
            },
          });
          const mirrored = new Response(tied, {
            status: response.status,
            headers: response.headers,
          });
          if (method === "GET" && /\/api\/career-ops\/threads$/.test(url)) {
            const clone = mirrored.clone();
            const body = await clone.json().catch(() => null);
            if (body?.threads) servedThreads = body.threads;
          }
          return mirrored;
        }
        if (method === "GET" && /\/api\/career-ops\/threads$/.test(url)) {
          const clone = response.clone();
          const body = await clone.json().catch(() => null);
          if (body?.threads) servedThreads = body.threads;
        }
        return response;
      }
    }
    return json({ error: "not_found" }, 404);
  }) as unknown as typeof fetch;
}

function renderCareerOps(props: Parameters<typeof CareerOps>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.invalidateQueries = ((args: unknown) => {
    invalidated.push(args);
    return Promise.resolve();
  }) as typeof client.invalidateQueries;
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <CareerOps {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Desktop by default; the mobile test opts in and must not leak that choice. */
function setViewport(compact: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: compact && query.includes("max-width"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  routes = [];
  calls.length = 0;
  invalidated.length = 0;
  vi.clearAllMocks();
  // Without this reset the narrow-viewport test's override persisted, and every
  // test after it silently ran as mobile — including ones asserting desktop
  // behaviour.
  setViewport(false);
  installFetch();
  route("GET", /\/api\/career-ops\/status$/, () => json(AVAILABLE));
  route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [THREAD] }));
  route("POST", /\/api\/career-ops\/threads$/, () => json({ thread: THREAD }, 201));
  route("GET", /\/threads\/[^/]+\/messages$/, () => json({ messages: [] }));
  route("GET", /\/api\/career-ops\/threads\/[^/]+$/, (url) => {
    const id = url.split("/").pop() ?? THREAD.id;
    const thread = servedThreads.find((item) => item.id === id) ?? { ...THREAD, id };
    return json({ thread, application: null, activeRun: null });
  });
  route("DELETE", /\/api\/career-ops\/threads\/[^/]+$/, () => json({ deleted: true }));
  route("POST", /\/threads\/[^/]+\/runs$/, () => json({ run: { id: "run-1" } }, 202));
  route("POST", /\/runs\/[^/]+\/stop$/, () => json({ stopping: true }));
  route("POST", /\/runs\/[^/]+\/approval$/, () => json({ resolved: true }));
  route("GET", /\/runs\/[^/]+$/, () => json({ status: "completed", output: "done", error: null }));
  route("GET", /\/runs\/[^/]+\/events$/, () => sse(['data: {"type":"completed","output":"ok"}\n\n']));
});

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", { name: /open career ops/i });
  await user.click(trigger);
  return screen.findByRole("dialog", { name: "Career Ops" });
}

describe("availability states", () => {
  it("renders nothing when the integration is disabled", async () => {
    route("GET", /\/api\/career-ops\/status$/, () =>
      json({
        enabled: false,
        available: false,
        reason: "not_configured",
        capabilities: { stop: false, approvals: false, streaming: false },
      }),
    );
    renderCareerOps();
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/status"))).toBe(true));
    expect(screen.queryByRole("button", { name: /open career ops/i })).toBeNull();
  });

  it("shows an honest unavailable state with a retry action", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/status$/, () =>
      json({
        enabled: true,
        available: false,
        reason: "unreachable",
        capabilities: { stop: false, approvals: false, streaming: false },
      }),
    );
    renderCareerOps();
    const dialog = await openDrawer(user);
    expect(within(dialog).getByText(/career ops is unavailable/i)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: /try again/i }));
    await waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith("/status")).length).toBeGreaterThan(1),
    );
  });

  it("reports a degraded upstream distinctly from an unreachable one", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/status$/, () =>
      json({
        enabled: true,
        available: false,
        reason: "degraded",
        capabilities: { stop: false, approvals: false, streaming: false },
      }),
    );
    renderCareerOps();
    const dialog = await openDrawer(user);
    expect(within(dialog).getByText(/reports a degraded state/i)).toBeTruthy();
  });
});

describe("drawer behavior", () => {
  it("opens, closes and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const trigger = await screen.findByRole("button", { name: /open career ops/i });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Career Ops" });
    await user.click(within(dialog).getByRole("button", { name: /^close career ops$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    await openDrawer(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("moves focus into the drawer when it opens", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("marks the panel as modal on narrow viewports", async () => {
    const user = userEvent.setup();
    setViewport(true);
    renderCareerOps();
    const dialog = await openDrawer(user);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("does not mark the panel as modal at desktop widths", async () => {
    // The other half of the pair. It went unasserted for the whole PR, and the
    // matchMedia leak meant a test written for it would have run as mobile
    // anyway — which is how the focus trap came to contradict this semantics
    // without anything failing.
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    expect(dialog.getAttribute("aria-modal")).toBeNull();
  });
});

describe("threads", () => {
  it("lists conversations and switches between them", async () => {
    const user = userEvent.setup();
    const second = { ...THREAD, id: "thread-2", title: "Second" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [THREAD, second] }));
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Second" }));
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/threads/thread-2/messages"))).toBe(true),
    );
  });

  it("creates a new conversation", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    calls.length = 0;
    await user.click(within(dialog).getByRole("button", { name: /new conversation/i }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === "POST" && call.url.endsWith("/api/career-ops/threads")),
      ).toBe(true),
    );
  });

  it("deletes a conversation", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(within(dialog).getByRole("button", { name: /delete conversation/i }));
    await waitFor(() =>
      expect(calls.some((call) => call.method === "DELETE")).toBe(true),
    );
  });
});

describe("application context", () => {
  const application = { id: "42", company: "Acme", role: "Engineer" };

  it("shows the linked company and role and offers a way back to global context", async () => {
    const user = userEvent.setup();
    const scoped = { ...THREAD, id: "thread-app", applicationId: "42", title: "Acme — Engineer" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [scoped] }));
    renderCareerOps({ application });

    const dialog = await openDrawer(user);
    expect(within(dialog).getAllByText(/Acme — Engineer/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/application context/i)).toBeTruthy();

    route("POST", /\/api\/career-ops\/threads$/, () => json({ thread: THREAD }, 201));
    await user.click(within(dialog).getByRole("button", { name: /switch to global context/i }));
    await waitFor(() => expect(within(dialog).getByText(/global context/i)).toBeTruthy());
  });

  it("never labels a differently-scoped thread with the displayed opportunity", async () => {
    const user = userEvent.setup();
    const mine = { ...THREAD, id: "thread-mine", applicationId: "42", title: "Acme — Engineer" };
    const other = { ...THREAD, id: "thread-other", applicationId: "99", title: "Other opportunity" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [mine, other] }));
    renderCareerOps({ application });

    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Other opportunity" }));

    // The service sends thread-other's own application id upstream, so the
    // badge must not claim this conversation is about Acme.
    await waitFor(() =>
      expect(within(dialog).getByText(/another opportunity/i)).toBeTruthy(),
    );
    expect(within(dialog).queryByText(/Acme — Engineer/)).toBeNull();
  });

  it("never shows one conversation while the composer addresses another", async () => {
    // Reopening commits the selected thread id before its transcript arrives.
    // With the previous conversation's messages still rendered and `loading`
    // outside `busy`, the user could read one conversation and submit to the
    // other.
    const user = userEvent.setup();
    const first = { ...THREAD, id: "thread-first", applicationId: null, title: "First" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [first] }));

    let releaseMessages: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    let loads = 0;
    route("GET", /\/threads\/[^/]+\/messages$/, async () => {
      loads += 1;
      // The reopen's transcript load is held open.
      if (loads > 1) await held;
      return json({ messages: [{ id: "m1", role: "assistant", content: "earlier answer" }] });
    });

    renderCareerOps();
    let dialog = await openDrawer(user);
    await waitFor(() => expect(within(dialog).getByText(/earlier answer/)).toBeTruthy());
    await user.type(within(dialog).getByLabelText(/message career ops/i), "next question");

    await user.keyboard("{Escape}");
    dialog = await openDrawer(user);
    await waitFor(() => expect(loads).toBeGreaterThan(1));

    // Mid-load the previous transcript must be gone, and the composer must not
    // accept a submission for a conversation whose messages are not on screen.
    expect(within(dialog).queryByText(/earlier answer/)).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: /^send$/i }).hasAttribute("disabled"),
    ).toBe(true);

    releaseMessages();
    await waitFor(() =>
      expect(within(dialog).getByText(/earlier answer/)).toBeTruthy(),
    );
  });

  it("discards a scope refresh for a conversation that is no longer selected", async () => {
    // A settled run re-reads its own conversation's scope. That read can land
    // after the user has selected a different conversation, and applying it
    // then names one opportunity in the badge while messages and approvals go
    // to another.
    const user = userEvent.setup();
    const mine = { ...THREAD, id: "thread-mine", applicationId: "42", title: "Acme — Engineer" };
    const other = { ...THREAD, id: "thread-other", applicationId: "99", title: "Other opportunity" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [mine, other] }));

    let releaseRefresh: () => void = () => {};
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let mineReads = 0;
    route("GET", /\/threads\/thread-mine$/, async () => {
      mineReads += 1;
      // The initial selection resolves; the post-run refresh is held open.
      if (mineReads > 1) await refreshHeld;
      return json({
        thread: mine,
        application: { id: "42", company: "Acme", role: "Engineer" },
        activeRun: null,
      });
    });
    route("GET", /\/threads\/thread-other$/, () =>
      json({
        thread: other,
        application: { id: "99", company: "Globex", role: "Designer" },
        activeRun: null,
      }),
    );

    renderCareerOps({ application });
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "go");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(mineReads).toBeGreaterThan(1));

    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Other opportunity" }));
    await waitFor(() => expect(within(dialog).getByText(/Globex/)).toBeTruthy());

    releaseRefresh();
    await waitFor(() => expect(within(dialog).getByText(/Globex/)).toBeTruthy());
    expect(within(dialog).queryByText(/Designer/)).toBeTruthy();
    expect(within(dialog).queryByText(/Acme — Engineer/)).toBeNull();
  });

  it("names the opportunity a differently-scoped thread actually acts on", async () => {
    const user = userEvent.setup();
    const mine = { ...THREAD, id: "thread-mine", applicationId: "42", title: "Acme — Engineer" };
    const other = { ...THREAD, id: "thread-other", applicationId: "99", title: "Other opportunity" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [mine, other] }));
    route("GET", /\/threads\/thread-other$/, () =>
      json({
        thread: other,
        application: { id: "99", company: "Globex", role: "Designer" },
        activeRun: null,
      }),
    );
    renderCareerOps({ application });

    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Other opportunity" }));

    // With history closed the badge is the only thing identifying the target,
    // so it must name the opportunity the agent will actually act on.
    await waitFor(() => expect(within(dialog).getByText(/Globex — Designer/)).toBeTruthy());
    expect(within(dialog).queryByText(/Acme — Engineer/)).toBeNull();
  });

  it("surfaces a failure to start a new conversation instead of doing nothing", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));

    route("POST", /\/api\/career-ops\/threads$/, () => json({ error: "unavailable" }, 503));
    await user.click(within(dialog).getByRole("button", { name: /new conversation/i }));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toMatch(/something went wrong/i),
    );
  });

  it("does not present a failed transcript load as an empty conversation", async () => {
    const user = userEvent.setup();
    route("GET", /\/threads\/[^/]+\/messages$/, () => json({ error: "upstream_error" }, 503));
    renderCareerOps();

    const dialog = await openDrawer(user);
    // The onboarding empty state would tell the user this conversation has no
    // history, which is a different claim from "the history did not load".
    await waitFor(() =>
      expect(within(dialog).getByText(/history could not be loaded/i)).toBeTruthy(),
    );
    expect(within(dialog).queryByText(/start by asking/i)).toBeNull();
  });

  it("ignores a stale thread load that lands after a newer selection", async () => {
    const user = userEvent.setup();
    const slow = { ...THREAD, id: "thread-slow", title: "Slow thread" };
    const quick = { ...THREAD, id: "thread-quick", title: "Quick thread" };
    // `quick` first so the drawer's initial load does not block on the slow one.
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [quick, slow] }));
    route("GET", /\/threads\/thread-slow\/messages$/, async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return json({ messages: [{ id: "m-slow", role: "assistant", content: "STALE ANSWER" }] });
    });
    route("GET", /\/threads\/thread-quick\/messages$/, () =>
      json({ messages: [{ id: "m-quick", role: "assistant", content: "CURRENT ANSWER" }] }),
    );
    renderCareerOps();

    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Slow thread" }));

    // Switch again before the first load resolves.
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Quick thread" }));
    await waitFor(() => expect(within(dialog).getByText("CURRENT ANSWER")).toBeTruthy());

    // The earlier request now completes. Letting it through would swap the
    // visible transcript for another conversation's.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(within(dialog).queryByText("STALE ANSWER")).toBeNull();
    expect(within(dialog).getByText("CURRENT ANSWER")).toBeTruthy();
  });

  it("keeps a live run's stream when the drawer is reopened onto it", async () => {
    // The hook stays mounted while the drawer is closed and holds the only
    // subscription to Hermes's single-consumer event stream. Resetting on
    // reopen aborts it for good: rejoin can then only poll status, so deltas
    // and tool progress are lost and an approval prompt degrades to the
    // denial-only recovered form.
    const user = userEvent.setup();
    const stream = openSse([]);
    let streamOpens = 0;
    route("GET", /\/runs\/[^/]+\/events$/, () => {
      streamOpens += 1;
      return stream.response;
    });
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      json({ thread: THREAD, application: null, activeRun: { id: "run-1" } }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "long task");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(streamOpens).toBe(1));

    // Close and reopen onto the same conversation.
    await user.keyboard("{Escape}");
    await openDrawer(user);
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/api/career-ops/threads?"))).toBe(false),
    );

    // The original subscription is still the one in use: no second open, and
    // Stop is still offered because the run is still being tracked.
    expect(streamOpens).toBe(1);
    expect(
      await within(await openDrawer(user)).findByRole("button", { name: /^stop$/i }),
    ).toBeTruthy();
    stream.close();
  });

  it("discards a pending load for a conversation that was deleted", async () => {
    // The delete control stays live while a transcript loads, so a late
    // response could restore the deleted conversation's messages over the
    // cleared drawer.
    const user = userEvent.setup();
    const doomed = { ...THREAD, id: "thread-doomed", title: "Doomed" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [THREAD, doomed] }));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    route("GET", /\/threads\/thread-doomed\/messages$/, async () => {
      await held;
      return json({ messages: [{ id: "d1", role: "assistant", content: "DOOMED ANSWER" }] });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Doomed" }));

    // Delete it while its transcript is still in flight.
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: /delete conversation: Doomed/i }));

    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(dialog).queryByText("DOOMED ANSWER")).toBeNull();
  });

  it("blocks submission while a selected conversation is still loading", async () => {
    // Selecting a history entry commits the id immediately. Without holding the
    // loading state across the whole selection, the composer accepts a message
    // for a conversation whose transcript is still blank — the user has had no
    // chance to see what they are replying to.
    const user = userEvent.setup();
    const second = { ...THREAD, id: "thread-2", title: "Second" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [THREAD, second] }));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    route("GET", /\/threads\/thread-2\/messages$/, async () => {
      await held;
      return json({ messages: [] });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "hello");
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Second" }));

    const send = within(dialog).getByRole("button", { name: /^send$/i });
    await waitFor(() => expect(send.hasAttribute("disabled")).toBe(true));

    release();
    await waitFor(() => expect(send.hasAttribute("disabled")).toBe(false));
  });

  it("re-reads a transcript the reply landed in after it was taken", async () => {
    // The transcript and the run state are two requests, and no ordering of two
    // reads makes them one snapshot. A run that finishes between them is
    // invisible to both: the transcript predates the reply, and the run state
    // reports nothing in flight. The conversation then showed the question with
    // no answer, and no live run to produce one, until something else reloaded
    // it. The settle time the detail response carries is what makes that
    // detectable.
    const user = userEvent.setup();
    const question = { id: "m1", role: "user", content: "what next?" };
    const reply = { id: "m2", role: "assistant", content: "the late reply" };
    let reads = 0;
    route("GET", /\/threads\/[^/]+\/messages$/, () => {
      reads += 1;
      // The snapshot instant comes from the server, so the comparison never
      // depends on this browser's clock.
      return json({
        messages: reads === 1 ? [question] : [question, reply],
        readAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      });
    });
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      // Served after the transcript request, so this settle time is genuinely
      // later than the snapshot the drawer is holding.
      json({
        thread: THREAD,
        application: null,
        activeRun: null,
        // Later than the transcript snapshot above, on the same clock.
        settledAt: new Date("2026-01-01T00:00:01.000Z").toISOString(),
      }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);

    await waitFor(() => expect(within(dialog).getByText("the late reply")).toBeTruthy());
  });

  it("does not let a skewed browser clock skip the re-read", async () => {
    // The comparison must be between two instants from the Nexus server clock.
    // Taking the transcript instant here instead made it depend on how far this
    // browser's clock had drifted: a clock a second fast made every settle look
    // older than the snapshot, and the corrective reload never ran.
    const user = userEvent.setup();
    const question = { id: "m1", role: "user", content: "what next?" };
    const reply = { id: "m2", role: "assistant", content: "the late reply" };
    // Well ahead of the server instants below, which is exactly the case that
    // used to break.
    const skewed = Date.parse("2026-06-01T00:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(skewed);

    let reads = 0;
    route("GET", /\/threads\/[^/]+\/messages$/, () => {
      reads += 1;
      return json({
        messages: reads === 1 ? [question] : [question, reply],
        readAt: "2026-01-01T00:00:00.000Z",
      });
    });
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      json({
        thread: THREAD,
        application: null,
        activeRun: null,
        settledAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);

    await waitFor(() => expect(within(dialog).getByText("the late reply")).toBeTruthy());
    vi.mocked(Date.now).mockRestore();
  });

  it("leaves a transcript alone when its conversation settled long before", async () => {
    // The re-read is for a reply that landed inside the window between the two
    // requests. A conversation that finished earlier is already fully in the
    // transcript, and reading it again would double every drawer open.
    const user = userEvent.setup();
    let reads = 0;
    route("GET", /\/threads\/[^/]+\/messages$/, () => {
      reads += 1;
      return json({
        messages: [{ id: "m1", role: "assistant", content: "settled answer" }],
        readAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      });
    });
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      json({
        thread: THREAD,
        application: null,
        activeRun: null,
        settledAt: new Date("2025-12-31T23:59:00.000Z").toISOString(),
      }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);

    await waitFor(() => expect(within(dialog).getByText("settled answer")).toBeTruthy());
    expect(reads).toBe(1);
  });

  it("keeps the retry reachable when the status request fails", async () => {
    // `enabled: false` means the deployment has not configured Career Ops, and
    // it removes the launcher entirely. Answering a transient network failure
    // with it hid the very drawer whose retry action is the way back, so the
    // only recovery was a full page reload.
    const user = userEvent.setup();
    let failing = true;
    route("GET", /\/api\/career-ops\/status$/, () => {
      if (failing) throw new Error("network down");
      return json(AVAILABLE);
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    const retry = await within(dialog).findByRole("button", { name: /try again/i });

    failing = false;
    await user.click(retry);

    // Recovered in place: the composer is back without reloading the page.
    // Re-queried because the drawer re-renders from scratch while the retry is
    // in flight, so the handle above points at a detached node.
    await waitFor(() => expect(screen.getByLabelText(/message career ops/i)).toBeTruthy());
  });

  it("survives a status response that omits its capabilities", async () => {
    // The response is JSON, not a `CareerOpsStatus`; the cast is a claim, not a
    // check. A body without `capabilities` — an older build, a proxy error page
    // served as JSON — reached `status.capabilities.streaming` and threw inside
    // render, taking the page down. Both the initial read and the retry have to
    // normalize it; only the initial one did.
    const user = userEvent.setup();
    let reads = 0;
    route("GET", /\/api\/career-ops\/status$/, () => {
      reads += 1;
      // First read fails, so the drawer offers its retry. The retry then gets a
      // body with no `capabilities` at all — the shape only the initial read
      // was normalizing.
      if (reads === 1) throw new Error("network down");
      return json({ enabled: true, available: true, reason: null, runTimeoutMs: 20_000 });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(await within(dialog).findByRole("button", { name: /try again/i }));

    // Still rendering rather than throwing inside render: every capability
    // defaults to unsupported, so the drawer degrades instead of crashing.
    await waitFor(() => expect(screen.getByLabelText(/message career ops/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull();
  });

  it("creates one conversation when a click races the first-open creation", async () => {
    // The drawer creates a conversation for a first-time user, and the history
    // panel's New-conversation control is live while that POST is in flight.
    // Serializing only the direct clicks left the automatic creation outside
    // the lock, so one click produced two Hermes sessions and two Nexus
    // conversations.
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [] }));
    let creations = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    route("POST", /\/api\/career-ops\/threads$/, async () => {
      creations += 1;
      await held;
      return json({ thread: { ...THREAD, id: `thread-${creations}` } }, 201);
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await waitFor(() => expect(creations).toBe(1));

    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(within(dialog).getByRole("button", { name: /new conversation/i }));

    release();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(creations).toBe(1);
  });

  it("does not accept a reply to a conversation whose history failed to load", async () => {
    // Replying to a transcript that could not be shown means answering
    // something the user cannot see: the agent receives the turns Hermes holds,
    // not the ones they believe they are continuing. Blocking without a way out
    // would strand them, so the retry is part of the state.
    const user = userEvent.setup();
    let failing = true;
    route("GET", /\/threads\/[^/]+\/messages$/, () => {
      if (failing) return json({ error: "upstream_error" }, 503);
      return json({
        messages: [{ id: "m1", role: "assistant", content: "recovered history" }],
        readAt: "2026-01-01T00:00:00.000Z",
      });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);

    const retry = await within(dialog).findByRole("button", { name: /try again/i });
    await user.type(within(dialog).getByLabelText(/message career ops/i), "reply anyway");
    expect(
      within(dialog).getByRole("button", { name: /^send$/i }).hasAttribute("disabled"),
    ).toBe(true);

    failing = false;
    await user.click(retry);

    await waitFor(() => expect(screen.getByText("recovered history")).toBeTruthy());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^send$/i }).hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("does not reinstate an approval the user has already answered", async () => {
    // Recovery polling and a decision overlap. A poll in flight when the user
    // rejects comes back saying `waiting_for_approval` — true when it was
    // taken, stale by the time it lands — and reinstated the prompt the
    // decision had just cleared. A successful decision writes no further
    // state, and later snapshots did not clear approvals, so the drawer stayed
    // locked on a Reject button that could only conflict.
    const user = userEvent.setup();
    let polls = 0;
    let releaseStalePoll: () => void = () => {};
    // The second poll is held open across the decision, so its answer is true
    // when taken and stale when it lands — the exact overlap that reinstated
    // the prompt. Without holding it the two never race and the test cannot
    // tell the fix from its absence.
    const stalePoll = new Promise<void>((resolve) => {
      releaseStalePoll = resolve;
    });
    route("GET", /\/runs\/[^/]+\/events$/, () => json({ error: "no stream" }, 404));
    route("GET", /\/runs\/[^/]+$/, async () => {
      polls += 1;
      if (polls === 2) {
        await stalePoll;
        return json({ status: "waiting_for_approval", output: "", error: null });
      }
      // Before the decision the run is waiting; afterwards Hermes has resumed.
      const status = polls === 1 ? "waiting_for_approval" : "running";
      return json({ status, output: "", error: null });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "do the thing");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    const reject = await within(dialog).findByRole("button", { name: /reject/i });
    // Let the second poll start before answering.
    await waitFor(() => expect(polls).toBeGreaterThanOrEqual(2), { timeout: 5_000 });
    await user.click(reject);
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/approval"))).toBe(true),
    );

    // Only now does the pre-decision snapshot land.
    releaseStalePoll();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(within(dialog).queryByRole("button", { name: /reject/i })).toBeNull();
  }, 20_000);

  it("does not clear a conversation selected while a deletion was in flight", async () => {
    // Deletion stays live while the user can still switch conversations, and
    // the clean-up compared the id captured when the request began. Deleting
    // the active conversation and selecting another before the response landed
    // wiped the one just loaded — transcript, scope and all.
    const user = userEvent.setup();
    const second = { ...THREAD, id: "thread-2", title: "Second" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [THREAD, second] }));
    route("GET", /\/threads\/thread-2\/messages$/, () =>
      json({
        messages: [{ id: "m9", role: "assistant", content: "second conversation" }],
        readAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    let releaseDelete: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    route("DELETE", /\/api\/career-ops\/threads\/[^/]+$/, async () => {
      await held;
      return json({ deleted: true });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));

    // Delete the active conversation, then switch before the response lands.
    void user.click(within(dialog).getAllByRole("button", { name: /delete/i })[0]);
    await user.click(await within(dialog).findByRole("button", { name: "Second" }));
    await waitFor(() =>
      expect(within(dialog).getByText("second conversation")).toBeTruthy(),
    );

    releaseDelete();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The conversation the user chose is still the one on screen.
    expect(within(dialog).getByText("second conversation")).toBeTruthy();
  });

  it("does not claim nothing was sent when the run may have started", async () => {
    // A submission that timed out after the agent accepted it keeps the
    // conversation's reservation, precisely because the run may be executing.
    // Reporting it as a plain failure withdrew the message, handed the draft
    // back and unlocked the conversation while a privileged run might have been
    // changing CRM data.
    const user = userEvent.setup();
    route("POST", /\/threads\/[^/]+\/runs$/, () =>
      json({ error: "upstream_error", runMayHaveStarted: true }, 502),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "do the thing");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/could not check whether/i)).toBeTruthy(),
    );
    // The message stays in the transcript: it may well have reached the agent.
    // (The composer is excluded — a textarea's value is its text content too.)
    expect(
      within(dialog)
        .queryAllByText("do the thing")
        .filter((element) => element.tagName !== "TEXTAREA"),
    ).toHaveLength(1);
    // And the conversation stays locked rather than inviting a second run.
    expect(
      within(dialog).getByRole("button", { name: /^send$/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("withdraws a submission the server refused outright", async () => {
    // The counterpart: a stated refusal releases the reservation, so nothing is
    // executing and the user should get their draft back rather than being
    // locked out of a conversation that is idle.
    const user = userEvent.setup();
    route("POST", /\/threads\/[^/]+\/runs$/, () => json({ error: "rate_limited" }, 429));

    renderCareerOps();
    const dialog = await openDrawer(user);
    const composer = within(dialog).getByLabelText(/message career ops/i);
    await user.type(composer, "do the thing");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    expect(
      within(dialog)
        .queryAllByText("do the thing")
        .filter((element) => element.tagName !== "TEXTAREA"),
    ).toHaveLength(0);
    await waitFor(() =>
      expect((composer as HTMLTextAreaElement).value).toBe("do the thing"),
    );
  });

  it("does not claim nothing was sent when the browser got no answer at all", async () => {
    // A dropped connection is not a refusal. The server may have started and
    // bound the run before the response was lost, so "no authoritative answer"
    // has to mean unknown — reading it as refused withdrew the message and
    // unlocked the conversation on the evidence that proves least.
    const user = userEvent.setup();
    route("POST", /\/threads\/[^/]+\/runs$/, () => {
      throw new Error("network down");
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "do the thing");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/could not check whether/i)).toBeTruthy(),
    );
    expect(
      within(dialog)
        .queryAllByText("do the thing")
        .filter((element) => element.tagName !== "TEXTAREA"),
    ).toHaveLength(1);
  });

  it("settles from status when a decision gets no answer at all", async () => {
    // The request may never have reached Nexus, leaving Hermes paused at a gate
    // that is still open — or it may have landed. Neither the cleared prompt
    // nor a restored one is honest, and the stream that would have said so can
    // sit on keepalives until it times out. The status endpoint decides.
    const user = userEvent.setup();
    const stream = openSse([
      'data: {"type":"approval_required","operation":"shell:rm","summary":"Delete a temporary folder","details":"rm -rf /tmp/x","choices":["once","deny"]}\n\n',
    ]);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    route("POST", /\/runs\/[^/]+\/approval$/, () => {
      throw new Error("network down");
    });
    route("GET", /\/runs\/[^/]+$/, () =>
      json({ status: "waiting_for_approval", output: "", error: null }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await within(dialog).findByText(/needs your approval/i);

    await user.click(within(dialog).getByRole("button", { name: /approve once/i }));

    // Recovery finds the gate still open and surfaces it — denial only, because
    // the operation details cannot be re-disclosed.
    await waitFor(() =>
      expect(within(dialog).getByText(/details could not be recovered/i)).toBeTruthy(),
    );
    expect(within(dialog).getByRole("button", { name: /reject/i })).toBeTruthy();
    stream.close();
  }, 20_000);

  it("keeps the launcher when the status body is unrecognizable", async () => {
    // `enabled` missing reads as "not configured", which removes the launcher
    // outright — so a partial body made the feature disappear along with the
    // retry that would have recovered it.
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/status$/, () => json({}));

    renderCareerOps();
    const dialog = await openDrawer(user);
    expect(await within(dialog).findByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("does not carry an unknown-run lock onto a new conversation", async () => {
    // The lock says "this conversation may hold a run I could not see". A
    // conversation created a moment ago cannot, so carrying the flag across
    // left the composer disabled on a conversation whose state is not in doubt,
    // with no run to wait for and no way out but a reload.
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () => json({ error: "upstream" }, 503));

    renderCareerOps();
    const dialog = await openDrawer(user);
    await waitFor(() =>
      expect(within(dialog).getByText(/could not check whether/i)).toBeTruthy(),
    );
    expect(
      within(dialog).getByRole("button", { name: /^send$/i }).hasAttribute("disabled"),
    ).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(within(dialog).getByRole("button", { name: /new conversation/i }));

    await user.type(within(dialog).getByLabelText(/message career ops/i), "fresh start");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: /^send$/i }).hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("does not present an uninspected conversation as idle", async () => {
    // A failed run lookup is not "no run". Leaving the composer enabled with no
    // Stop invites a submission whose only feedback is the server's conflict,
    // for a conversation that may well have a run in flight.
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      json({ error: "upstream_error" }, 503),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);

    await waitFor(() =>
      expect(within(dialog).getByText(/could not check whether/i)).toBeTruthy(),
    );
    await user.type(within(dialog).getByLabelText(/message career ops/i), "hello");
    expect(
      within(dialog).getByRole("button", { name: /^send$/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("surfaces an approval that could not be shown instead of streaming forever", async () => {
    // Hermes pauses on an unanswered approval. When the gate could not be
    // opened the route says so, and dropping that event left the drawer
    // streaming indefinitely with no prompt and no way out.
    const user = userEvent.setup();
    const stream = openSse(['data: {"type":"error","message":"approval_unavailable"}\n\n']);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    route("GET", /\/runs\/[^/]+$/, () => json({ status: "running", output: "", error: null }));

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "do the thing");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/could not be shown/i)).toBeTruthy(),
    );
    stream.close();
  });

  it("recovers a way out of an approval that could not be shown", async () => {
    // Saying the prompt is missing is not enough on its own. Hermes stays
    // blocked until somebody answers, and this stream will never carry the
    // answer -- it is the stream that failed to present it. Reading on just
    // waits for the idle timeout. The reader has to stop and settle from the
    // status endpoint, which is where the denial-only prompt that unblocks
    // Hermes comes from. The stream below deliberately stays open, so nothing
    // but leaving it deliberately can reach that prompt.
    const user = userEvent.setup();
    const stream = openSse(['data: {"type":"error","message":"approval_unavailable"}\n\n']);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    route("GET", /\/runs\/[^/]+$/, () =>
      json({ status: "waiting_for_approval", output: "", error: null }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "do the thing");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/details could not be recovered/i)).toBeTruthy(),
    );
    // Denial only: nothing was disclosed, so nothing may be granted.
    expect(within(dialog).getByRole("button", { name: /reject/i })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /approve/i })).toBeNull();
    stream.close();
  });

  it("polls a Hermes build that does not serve the event stream", async () => {
    // `run_events_sse` is optional -- availability requires run submission,
    // sessions and run status, because status alone is enough to observe a run.
    // The capability was surfaced to the browser and then never consulted, so
    // the drawer opened a stream every such build was certain to refuse. Skip
    // it and go straight to the recovery path that would have handled it.
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/status$/, () =>
      json({ ...AVAILABLE, capabilities: { stop: true, approvals: true, streaming: false } }),
    );
    route("GET", /\/runs\/[^/]+$/, () =>
      json({ status: "completed", output: "polled answer", error: null }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "no stream here");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(within(dialog).getByText("polled answer")).toBeTruthy());
    expect(calls.some((call) => call.url.includes("/events"))).toBe(false);
  });

  it("does not switch away from a run started while a conversation was being created", async () => {
    // A slow creation returning after the user moved on used to advance the
    // generation, select the new conversation and reset — aborting the
    // single-consumer stream of a run that was still executing.
    const user = userEvent.setup();
    const second = { ...THREAD, id: "thread-2", title: "Second" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [THREAD, second] }));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    route("POST", /\/api\/career-ops\/threads$/, async () => {
      await held;
      return json({ thread: { ...THREAD, id: "thread-created", title: "Created" } }, 201);
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    // Start a creation that will not return yet.
    void user.click(within(dialog).getByRole("button", { name: /new conversation/i }));
    // Meanwhile select an existing conversation.
    await user.click(await within(dialog).findByRole("button", { name: "Second" }));
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/threads/thread-2/messages"))).toBe(true),
    );

    release();
    await new Promise((resolve) => setTimeout(resolve, 60));

    // The late creation must not have taken over the selection: a message sent
    // now must still go to the conversation the user actually chose.
    calls.length = 0;
    await user.type(within(dialog).getByLabelText(/message career ops/i), "for the selected one");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/runs"))).toBe(true));
    const submission = calls.find((call) => call.url.includes("/runs"));
    expect(submission?.url).toContain("/threads/thread-2/runs");
  });

  it("creates one conversation when the control is double-clicked", async () => {
    // Both handlers enter before either request changes any state, and each
    // would create a Hermes session and a Nexus conversation.
    const user = userEvent.setup();
    let created = 0;
    route("POST", /\/api\/career-ops\/threads$/, async () => {
      created += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return json({ thread: { ...THREAD, id: `thread-new-${created}` } }, 201);
    });

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    const newThread = within(dialog).getByRole("button", { name: /new conversation/i });
    await Promise.all([user.click(newThread), user.click(newThread)]);

    await waitFor(() => expect(created).toBeGreaterThan(0));
    expect(created).toBe(1);
  });

  it("does not keep an unsent message in the transcript when the run is refused", async () => {
    const user = userEvent.setup();
    route("POST", /\/threads\/[^/]+\/runs$/, () => json({ error: "conflict" }, 409));
    renderCareerOps();

    const dialog = await openDrawer(user);
    const composer = within(dialog).getByRole("textbox");
    await user.type(composer, "please update my pipeline");
    await user.click(within(dialog).getByRole("button", { name: /send/i }));

    // Nothing was sent, so the text must not be presented as history — and the
    // user must not have to retype it.
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(
      "please update my pipeline",
    ));
    const transcript = within(dialog).queryAllByRole("listitem");
    expect(
      transcript.filter((item) => item.textContent?.includes("please update my pipeline")),
    ).toHaveLength(0);
  });

  it("never shows one conversation's transcript under another's identity", async () => {
    const user = userEvent.setup();
    const first = { ...THREAD, id: "thread-first", title: "First thread" };
    const second = { ...THREAD, id: "thread-second", title: "Second thread" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [first, second] }));
    route("GET", /\/threads\/thread-first\/messages$/, () =>
      json({ messages: [{ id: "m1", role: "assistant", content: "FIRST HISTORY" }] }),
    );
    route("GET", /\/threads\/thread-second\/messages$/, () => json({ error: "upstream" }, 503));
    renderCareerOps();

    const dialog = await openDrawer(user);
    await waitFor(() => expect(within(dialog).getByText("FIRST HISTORY")).toBeTruthy());

    await user.click(within(dialog).getByRole("button", { name: /show conversations/i }));
    await user.click(await within(dialog).findByRole("button", { name: "Second thread" }));

    // The second thread's history failed to load; showing the first thread's
    // messages here would misattribute them while submissions go to the second.
    await waitFor(() =>
      expect(within(dialog).getByText(/history could not be loaded/i)).toBeTruthy(),
    );
    expect(within(dialog).queryByText("FIRST HISTORY")).toBeNull();
  });

  it("stops naming an opportunity the server has detached", async () => {
    const user = userEvent.setup();
    const scoped = { ...THREAD, id: "thread-scoped", applicationId: "42", title: "Acme — Engineer" };
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [scoped] }));
    route("GET", /\/threads\/thread-scoped$/, () =>
      json({
        thread: scoped,
        application: { id: "42", company: "Acme", role: "Engineer" },
        activeRun: null,
      }),
    );
    renderCareerOps({ application });

    const dialog = await openDrawer(user);
    await waitFor(() =>
      expect(within(dialog).getAllByText(/Acme — Engineer/).length).toBeGreaterThan(0),
    );

    // The application is deleted: the server detaches the conversation, and a
    // run would now use global instructions. The badge must follow.
    route("GET", /\/threads\/thread-scoped$/, () =>
      json({ thread: { ...scoped, applicationId: null }, application: null, activeRun: null }),
    );
    route("POST", /\/threads\/[^/]+\/runs$/, () => json({ run: { id: "run-1" } }, 202));

    await user.type(within(dialog).getByRole("textbox"), "carry on");
    await user.click(within(dialog).getByRole("button", { name: /send/i }));

    await waitFor(() => expect(within(dialog).getByText(/global context/i)).toBeTruthy());
  });

  it("reuses the request id when a submission's outcome was never learned", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);

    // The run may exist upstream; only the same id can resolve to it, so a
    // fresh one would be refused as a second concurrent run.
    route("POST", /\/threads\/[^/]+\/runs$/, () => json({ error: "upstream_error" }, 503));
    await user.type(within(dialog).getByRole("textbox"), "try this");
    await user.click(within(dialog).getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "POST" && /runs$/.test(c.url))).toHaveLength(1),
    );
    const first = JSON.parse(calls.find((c) => c.method === "POST" && /runs$/.test(c.url))!.body!);

    route("POST", /\/threads\/[^/]+\/runs$/, () => json({ run: { id: "run-1" } }, 202));
    await user.click(within(dialog).getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "POST" && /runs$/.test(c.url))).toHaveLength(2),
    );
    const second = JSON.parse(
      calls.filter((c) => c.method === "POST" && /runs$/.test(c.url))[1].body!,
    );

    expect(second.clientRequestId).toBe(first.clientRequestId);
  });

  it("stops consuming the run stream when the drawer unmounts", async () => {
    // The Hermes event stream is single-consumer, so a detached hook that keeps
    // reading holds the only subscription: a drawer mounted later could never
    // see that run's approval prompts while the invisible instance consumed
    // them. Verifiable only because the fetch fake honours the abort signal.
    const user = userEvent.setup();
    let streamAborted = false;
    route("GET", /\/runs\/[^/]+\/events$/, (_url, init) => {
      init?.signal?.addEventListener("abort", () => {
        streamAborted = true;
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"type":"delta","text":"working"}\n\n'),
          );
          // stays open, like a run still in flight
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const view = renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByRole("textbox"), "start something");
    await user.click(within(dialog).getByRole("button", { name: /send/i }));
    // The run is in flight once Stop is offered.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /stop/i })).toBeTruthy());

    view.unmount();
    await waitFor(() => expect(streamAborted).toBe(true));
  });

  it("does not reuse the retry id for an edited draft", async () => {
    // The server resolves the id to the run that already exists, so reusing it
    // for different text would show one question while the agent answers
    // another.
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    const composer = within(dialog).getByRole("textbox");

    route("POST", /\/threads\/[^/]+\/runs$/, () => json({ error: "upstream_error" }, 503));
    await user.type(composer, "original question");
    await user.click(within(dialog).getByRole("button", { name: /send/i }));
    const posts = () => calls.filter((c) => c.method === "POST" && /runs$/.test(c.url));
    await waitFor(() => expect(posts()).toHaveLength(1));

    // Edit the restored draft, then retry.
    route("POST", /\/threads\/[^/]+\/runs$/, () => json({ run: { id: "run-1" } }, 202));
    await user.clear(composer);
    await user.type(composer, "different question");
    await user.click(within(dialog).getByRole("button", { name: /send/i }));
    await waitFor(() => expect(posts()).toHaveLength(2));

    const first = JSON.parse(posts()[0].body!);
    const second = JSON.parse(posts()[1].body!);
    expect(second.message).toBe("different question");
    expect(second.clientRequestId).not.toBe(first.clientRequestId);
  });

  it("refreshes workspace data after a failed run, not only a successful one", async () => {
    // A run that failed may already have committed a CRM mutation through MCP,
    // and nothing rolls that back.
    const user = userEvent.setup();
    invalidated.length = 0;
    route("GET", /\/runs\/[^/]+\/events$/, () =>
      sse(['data: {"type":"failed","message":"boom"}\n\n']),
    );
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByRole("textbox"), "do something");
    await user.click(within(dialog).getByRole("button", { name: /send/i }));

    await waitFor(() => expect(invalidated.length).toBeGreaterThan(0));
  });

  it("does not trap Tab in the non-modal desktop panel", async () => {
    // Desktop deliberately omits aria-modal and leaves the workspace usable.
    // Trapping Tab there would tell assistive technology one thing and do the
    // opposite, stranding keyboard-only users inside the drawer.
    const user = userEvent.setup();
    const outside = document.createElement("button");
    outside.textContent = "outside control";
    document.body.appendChild(outside);
    try {
      renderCareerOps();
      const dialog = await openDrawer(user);
      // The same selector the component's trap uses, so "last" here is the
      // element the trap would actually wrap from.
      const selector =
        "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
      const first = controls[0];
      const last = controls[controls.length - 1];
      last.focus();

      // The trap's effect is to wrap from the last control back to the first.
      // Without it focus simply moves on, wherever the document takes it.
      await user.tab();
      expect(document.activeElement).not.toBe(first);
    } finally {
      outside.remove();
    }
  });

  it("creates only one conversation when the drawer is reopened mid-load", async () => {
    // Two loads in flight would each see no conversation and each create one —
    // two Hermes sessions and two Nexus threads for a user who opened a drawer
    // twice.
    const user = userEvent.setup();
    let releaseList: (() => void) | null = null;
    route("GET", /\/api\/career-ops\/threads$/, async () => {
      if (!releaseList) {
        await new Promise<void>((resolve) => {
          releaseList = resolve;
        });
      }
      return json({ threads: [] });
    });
    renderCareerOps();

    const trigger = await screen.findByRole("button", { name: /open career ops/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await user.click(trigger);

    await waitFor(() => expect(releaseList).not.toBeNull());
    releaseList!();

    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/career-ops/threads")).length,
      ).toBeGreaterThan(0),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/career-ops/threads")),
    ).toHaveLength(1);
  });

  it("leaves the loading state after creating a first conversation", async () => {
    // The generation guard treated the load's own createThread as a newer
    // selection, so the finally block skipped clearing `loading` and a
    // first-time drawer sat on the loading state until it was reopened.
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [] }));
    renderCareerOps();

    const dialog = await openDrawer(user);
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url.endsWith("/api/career-ops/threads")),
      ).toBe(true),
    );
    // The composer is only enabled once loading has cleared and a conversation
    // is active, so this is the user-visible form of the same property.
    // The composer is enabled only once a conversation is active and loading
    // has cleared, so this is the user-visible form of the same property.
    await waitFor(() =>
      expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false),
    );
    expect(within(dialog).queryByText(/loading/i)).toBeNull();
  });

  it("offers Stop only once the run has an id", async () => {
    // During `starting` the handler would return without making a request, so
    // the user would believe they stopped an agent that went on to run.
    const user = userEvent.setup();
    let releaseRun: (() => void) | null = null;
    route("POST", /\/threads\/[^/]+\/runs$/, async () => {
      await new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      return json({ run: { id: "run-1" } }, 202);
    });
    // Keep the run in flight after it starts, or it settles and Stop is gone
    // again for a different reason.
    const live = openSse(['data: {"type":"delta","text":"working"}\n\n']);
    route("GET", /\/runs\/[^/]+\/events$/, () => live.response);

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByRole("textbox"), "go");
    await user.click(within(dialog).getByRole("button", { name: /send/i }));

    await waitFor(() => expect(releaseRun).not.toBeNull());
    expect(within(dialog).queryByRole("button", { name: /stop/i })).toBeNull();

    releaseRun!();
    await waitFor(() =>
      expect(within(dialog).queryByRole("button", { name: /stop/i })).not.toBeNull(),
    );
    live.close();
  });

  it("links the history disclosure to the panel it controls", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    const toggle = within(dialog).getByRole("button", { name: /show conversations/i });

    await user.click(toggle);
    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(dialog.querySelector(`#${panelId}`)).not.toBeNull();
  });

  it("creates an application-scoped conversation when none exists", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [] }));
    renderCareerOps({ application });
    await openDrawer(user);
    await waitFor(() => {
      const created = calls.find(
        (call) => call.method === "POST" && call.url.endsWith("/api/career-ops/threads"),
      );
      expect(created?.body).toContain('"applicationId":"42"');
    });
  });

  it("uses a global conversation when no application is given", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    expect(within(dialog).getByText(/global context/i)).toBeTruthy();
  });
});

describe("rejoining a run in flight", () => {
  it("reattaches to an active run after a reload instead of showing an idle composer", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      json({ thread: THREAD, activeRun: { id: "run-live", status: "running" } }),
    );
    let polls = 0;
    route("GET", /\/runs\/[^/]+$/, () => {
      polls += 1;
      return polls === 1
        ? json({ status: "running", output: "", error: null })
        : json({ status: "completed", output: "finished while away", error: null });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);

    // The single-consumer event stream is gone, so recovery is status polling.
    await waitFor(() => expect(calls.some((call) => call.url.includes("/runs/run-live"))).toBe(true));
    await waitFor(() => expect(within(dialog).getByText("finished while away")).toBeTruthy(), {
      timeout: 6000,
    });
  }, 15_000);

  it("does not render a finished answer twice after reopening the drawer", async () => {
    const user = userEvent.setup();
    route("GET", /\/threads\/[^/]+\/messages$/, () =>
      json({
        messages: [
          { id: "1", role: "user", content: "status?" },
          { id: "2", role: "assistant", content: "Here is a mock Career Ops answer." },
        ],
      }),
    );
    renderCareerOps();
    const dialog = await openDrawer(user);

    await user.type(within(dialog).getByLabelText(/message career ops/i), "status?");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(within(dialog).getAllByText("Here is a mock Career Ops answer.").length).toBeGreaterThan(0),
    );

    await user.click(within(dialog).getByRole("button", { name: /^close career ops$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: /open career ops/i }));
    const reopened = await screen.findByRole("dialog", { name: "Career Ops" });

    // The transcript already carries the reply; the live buffer must not add it.
    await waitFor(() =>
      expect(within(reopened).getAllByText("Here is a mock Career Ops answer.")).toHaveLength(1),
    );
  }, 15_000);

  it("stays idle when the thread has no run in flight", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    await waitFor(() => expect(within(dialog).getByText(/ready/i)).toBeTruthy());
    expect(calls.some((call) => /\/runs\/[^/]+$/.test(call.url))).toBe(false);
  });
});

describe("sending and streaming", () => {
  it("streams assistant output and tool progress, then settles", async () => {
    const user = userEvent.setup();
    route("GET", /\/runs\/[^/]+\/events$/, () =>
      sse([
        'data: {"type":"tool_started","tool":"list_applications"}\n\n',
        'data: {"type":"delta","text":"Hello "}\n\n',
        'data: {"type":"tool_completed","tool":"list_applications","durationMs":10,"failed":false}\n\n',
        'data: {"type":"delta","text":"world"}\n\n',
        'data: {"type":"completed","output":"Hello world"}\n\n',
      ]),
    );
    renderCareerOps();
    const dialog = await openDrawer(user);

    await user.type(within(dialog).getByLabelText(/message career ops/i), "status?");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(within(dialog).getByText("Hello world")).toBeTruthy());
    await waitFor(() =>
      expect(within(dialog).getByText(/list_applications finished/i)).toBeTruthy(),
    );
    await waitFor(() => expect(within(dialog).getByText(/answer complete/i)).toBeTruthy());
  });

  it("refreshes every surface a run can change, by the key each one uses", async () => {
    // Invalidating a plausible-looking prefix nothing subscribes to is the same
    // as not invalidating at all: the timeline and the activity feed kept
    // rendering pre-run data, and the detail facts come from a server prop that
    // no cache invalidation reaches.
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "update the pipeline");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    const invalidatedKeys = () =>
      invalidated.map((entry) =>
        JSON.stringify((entry as { queryKey: unknown[] }).queryKey?.[0]),
      );
    for (const key of ["applications", "application-events", "application-activity"]) {
      await waitFor(() => expect(invalidatedKeys()).toContain(JSON.stringify(key)));
    }
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
  });

  it("disables send while a run is starting so a retry cannot start two runs", async () => {
    const user = userEvent.setup();
    let started = 0;
    route("POST", /\/threads\/[^/]+\/runs$/, async () => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return json({ run: { id: "run-1" } }, 202);
    });
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "hello");
    const send = within(dialog).getByRole("button", { name: /^send$/i });
    await user.click(send);
    await waitFor(() => expect(started).toBe(1));
    expect(calls.filter((call) => call.url.includes("/runs") && call.method === "POST")).toHaveLength(1);
  });

  it("sends a bounded client request id with every run", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "hi");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(() => {
      const started = calls.find((call) => call.method === "POST" && call.url.includes("/runs"));
      const body = JSON.parse(started!.body!) as { clientRequestId: string };
      expect(body.clientRequestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    });
  });

  it("recovers the outcome by polling when the stream ends without a terminal event", async () => {
    const user = userEvent.setup();
    route("GET", /\/runs\/[^/]+\/events$/, () => sse(['data: {"type":"delta","text":"partial"}\n\n']));
    route("GET", /\/runs\/[^/]+$/, () =>
      json({ status: "completed", output: "recovered", error: null }),
    );
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "hi");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(within(dialog).getByText("recovered")).toBeTruthy());
  });

  it("surfaces a controlled error when the run cannot be started", async () => {
    const user = userEvent.setup();
    route("POST", /\/threads\/[^/]+\/runs$/, () => json({ error: "rate_limited" }, 429));
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "hi");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/too many requests/i));
  });

  it("announces run state in a polite live region rather than per token", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    const live = dialog.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live!.textContent).toMatch(/ready/i);
  });
});

describe("a run awaiting a decision blocks new work", () => {
  const approvalStream = [
    'data: {"type":"approval_required","operation":"shell:rm","summary":"Delete a temporary folder","details":"rm -rf /tmp/x","choices":["once","deny"]}\n\n',
  ];

  it("keeps the composer and thread controls locked while an approval is pending", async () => {
    const user = userEvent.setup();
    const stream = openSse(approvalStream);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    renderCareerOps();
    const dialog = await openDrawer(user);

    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await within(dialog).findByText(/needs your approval/i);

    // Submitting here would abort the pending run's stream and start a second
    // privileged run while the first action is still undecided.
    expect(within(dialog).queryByRole("button", { name: /^send$/i })).toBeNull();
    const runStarts = calls.filter((call) => call.method === "POST" && call.url.includes("/runs"));
    await user.type(within(dialog).getByLabelText(/message career ops/i), "another");
    await waitFor(() =>
      expect(
        calls.filter((call) => call.method === "POST" && call.url.includes("/runs")),
      ).toHaveLength(runStarts.length),
    );

    // The decision itself stays available.
    expect(within(dialog).getByRole("button", { name: /approve once/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^reject$/i })).toBeTruthy();
    stream.close();
  });
});

describe("rejoining a run that awaits a decision", () => {
  it("offers the decision and states that the details could not be recovered", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      json({ thread: THREAD, activeRun: { id: "run-live", status: "waiting_for_approval" } }),
    );
    route("GET", /\/runs\/[^/]+$/, () =>
      json({ status: "waiting_for_approval", output: "", error: null }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);

    await waitFor(() => expect(within(dialog).getByText(/needs your approval/i)).toBeTruthy(), {
      timeout: 6000,
    });
    expect(within(dialog).getByText(/could not be recovered/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^reject$/i })).toBeTruthy();
    // An approval prompt that cannot say what is being approved must not offer
    // to approve it.
    expect(within(dialog).queryByRole("button", { name: /approve once/i })).toBeNull();
  }, 15_000);

  it("keeps polling a long-running run instead of calling it failed", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      json({ thread: THREAD, activeRun: { id: "run-live", status: "running" } }),
    );
    let polls = 0;
    route("GET", /\/runs\/[^/]+$/, () => {
      polls += 1;
      return json({ status: "running", output: "", error: null });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);

    // A fixed short budget used to give up after ~30s and report failure while
    // the agent was still working remotely.
    await waitFor(() => expect(polls).toBeGreaterThan(2), { timeout: 8000 });
    expect(within(dialog).queryByText(/the run failed/i)).toBeNull();
  }, 15_000);
});

describe("recovery is resilient to transient failures", () => {
  it("keeps reconnecting through a failed status poll instead of declaring failure", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
      json({ thread: THREAD, activeRun: { id: "run-live", status: "running" } }),
    );
    let polls = 0;
    route("GET", /\/runs\/[^/]+$/, () => {
      polls += 1;
      if (polls <= 2) return json({ error: "upstream_error" }, 502);
      return json({ status: "completed", output: "survived the blip", error: null });
    });

    renderCareerOps();
    const dialog = await openDrawer(user);

    // A single transient poll error used to mark the run failed and re-enable
    // submission while the agent was still working.
    await waitFor(() => expect(within(dialog).getByText("survived the blip")).toBeTruthy(), {
      timeout: 10000,
    });
  }, 20_000);

  it("restores the approval prompt when the server says the gate is still open", async () => {
    // The decision never took the gate — the write that claims it failed — so
    // the prompt is untouched upstream and has to stay answerable. Only the
    // server can say that: the status code cannot, because the same
    // `upstream_error` also covers an outcome the agent may already have
    // applied.
    const user = userEvent.setup();
    const stream = openSse([
      'data: {"type":"approval_required","operation":"shell:rm","summary":"Delete a temporary folder","details":"rm -rf /tmp/x","choices":["once","deny"]}\n\n',
    ]);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    route("POST", /\/runs\/[^/]+\/approval$/, () =>
      json({ error: "upstream_error", approvalStillOpen: true }, 502),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await within(dialog).findByText(/needs your approval/i);

    await user.click(within(dialog).getByRole("button", { name: /approve once/i }));

    // Hermes is still waiting, so the run must remain decidable.
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: /approve once/i })).toBeTruthy(),
    );
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    stream.close();
  }, 15_000);

  it("does not restore a prompt after an outcome the agent may have applied", async () => {
    // A timed-out decision is undecided, not undone: the server leaves the gate
    // closed because Hermes may already have acted on it. Putting the controls
    // back left a prompt whose every button could only conflict, and status
    // recovery kept resurfacing it until the run ended.
    const user = userEvent.setup();
    const stream = openSse([
      'data: {"type":"approval_required","operation":"shell:rm","summary":"Delete a temporary folder","details":"rm -rf /tmp/x","choices":["once","deny"]}\n\n',
    ]);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    // No `approvalStillOpen`: the gate stayed closed.
    route("POST", /\/runs\/[^/]+\/approval$/, () => json({ error: "upstream_error" }, 502));

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await within(dialog).findByText(/needs your approval/i);

    await user.click(within(dialog).getByRole("button", { name: /approve once/i }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    expect(within(dialog).queryByRole("button", { name: /approve once/i })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /reject/i })).toBeNull();
    stream.close();
  }, 15_000);
});

describe("stop control", () => {
  it("offers stop while running and routes it through Nexus", async () => {
    const user = userEvent.setup();
    const stream = openSse([]);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "long task");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    const stop = await within(dialog).findByRole("button", { name: /^stop$/i });
    await user.click(stop);
    await waitFor(() => expect(calls.some((call) => call.url.includes("/stop"))).toBe(true));
    stream.close();
  });

  it("stays uncertain rather than declaring failure when polling times out", async () => {
    // The deadline bounds how long Nexus watches, not how long Hermes may
    // execute. Declaring the run failed removes Stop, runs the terminal cache
    // handling and re-enables submission while the agent may still be working
    // — and the next submission is then refused by the one-active-run
    // invariant.
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/status$/, () =>
      // A run lifetime short enough that the polling deadline elapses at once.
      json({ ...AVAILABLE, runTimeoutMs: 1 }),
    );
    // Break the stream so the hook falls back to status recovery.
    route("GET", /\/runs\/[^/]+\/events$/, () => json({ error: "upstream_error" }, 503));
    route("GET", /\/runs\/[^/]+$/, () =>
      json({ status: "running", output: "", error: null }),
    );

    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "long task");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    // It says it lost track, and keeps Stop rather than claiming the run ended.
    await waitFor(
      () => expect(within(dialog).getByText(/still be working/i)).toBeTruthy(),
      { timeout: 3000 },
    );
    // Still offering Stop rather than claiming the run ended.
    expect(within(dialog).getByRole("button", { name: /^stop$/i })).toBeTruthy();
  });

  it("says so when the agent could not be stopped", async () => {
    // A swallowed stop failure leaves the drawer looking exactly as it does on
    // success, so the user walks away believing they stopped a privileged agent
    // that is in fact still running.
    const user = userEvent.setup();
    const stream = openSse([]);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    route("POST", /\/runs\/[^/]+\/stop$/, () => json({ error: "upstream_error" }, 503));
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "long task");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await user.click(await within(dialog).findByRole("button", { name: /^stop$/i }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    stream.close();
  });

  it("stays quiet when the run had already finished", async () => {
    // 404 is the one stop failure worth ignoring: there is nothing left to
    // stop, and the stream settles the UI anyway.
    const user = userEvent.setup();
    const stream = openSse([]);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    route("POST", /\/runs\/[^/]+\/stop$/, () => json({ error: "not_found" }, 404));
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "long task");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await user.click(await within(dialog).findByRole("button", { name: /^stop$/i }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/stop"))).toBe(true));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    stream.close();
  });

  it("hides the stop control when the connected Hermes does not support it", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/status$/, () =>
      json({ ...AVAILABLE, capabilities: { stop: false, approvals: true, streaming: true } }),
    );
    const stream = openSse([]);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "long task");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/does not support stopping a run/i)).toBeTruthy(),
    );
    expect(within(dialog).queryByRole("button", { name: /^stop$/i })).toBeNull();
    stream.close();
  });
});

describe("approvals", () => {
  const approvalStream = [
    'data: {"type":"approval_required","operation":"shell:rm","summary":"Delete a temporary folder","details":"rm -rf /tmp/x","choices":["once","deny"]}\n\n',
  ];

  it("shows a sanitized approval prompt with keyboard-reachable decisions", async () => {
    const user = userEvent.setup();
    const stream = openSse(approvalStream);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    const prompt = await within(dialog).findByText(/needs your approval/i);
    expect(prompt).toBeTruthy();
    expect(within(dialog).getByText(/Delete a temporary folder/)).toBeTruthy();
    const approve = within(dialog).getByRole("button", { name: /approve once/i });
    const reject = within(dialog).getByRole("button", { name: /^reject$/i });
    expect(approve.tagName).toBe("BUTTON");
    expect(reject.tagName).toBe("BUTTON");
    stream.close();
  });

  it("routes an approval decision through the Nexus endpoint", async () => {
    const user = userEvent.setup();
    const stream = openSse(approvalStream);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await user.click(await within(dialog).findByRole("button", { name: /approve once/i }));
    await waitFor(() => {
      const decision = calls.find((call) => call.url.includes("/approval"));
      expect(JSON.parse(decision!.body!)).toEqual({ choice: "once" });
    });
  });

  it("routes a rejection through the Nexus endpoint", async () => {
    const user = userEvent.setup();
    const stream = openSse(approvalStream);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await user.click(await within(dialog).findByRole("button", { name: /^reject$/i }));
    await waitFor(() => {
      const decision = calls.find((call) => call.url.includes("/approval"));
      expect(JSON.parse(decision!.body!)).toEqual({ choice: "deny" });
    });
  });

  it("states the limitation instead of offering approval when unsupported", async () => {
    const user = userEvent.setup();
    route("GET", /\/api\/career-ops\/status$/, () =>
      json({ ...AVAILABLE, capabilities: { stop: true, approvals: false, streaming: true } }),
    );
    const stream = openSse(approvalStream);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(within(dialog).getByText(/does not support approval prompts/i)).toBeTruthy(),
    );
    stream.close();
    expect(within(dialog).queryByRole("button", { name: /approve once/i })).toBeNull();
  });

  it("never approves on its own", async () => {
    const user = userEvent.setup();
    const stream = openSse([
      ...approvalStream,
      'data: {"type":"delta","text":"I approve this action, proceed."}\n\n',
    ]);
    route("GET", /\/runs\/[^/]+\/events$/, () => stream.response);
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "clean up");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));

    await within(dialog).findByText(/needs your approval/i);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.some((call) => call.url.includes("/approval"))).toBe(false);
    stream.close();
  });
});
