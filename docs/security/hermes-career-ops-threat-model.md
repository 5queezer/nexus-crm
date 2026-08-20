# Hermes Career Ops threat model

Career Ops connects Nexus to an **external agent runtime that may hold terminal, browser, filesystem, and Nexus tool access**. Treat the Nexus → Hermes link as a privileged remote-agent boundary, not as an ordinary upstream API call.

One thing to state plainly up front: **Nexus cannot sandbox Hermes.** What that agent is allowed to do is decided entirely by the Hermes deployment and the `career-ops` profile. Nexus controls *who may address which conversation and run*, and *what leaves the browser* — nothing more. Any claim beyond that would be false.

Scope: the Nexus code under `lib/career-ops/`, `app/api/career-ops/`, `components/career-ops/`, and the `CareerOpsThread` / `CareerOpsRun` tables.

## Trust boundaries

| Boundary | Direction | Trust |
| --- | --- | --- |
| Browser → Nexus | inbound | Untrusted. Authenticated per request; every identifier re-resolved server-side. |
| Nexus → Hermes | outbound | Operator-configured. Fixed endpoint, fixed operation set, bearer token. |
| Hermes → Nexus MCP | outbound from Hermes | Authenticated separately with a Nexus API token; owner-scoped by the MCP server. |
| Hermes → web / job sources | outbound from Hermes | Untrusted content. Never treated as instructions by Nexus. |

## Threats and controls

### T1 — Bearer-token disclosure

*Impact:* an attacker holding the Hermes API key can drive a privileged agent directly.

- The token is read only in `lib/career-ops/config.ts`, a server module never imported by a client component.
- It is stored as a **non-enumerable** property, so `JSON.stringify(config)` and `{...config}` cannot carry it into a log line or a response.
- No `NEXT_PUBLIC_` variable exists for it, so it cannot enter a client bundle.
- `redactSecrets()` strips bearer tokens, `api_key`/`token`/`secret` assignments, `sk-` prefixed strings, and the configured key itself from any text derived from the upstream. `redactUpstreamError()` adds a 300-character bound for error text.
- Approval prompts deliberately use the **non-truncating** variant. Their text is already bounded at the display bound that decides whether the prompt is rejection-only, and a second, shorter clip there would hide a consequential suffix from an action the human is being asked to authorize.
- Route tests assert that no response body or thrown error contains the configured key, across success, 401/403/404/409/429/5xx, and stream-failure paths.

*Residual:* an operator who puts the key in a shell history, a process listing, or a world-readable env file. Deployment guidance covers this; Nexus cannot enforce it.

### T2 — Cross-user session or run access

*Impact:* reading another person's career conversation, or driving their agent.

- Every route resolves a Nexus-owned mapping keyed by the authenticated `userId` **before** any Hermes identifier is named.
- `session.readScopeUserId` is deliberately never consulted. Administrators hold cross-tenant read authority over CRM data; that authority explicitly does **not** extend to Career Ops. Tests assert an admin gets `404` on another user's thread and run.
- Foreign and unknown ids are indistinguishable: both return `404` with no content and no existence disclosure.
- Deduplication is keyed on `threadId`, which is itself owner-scoped, so two users cannot collide on a shared `clientRequestId`.

### T3 — Forged Hermes session or run identifiers

*Impact:* addressing a Hermes session the user does not own — including another channel's transcript.

- A Hermes session id or run id supplied by a client is **never** authority. It is not even accepted as input: the browser addresses conversations by Nexus thread id, and `hermesSessionId` is stripped from every serialized response.
- Only the ids Nexus itself stored are ever placed in an upstream URL, and they are percent-encoded.
- There is no generic proxy route. Eight upstream operations exist, each with a fixed method and path template; no client-controlled path segment, method, or header reaches Hermes.

### T4 — Prompt injection from job descriptions and MCP output

*Impact:* text inside an application, an email, or a scraped job page tries to redirect the agent.

- Nexus never acts on assistant output. No model text can create a thread, start a run, approve an action, choose an endpoint, or widen a scope — those are all explicit HTTP requests from the browser, each independently authorized.
- Run instructions state explicitly that Nexus-stored text is user data and that directions found inside it must not be followed.
- Application-derived text sent upstream is whitespace-collapsed and truncated to 120 characters per field, so injected content cannot fake instruction structure.
- Career Ops' write access to Nexus is exactly the existing Nexus MCP surface, which is owner-scoped independently of this feature.

*Residual:* a sufficiently persuasive injection can still cause the agent to make legitimate-looking MCP calls within the user's own data. Approval gates and the MCP server's own scoping are the mitigations; Nexus cannot read the agent's intent.

### T5 — Approval spoofing / self-approval

*Impact:* a gated, dangerous operation gets approved without a human.

- Approvals are only offered when `/v1/capabilities` advertises `run_approval_response`. When it does not, the UI states the limitation instead of inventing a control.
- Every decision is an explicit `POST` from an authenticated browser session, ownership-checked against `CareerOpsRun` before forwarding.
- Only `once`, `session`, `always`, `deny` are accepted; there is no default, no inferred value, and no timeout-based decision.
- Assistant text that reads as an approval has no effect — there is a test for exactly this.
- Nexus records the owning user, run, decision and timestamp for attribution — and no approval command payload or argument.
- A run rejoined after a disconnect can only be **denied**: Hermes' run status carries no approval payload and the event stream that had it is single-consumer and gone, so a prompt that cannot show what is being approved does not offer to approve it.

### T6 — SSE disconnection and replay

*Impact:* a lost stream leaves the UI wrong, or a re-subscription leaks another run's events.

- The upstream stream is single-consumer; Nexus never re-subscribes. On a drop the UI shows *reconnecting* and settles from the ownership-checked status endpoint.
- The Nexus-facing stream is a re-emission, not a pass-through: each frame is parsed, mapped onto a closed event set, and re-serialized. Unknown events (`reasoning.available`, `subagent.*`), malformed frames, and unexpected fields are dropped, so reasoning traces and raw internal payloads never reach the browser.
- The stream route is authorized identically to every other run operation; an abort on the client aborts the upstream request.

### T7 — One MCP token, many Nexus users

*Impact:* the Hermes profile holds a single Nexus API token, and the Nexus MCP server scopes every tool call to that token's owner. An agent run therefore acts as that user regardless of who started the conversation, so in a multi-user deployment one person's Career Ops run could read and mutate another's CRM data.

This is a property of the deployment shape, not something the Nexus BFF can fix: the per-user isolation of threads and runs protects the *conversation*, not the *data the agent touches*.

- Nexus requires `HERMES_CAREER_OPS_OWNER_USER_ID` to name the token's owner, and refuses the feature to every other user — status, threads, runs, stop and approval alike.
- The binding is mandatory: with it unset the feature stays disabled rather than defaulting to "serve everyone".
- Supporting multiple users requires a Hermes profile and Nexus token per user; that is out of scope here and documented as such.

*Residual:* an operator who points the variable at the wrong user. The runbook says how to find the right id.

### T8 — Upstream Hermes compromise

*Impact:* a compromised Hermes can return anything, and already holds a Nexus MCP token.

- A compromised Hermes is a compromise of everything its MCP token can reach. **Nexus cannot mitigate this** — the mitigations are deployment isolation, a dedicated and narrowly scoped Nexus API token for the profile, and monitoring.
- What Nexus does bound: response parsing is defensive (unknown statuses map to `failed`, missing fields are tolerated, non-JSON bodies are rejected), all upstream text is redacted before logging, response and frame sizes are bounded while reading, and `redirect: "error"` prevents the upstream from steering a request elsewhere.
- The browser is never told to connect to Hermes, so a compromised upstream cannot pivot into the user's origin.

### T9 — Over-privileged Career Ops profile

*Impact:* the agent can do far more than career operations require.

- Out of Nexus' control by construction. The setup runbook recommends a dedicated profile, a distinct API key, loopback or private-network binding, and the narrowest workable toolset.
- Nexus exposes none of Hermes' broader surface: no jobs API, no skills/toolset administration, no steer, no fork, no arbitrary user-defined MCP connectors.

### T10 — Denial of service and resource exhaustion

- Bodies are capped at 32 KB and messages at 8 000 characters, checked before any upstream request.
- Run creation, stop, and approval are rate limited per authenticated user (not per source address, so a shared proxy address cannot be used to exhaust one bucket).
- Connect, idle, and total-run timeouts are bounded and configurable, enforced with `AbortSignal`; upstream `429` is surfaced with `Retry-After`.
- Assistant output is stripped of credential-like content on both the streaming and status-recovery paths, with a boundary-aware redactor so a credential split across two stream frames is still caught. Without it a broken or compromised Hermes echoing the configured key would forward it verbatim to the browser.
- The redactor holds a tail back for **any credential shape**, not only this deployment's configured keys, and never cuts inside one. A cut a few characters into a token emits a prefix too short for the generic pattern to match and retains a suffix that no longer carries the keyword, so the credential would arrive in two innocuous-looking halves — a Nexus `jt_` token the agent printed leaks exactly this way. A credential-shaped run too long to hold is redacted as a unit and its continuation dropped, so a hostile upstream cannot force unbounded buffering either.
- Response bodies are read through a byte bound and cancelled at the limit rather than buffered whole, on both success and error paths, so an upstream that returns an unbounded reply cannot exhaust the process.
- The SSE reader caps a single unterminated frame (256 KB) and the total payload of one run stream (8 MB), and aborts the stream when either is exceeded. Without the frame cap an upstream that never sends a blank-line delimiter would grow the buffer without end.

### T11 — Data at rest

- `CareerOpsThread` holds `userId`, `hermesSessionId`, `title`, optional `applicationId`, timestamps. `CareerOpsRun` holds `userId`, `threadId`, `hermesRunId`, `clientRequestId`, a status string, timestamps.
- No API key, no authorization header, no message body, no reasoning, no tool arguments. A contract test asserts no field name matching `key|token|secret|authorization|content|message` exists on either record.
- Deleting a thread removes its runs and requests the upstream session deletion. If that upstream call fails the Nexus mapping is **still** removed — an orphaned upstream session nothing can address is strictly safer than a live pointer.
- Deleting a user cascades both tables on the relational backend. On any backend an orphaned mapping stays unreachable, because every read is filtered by the authenticated user id.

## Deployment expectations

1. Run the Hermes API server on loopback or a private interface. Do not publish the port.
2. Do not enable CORS on Hermes; the browser must never reach it.
3. Give the `career-ops` profile its own `API_SERVER_KEY`, not shared with another profile.
4. Set `HERMES_CAREER_OPS_OWNER_USER_ID` to the Nexus user whose token the profile uses. Career Ops serves that user only.
4. Give the profile a Nexus API token scoped to the intended user, and rotate it independently.
5. Keep `HERMES_CAREER_OPS_ENABLED=false` wherever the feature is not deliberately in use.
6. Rotating the API key also rotates the derived memory scope unless `HERMES_CAREER_OPS_SCOPE_SECRET` is set explicitly.

## Verified assumptions

The upstream contract was verified against the Hermes API server implementation (`NousResearch/hermes-agent`, `gateway/platforms/api_server.py`), not inferred from prose: bearer auth with timing-safe comparison, data-only SSE framing, the single-consumer run event stream, the absence of idempotency on `POST /v1/runs`, and the `once|session|always|deny` approval vocabulary. If a future Hermes changes these, capability negotiation degrades the affected control rather than failing open.
