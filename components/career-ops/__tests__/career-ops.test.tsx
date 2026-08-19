/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "@/messages/en.json";
import { CareerOps } from "../career-ops";

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
      close = () => controller.close();
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

function installFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: (init?.body as string) ?? null });
    for (const [pattern, routeMethod, handler] of routes) {
      if (routeMethod === method && pattern.test(url)) return handler(url, init);
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

beforeEach(() => {
  routes = [];
  calls.length = 0;
  invalidated.length = 0;
  vi.clearAllMocks();
  installFetch();
  route("GET", /\/api\/career-ops\/status$/, () => json(AVAILABLE));
  route("GET", /\/api\/career-ops\/threads$/, () => json({ threads: [THREAD] }));
  route("POST", /\/api\/career-ops\/threads$/, () => json({ thread: THREAD }, 201));
  route("GET", /\/threads\/[^/]+\/messages$/, () => json({ messages: [] }));
  route("GET", /\/api\/career-ops\/threads\/[^/]+$/, () =>
    json({ thread: THREAD, activeRun: null }),
  );
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
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    renderCareerOps();
    const dialog = await openDrawer(user);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
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

  it("invalidates application queries after a run completes", async () => {
    const user = userEvent.setup();
    renderCareerOps();
    const dialog = await openDrawer(user);
    await user.type(within(dialog).getByLabelText(/message career ops/i), "update the pipeline");
    await user.click(within(dialog).getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(
        invalidated.some(
          (entry) =>
            JSON.stringify((entry as { queryKey: unknown }).queryKey) ===
            JSON.stringify(["applications"]),
        ),
      ).toBe(true),
    );
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
