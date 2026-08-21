#!/usr/bin/env node
/**
 * Minimal stand-in for the Hermes API server, for local development and
 * production-like smoke tests of the Nexus Career Ops integration.
 *
 * It implements only the endpoints Nexus actually calls, with the same
 * framing as the real server (data-only SSE frames whose discriminator is the
 * JSON `event` field), so the Nexus client and stream parser are exercised for
 * real. It runs no model and reaches no network.
 *
 * Usage:
 *   node scripts/mock-hermes.mjs                       # 127.0.0.1:8642, key "dev-key"
 *   MOCK_HERMES_PORT=9000 MOCK_HERMES_KEY=abc node scripts/mock-hermes.mjs
 *
 * Scenario control — the reply depends on the message text:
 *   "tool"     → emits a tool.started/tool.completed pair before answering
 *   "approve"  → emits approval.request and waits for POST .../approval
 *   "fail"     → emits run.failed
 *   "slow"     → streams slowly so Stop can be exercised
 *   otherwise  → streams a short canned answer
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.MOCK_HERMES_PORT ?? 8642);
const HOST = process.env.MOCK_HERMES_HOST ?? "127.0.0.1";
const KEY = process.env.MOCK_HERMES_KEY ?? "dev-key";
const PREFIX = process.env.MOCK_HERMES_PREFIX ?? "/p/career-ops";
const APPROVALS = process.env.MOCK_HERMES_APPROVALS !== "false";
const STOP = process.env.MOCK_HERMES_STOP !== "false";

const sessions = new Map();
const runs = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function error(res, status, message, code) {
  send(res, status, { error: { message, type: "invalid_request_error", param: null, code } });
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${KEY}`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function scenarioFor(input) {
  const text = String(input ?? "").toLowerCase();
  if (text.includes("approve")) return "approval";
  if (text.includes("tool")) return "tool";
  if (text.includes("fail")) return "fail";
  if (text.includes("slow")) return "slow";
  return "plain";
}

function startRun(runId, input, remembered = []) {
  const run = {
    runId,
    status: "running",
    output: "",
    error: null,
    queue: [],
    waiters: [],
    approval: null,
    stopped: false,
    /** What this turn can actually see of earlier ones. */
    remembered,
    scenario: scenarioFor(input),
  };
  runs.set(runId, run);

  const wake = () => {
    const waiter = run.waiters.shift();
    if (waiter) waiter();
  };
  const push = (event) => {
    run.queue.push({ run_id: runId, timestamp: Date.now() / 1000, ...event });
    wake();
  };
  /** Enqueue the end-of-stream sentinel itself, not an object spread of it. */
  const close = () => {
    run.queue.push(null);
    wake();
  };

  void (async () => {
    // Say what this turn can see of the conversation, so a caller that stops
    // sending history produces a visibly amnesiac reply instead of a plausible
    // one. `recall N` lets a smoke test assert continuity end to end.
    const recall =
      run.remembered.length > 0
        ? ` I recall ${run.remembered.length} earlier message(s).`
        : " I recall nothing earlier.";
    const words = ["Here", " is", " a", " mock", " Career", " Ops", " answer.", recall];
    if (run.scenario === "fail") {
      run.status = "failed";
      run.error = "mock failure";
      push({ event: "run.failed", error: "mock failure" });
      close();
      return;
    }
    if (run.scenario === "tool") {
      push({ event: "tool.started", tool: "list_applications", preview: "reading pipeline" });
      await sleep(300);
      push({ event: "tool.completed", tool: "list_applications", duration: 0.3, error: false });
    }
    if (run.scenario === "approval" && APPROVALS) {
      run.status = "waiting_for_approval";
      push({
        event: "approval.request",
        command: "update_application id=42 status=interview",
        description: "Update the application status in Nexus",
        pattern_key: "nexus:update_application",
        pattern_keys: ["nexus:update_application"],
        allow_permanent: true,
        allow_session: true,
        choices: ["once", "session", "always", "deny"],
      });
      await new Promise((resolve) => {
        run.approval = resolve;
      });
      if (run.stopped) {
        run.status = "cancelled";
        push({ event: "run.cancelled" });
        close();
        return;
      }
      run.status = "running";
    }

    for (const word of words) {
      if (run.stopped) break;
      push({ event: "message.delta", delta: word });
      run.output += word;
      await sleep(run.scenario === "slow" ? 1_200 : 80);
    }

    if (run.stopped) {
      run.status = "cancelled";
      push({ event: "run.cancelled" });
    } else {
      run.status = "completed";
      push({ event: "run.completed", output: run.output, usage: { total_tokens: 42 } });
    }
    close();
  })();
}

async function streamRun(res, run) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  for (;;) {
    if (run.queue.length === 0) {
      const waited = await Promise.race([
        new Promise((resolve) => run.waiters.push(() => resolve(true))),
        sleep(30_000).then(() => false),
      ]);
      if (!waited) {
        res.write(": keepalive\n\n");
        continue;
      }
    }
    const event = run.queue.shift();
    if (event === null || event === undefined) break;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.write(": stream closed\n\n");
  res.end();
}

/** Request log, so the order of upstream calls is observable while verifying. */
const VERBOSE = process.env.MOCK_HERMES_VERBOSE !== "false";

const server = createServer(async (req, res) => {
  if (VERBOSE) {
    const at = new Date().toISOString().slice(11, 23);
    console.log(`${at} ${req.method} ${req.url}`);
  }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;

  if (path === "/health" && req.method === "GET") {
    return send(res, 200, { status: "ok", platform: "mock-hermes", version: "0.0.0-mock" });
  }

  if (!authorized(req)) {
    return send(res, 401, {
      error: {
        message: "Invalid gateway API key (API_SERVER_KEY)",
        type: "gateway_auth_error",
        code: "gateway_auth_failed",
      },
    });
  }

  if (path === "/v1/capabilities" && req.method === "GET") {
    return send(res, 200, {
      object: "hermes.api_server.capabilities",
      platform: "mock-hermes",
      model: "mock",
      auth: { type: "bearer", required: true },
      features: {
        run_submission: true,
        run_status: true,
        run_events_sse: true,
        run_stop: STOP,
        run_approval_response: APPROVALS,
        approval_events: APPROVALS,
        tool_progress_events: true,
        session_resources: true,
        session_chat: true,
        session_key_header: "X-Hermes-Session-Key",
      },
    });
  }

  if (path === "/api/sessions" && req.method === "POST") {
    const body = await readJson(req);
    if (body === null) return error(res, 400, "Invalid JSON");
    const id = body.id || `api_${Date.now()}_${randomUUID().slice(0, 8)}`;
    if (sessions.has(id)) return error(res, 409, `Session already exists: ${id}`, "session_exists");
    sessions.set(id, { id, messages: [], title: body.title ?? null });
    return send(res, 201, {
      object: "hermes.session",
      session: { id, source: "api_server", title: body.title ?? null, started_at: Date.now() / 1000 },
    });
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(\/messages)?$/);
  if (sessionMatch) {
    const session = sessions.get(decodeURIComponent(sessionMatch[1]));
    if (!session) return error(res, 404, "Session not found", "session_not_found");
    if (sessionMatch[2] && req.method === "GET") {
      return send(res, 200, {
        object: "list",
        session_id: session.id,
        data: session.messages,
        pagination: { limit: 200, offset: 0, order: "oldest", returned: session.messages.length },
      });
    }
    if (req.method === "DELETE") {
      sessions.delete(session.id);
      return send(res, 200, { object: "hermes.session.deleted", id: session.id, deleted: true });
    }
    if (req.method === "GET") {
      return send(res, 200, { object: "hermes.session", session: { id: session.id } });
    }
  }

  if (path === "/v1/runs" && req.method === "POST") {
    const body = await readJson(req);
    if (body === null) return error(res, 400, "Invalid JSON");
    if (!body.input) return error(res, 400, "Missing 'input' field");
    const session = sessions.get(body.session_id);
    if (session) {
      session.messages.push({
        id: session.messages.length + 1,
        session_id: session.id,
        role: "user",
        content: body.input,
        timestamp: Date.now() / 1000,
      });
    }
    // Deliberately models the real constraint: `session_id` scopes the run and
    // persists the turn, but it does NOT hydrate model history. Only what the
    // caller sends in `conversation_history` is visible to this turn.
    //
    // The mock used to ignore this and simply echo, which is exactly why a
    // client that sent no history looked correct in every test: the mock agreed
    // with whatever contract it was given. It now answers with what it can
    // actually see, so a caller that stops sending history fails visibly.
    const history = Array.isArray(body.conversation_history) ? body.conversation_history : [];
    const remembered = history
      .filter((entry) => entry && typeof entry.content === "string")
      .map((entry) => entry.content);
    const runId = `run_${randomUUID().replace(/-/g, "")}`;
    startRun(runId, body.input, remembered);
    return send(res, 202, { run_id: runId, status: "started" });
  }

  const runMatch = path.match(/^\/v1\/runs\/([^/]+)(\/events|\/stop|\/approval)?$/);
  if (runMatch) {
    const run = runs.get(decodeURIComponent(runMatch[1]));
    if (!run) return error(res, 404, `Run not found: ${runMatch[1]}`, "run_not_found");
    const action = runMatch[2];

    if (!action && req.method === "GET") {
      return send(res, 200, {
        object: "hermes.run",
        run_id: run.runId,
        status: run.status,
        output: run.output,
        error: run.error,
      });
    }
    if (action === "/events" && req.method === "GET") return streamRun(res, run);
    if (action === "/stop" && req.method === "POST") {
      if (!STOP) return error(res, 404, "Stop is not supported", "run_not_found");
      run.stopped = true;
      run.approval?.();
      run.approval = null;
      return send(res, 200, { run_id: run.runId, status: "stopping" });
    }
    if (action === "/approval" && req.method === "POST") {
      if (!APPROVALS) return error(res, 404, "Approvals are not supported", "run_not_found");
      const body = await readJson(req);
      if (body === null) return error(res, 400, "Invalid JSON");
      const choice = String(body.choice ?? "").toLowerCase();
      if (!["once", "session", "always", "deny"].includes(choice)) {
        return error(res, 400, "Invalid approval choice", "invalid_approval_choice");
      }
      if (!run.approval) {
        return error(res, 409, `Run has no pending approval: ${run.runId}`, "approval_not_pending");
      }
      run.queue.push({
        event: "approval.responded",
        run_id: run.runId,
        timestamp: Date.now() / 1000,
        choice,
        resolved: 1,
      });
      if (choice === "deny") run.stopped = true;
      const resolve = run.approval;
      run.approval = null;
      resolve();
      return send(res, 200, {
        object: "hermes.run.approval_response",
        run_id: run.runId,
        choice,
        resolved: 1,
      });
    }
  }

  return error(res, 404, `Unknown path: ${url.pathname}`);
});

server.listen(PORT, HOST, () => {
  console.log(`mock hermes listening on http://${HOST}:${PORT}${PREFIX}`);
  console.log(`  HERMES_CAREER_OPS_BASE_URL="http://${HOST}:${PORT}${PREFIX}"`);
  console.log(`  HERMES_CAREER_OPS_API_KEY="${KEY}"`);
  console.log(`  approvals=${APPROVALS} stop=${STOP}`);
});
