## Context

See `proposal.md` — Why. This section records only the constraints that shape the approach.

Verified against the Hermes API server implementation (`NousResearch/hermes-agent@main`, `gateway/platforms/api_server.py`) rather than inferred from prose:

- Auth is a single bearer token compared timing-safely; errors use the OpenAI envelope `{"error":{message,type,param,code}}`.
- `GET /v1/capabilities` (authenticated) advertises `features.run_submission`, `run_status`, `run_events_sse`, `run_stop`, `run_approval_response`, `approval_events`, `tool_progress_events`, `session_chat`, `session_resources`, plus the header names `X-Hermes-Session-Id` and `X-Hermes-Session-Key`.
- `POST /v1/runs` returns `202 {"run_id","status":"started"}` and accepts `input`, `session_id`, `instructions`, `conversation_history`, `previous_response_id`. **It has no `Idempotency-Key` support** — only `/v1/chat/completions` and `/v1/responses` do.
- `GET /v1/runs/{id}/events` is SSE with **no `event:` line**: every frame is `data: {json}` and the discriminator is the JSON `event` field. It is **single-consumer**: the handler pops the queue in `finally`, so a dropped stream cannot be resumed. `: keepalive` comments arrive every 30s.
- Event names: `message.delta`, `tool.started`, `tool.completed`, `reasoning.available`, `subagent.start`/`subagent.complete`, `approval.request`, `approval.responded`, `run.steered`, `run.completed`, `run.failed`, `run.cancelled`.
- `GET /v1/runs/{id}` retains terminal status for 3600s with `status ∈ {queued, running, waiting_for_approval, stopping, completed, failed, cancelled}`.
- `POST /v1/runs/{id}/approval` takes `{"choice": "once"|"session"|"always"|"deny"}` (`approve`/`approved`/`allow` alias to `once`), returns `409 approval_not_pending` / `approval_not_active`, `400 invalid_approval_choice`.
- `X-Hermes-Session-Key` is capped at 256 chars, rejects CR/LF/NUL, requires an API key, and is echoed back.
- Multi-profile deployments are addressed by the `/p/<profile>/` URL prefix, so `HERMES_CAREER_OPS_BASE_URL` can point at `…/p/career-ops`.

Nexus-side constraints:

- `requireSessionAuth()` returns `readScopeUserId = null` for administrators. Career Ops must ignore that field entirely and scope on `userId`.
- `lib/db` is a shared `DatabaseAdapter` with Prisma and Firestore implementations; the Firestore adapter already delegates auth-adjacent entities (users, tokens, share links, audit logs) to Prisma while keeping CRM entities in Firestore.
- The existing `ai_operator` console (`lib/agent`, `app/api/agent`, `components/ai-operator`) is live on `main`. Career Ops is additive and must not modify it.
- `lib/agent/request.ts` already provides bounded JSON body reading; `lib/rate-limit.ts` provides per-group IP limiting.

## Goals / Non-Goals

**Goals:**

- One agent runtime (Hermes) and one system of record (Nexus), joined by a thin, typed, server-only adapter.
- Every browser-reachable operation resolves a Nexus-owned mapping first; a Hermes identifier is never authority.
- Degrade honestly: unconfigured, unreachable, and partially-capable Hermes instances each have a distinct, tested state.
- Backend parity: Career Ops persistence behaves identically on Prisma and Firestore.

**Non-Goals:**

- Replacing, refactoring, or deprecating the existing `ai_operator` console.
- Any in-process model inference, provider SDK, or provider key storage in Nexus.
- Reusing or exposing Telegram (or any other channel's) Hermes transcript.
- Hermes-side sandboxing claims: Nexus cannot constrain Hermes' tool access; only the Hermes deployment and profile can.
- Scheduled/autonomous runs, automatic application submission, or automatic recruiter outreach.
- Surfacing Hermes' steer, fork, jobs, skills, or toolset endpoints.

## Decisions

### D1. Runs API for turns, Sessions API for history — not `/api/sessions/{id}/chat/stream`

The session chat-stream endpoint couples the turn to one HTTP response: losing the response loses the turn, and it exposes no run identifier to stop or approve. The Runs API gives a `run_id` up front (202), a separate detachable event stream, pollable status with a 1-hour terminal retention window, plus `stop` and `approval` control endpoints — every property the spec's cancellation, approval, and reconnection requirements need.

Nexus therefore: creates a Hermes session with `POST /api/sessions` (so a durable transcript exists and `GET /api/sessions/{id}/messages` can rehydrate history), then submits each turn as `POST /v1/runs` with that `session_id`.

*Alternative considered:* `/v1/chat/completions` with `stream: true`. Rejected — stateless, no run identity, no approval or stop path.

### D2. Reconnection is poll-based, because the Hermes event stream is single-consumer

`_handle_run_events` removes the run's queue in its `finally` block, so a second subscription after a disconnect gets a `404` and the events emitted while disconnected are gone. Nexus does not pretend otherwise: the browser opens the event stream once per run; if it drops, the UI enters a *reconnecting* state and settles from `GET /api/career-ops/runs/{id}` (which proxies `GET /v1/runs/{run_id}`, valid for 3600s after completion). Missed deltas are recovered as final text from the run's `output`, and full history is available from the session messages endpoint.

*Alternative considered:* buffering the SSE stream server-side in Nexus so multiple clients can attach. Rejected for this change — it turns Nexus into a transcript store, contradicting "do not copy Hermes transcripts", and adds per-run server state with its own eviction and memory-exhaustion surface.

### D3. Nexus-side run deduplication with a client request ID

Because `/v1/runs` has no idempotency key, retry safety must live in Nexus. `POST /api/career-ops/threads/{id}/runs` requires a `clientRequestId` (bounded: 8–64 chars, `[A-Za-z0-9_-]`). The `CareerOpsRun` table carries `@@unique([threadId, clientRequestId])`. The handler:

1. looks up an existing run for `(userId, threadId, clientRequestId)` and returns it if present;
2. otherwise starts the Hermes run and inserts the mapping;
3. on a unique-constraint violation from a concurrent duplicate, re-reads and returns the winner.

A duplicate that loses the race can leave one orphaned Hermes run; it is stopped best-effort and never becomes reachable, because no mapping points at it. Deduplication is keyed by `threadId`, which is itself owner-scoped, so two users cannot collide on the same client identifier.

*Alternative considered:* hashing the message text. Rejected — a user legitimately re-asking the same question would be silently deduplicated.

### D4. Adapter parity with native Firestore collections

`CareerOpsThread` and `CareerOpsRun` go through `DatabaseAdapter` with a real Firestore implementation (collections `careerOpsThreads`, `careerOpsRuns`), not a Prisma-only path and not a Prisma delegation. Ownership filters, `updatedAt desc` ordering with an `id` tiebreak, and the `(threadId, clientRequestId)` uniqueness are implemented on both. Firestore lacks unique constraints, so uniqueness is enforced by a deterministic document ID: `careerOpsRuns/{threadId}__{clientRequestId}` created with `create()`, which fails on an existing document — the same "exactly one run" observable behavior as the Prisma constraint. Required composite indexes are added to `firestore.indexes.json`.

Cleanup differs by backend and is implemented explicitly on each: Prisma uses `onDelete: Cascade` from `User` and `onDelete: SetNull` from `Application`; Firestore performs a batched delete of owned threads/runs in `deleteApplication`'s and the user-deletion path's existing sweep, clearing `applicationId` rather than deleting the thread.

*Alternative considered:* following the share-link precedent and delegating to Prisma from the Firestore adapter. Rejected — the brief prefers parity, and unlike share links these records reference `Application`, which lives in Firestore on that deployment.

### D5. Ownership resolution is a single choke point

All routes call one service function that takes `(userId, threadId)` or `(userId, runId)` and returns the mapping or `null`. Routes never construct a Hermes URL from request input. Only six upstream operations are reachable, each with a fixed method and path template: create session, delete session, list session messages, create run, get run, get run events, stop run, resolve approval. There is no generic proxy route, no forwarded client headers, and no client-controlled path segment beyond the Hermes identifiers that Nexus itself stored.

Administrators are explicitly not exempt: the service ignores `readScopeUserId` and always filters on `session.userId`.

### D6. Memory scope is a keyed hash, not a raw user ID

`X-Hermes-Session-Key: agent:career-ops:nexus:dm:<scope>` where `<scope>` is the first 32 hex chars of `HMAC-SHA256(HERMES_CAREER_OPS_SCOPE_SECRET || HERMES_CAREER_OPS_API_KEY, userId)`. This is stable per user, contains no PII, is well under the 256-char cap and the CR/LF/NUL restriction, and does not disclose the Nexus user ID to the Hermes operator's logs. Hermes sessions themselves are created by Nexus with an `api_server` source and Nexus-generated IDs, so a browser thread never resolves to a Telegram transcript.

### D7. Application context is an instruction, not a payload

An application-scoped run sends `instructions` containing the verified `applicationId` and a short bounded reference (company/role, truncated), plus an explicit directive to fetch current facts via the Nexus MCP tools. The full job description is never sent and never copied into a Hermes-side store. The UI badge is rendered from a Nexus query the browser already makes, so it is always current.

### D8. Streaming transport to the browser

The Nexus events route (`GET /api/career-ops/runs/{id}/events`) re-emits a *normalized* SSE stream: it parses each Hermes frame, drops unknown/noisy events (`reasoning.available`, `subagent.*` internals), maps the rest to a small closed set of Nexus event shapes, and forwards only sanitized fields. This keeps raw upstream payloads out of the browser and makes the client parser small. `text/event-stream`, `Cache-Control: no-store`, and `X-Accel-Buffering: no` are set. Timeouts are enforced with `AbortSignal` for connect, idle, and total-run bounds; a keepalive comment is forwarded so intermediaries do not close idle streams.

CSP is untouched: the browser only ever connects to its own origin.

### D9. Error mapping

`401/403` upstream → `503 { error: "career_ops_unavailable" }` (a Nexus misconfiguration must not read as the *user's* auth failure); `404` upstream → `404`; `409` upstream → `409`; `429` → `429` with `Retry-After`; `5xx`/network/timeout → `502`. Bodies are always Nexus-authored; upstream text is passed through `redactUpstreamError()` and never returned verbatim.

## Risks / Trade-offs

- **Bearer-token disclosure** → the token is read only in `lib/career-ops/config.ts` (server module, never imported by a client component), never serialized into props, responses, or logs; a unit test asserts no response or thrown error contains it; a repository secret scan runs in verification.
- **Missed stream events on reconnect (D2)** → mitigated by status polling plus the session messages endpoint; the UI states this as *reconnecting*, not as normal streaming, so the user is not misled.
- **Orphaned Hermes run from a lost dedupe race (D3)** → best-effort stop; unreachable without a mapping; bounded by Hermes' own concurrency cap.
- **Prompt injection from job descriptions and MCP output** → Nexus does not act on assistant text: no assistant output can create, approve, or redirect a request. Approvals are human-only and ownership-checked. Career Ops write access to Nexus is exactly the Nexus MCP server's existing owner-scoped surface.
- **Over-privileged Career Ops profile** → out of Nexus' control by construction; documented in the threat model as a deployment responsibility, with the recommendation to bind Hermes to loopback and give the profile a distinct API key.
- **Upstream Hermes compromise** → treated as a compromise of everything the Nexus MCP token can reach; the mitigation is deployment isolation and MCP scope, not a Nexus-side sandbox. Stated explicitly rather than implied.
- **Firestore has no unique constraint (D4)** → deterministic document IDs give the same observable guarantee, at the cost of an ID format that encodes two values; contract tests assert both backends behave identically.
- **Feature drift across Hermes versions** → every optional operation is gated on `/v1/capabilities`; unknown SSE events are ignored rather than fatal; the client tolerates missing optional response fields.

## Migration Plan

1. Additive Prisma migration `add_career_ops_session_bridge` creates `CareerOpsThread` and `CareerOpsRun`. No existing table or column is altered; no data backfill.
2. `firestore.indexes.json` gains the Career Ops composite indexes; deploy them before enabling the feature on a Firestore deployment.
3. Deploy Nexus with `HERMES_CAREER_OPS_ENABLED=false` (the default). The routes return the disabled status and the UI trigger stays hidden, so the deploy is a no-op for users.
4. Configure the Hermes `career-ops` profile: API server enabled, bound to loopback or a private interface, distinct `API_SERVER_KEY`, Nexus MCP configured with a Nexus API token. Verify `/health` and `/v1/capabilities` from the Nexus host.
5. Set `HERMES_CAREER_OPS_BASE_URL`, `HERMES_CAREER_OPS_API_KEY`, and `HERMES_CAREER_OPS_ENABLED=true`; restart Nexus; confirm `GET /api/career-ops/status` reports available.

**Rollback:** set `HERMES_CAREER_OPS_ENABLED=false` and restart — the UI trigger disappears and all routes return the disabled status; no schema change is required to roll back. Full removal, if ever needed, is a separate additive-down migration; the two tables are otherwise inert.

## Open Questions

- Whether to expose Hermes' `run_steer` capability in a later change. It is deliberately excluded here: it is orthogonal to the streaming/approval surface this change specifies, and adding it does not alter these specs or tasks.
