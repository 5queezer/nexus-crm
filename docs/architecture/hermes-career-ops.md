# Hermes Career Ops architecture

Career Ops gives an authenticated Nexus user a browser conversation with the external **Hermes** Career Ops agent — the same persona, skills and Nexus MCP access that agent uses on its other channels — without leaving the pipeline they are working on. Memory is **not** shared across channels; see [Long-term memory scope](#long-term-memory-scope).

The integration deliberately adds **no second agent runtime and no second system of record**. Hermes reasons and runs tools; Nexus owns identity, authorization, and the CRM data. The only new Nexus-side state is a minimal mapping that lets Nexus decide which Hermes session or run a request may touch.

- **Web and API:** Next.js 16 App Router, React 19
- **Agent runtime:** external Hermes API server (not in this repository)
- **Persistence:** shared `DatabaseAdapter` — Prisma/PostgreSQL and Firestore
- **Authentication:** Better Auth browser sessions (`requireSessionAuth`)
- **Transport to Hermes:** server-to-server HTTP with a bearer token, ideally over loopback

Disabled by default. With no `HERMES_CAREER_OPS_*` configuration the status endpoint reports the feature unavailable and the UI trigger is never rendered.

## System boundary

```text
Browser (same-origin only)
  │ authenticated HTTPS, session cookie
  ▼
Next.js route handlers — /api/career-ops/*
  ├─ requireSessionAuth()            browser sessions only; API tokens rejected
  ├─ bounded body + per-user limit   32 KB body, 8 000-char message
  └─ ownership resolution            CareerOpsThread / CareerOpsRun by userId
  │
  ▼
lib/career-ops/service.ts   ← the single choke point
  │  fixed operation allowlist; no caller-supplied path, method or header
  ▼
lib/career-ops/hermes-client.ts ──► Hermes API server  (127.0.0.1:8642/p/career-ops)
                                      │
                                      ├─ Career Ops profile: persona, skills
                                      ├─ Nexus MCP  ──────► Nexus REST (owner-scoped)
                                      └─ web / job-source tools
```

The browser never learns the Hermes base URL, never receives the bearer token, and never opens a connection to the Hermes host. Because every request is same-origin, the existing Content-Security-Policy is unchanged.

## Request and stream sequence

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (drawer)
    participant N as Nexus API
    participant D as Nexus DB
    participant H as Hermes API server
    participant M as Nexus MCP

    B->>N: GET /api/career-ops/status
    N->>H: GET /health, GET /v1/capabilities
    H-->>N: healthy + advertised features
    N-->>B: {enabled, available, capabilities}

    B->>N: POST /api/career-ops/threads {applicationId?}
    N->>D: verifyApplicationOwner(applicationId, userId)
    N->>H: POST /api/sessions (X-Hermes-Session-Key: agent:career-ops:nexus:dm:<hmac>)
    H-->>N: {session.id}
    N->>D: createCareerOpsThread(userId, hermesSessionId, applicationId)
    N-->>B: {thread} — hermesSessionId withheld

    B->>N: POST /threads/{id}/runs {message, clientRequestId}
    N->>D: getCareerOpsThread(id, userId)
    N->>H: POST /v1/runs {input, session_id, instructions}
    H-->>N: 202 {run_id}
    N->>D: createCareerOpsRun — unique(threadId, clientRequestId)
    N-->>B: 202 {run}

    B->>N: GET /runs/{id}/events
    N->>H: GET /v1/runs/{hermesRunId}/events (SSE)
    H->>M: Nexus MCP tool calls (owner-scoped)
    M-->>H: current Nexus data
    H-->>N: data: {"event":"message.delta"|"tool.*"|"approval.request"|…}
    N-->>B: data: {"type":"delta"|"tool_started"|"approval_required"|…}

    alt approval gate
        B->>N: POST /runs/{id}/approval {choice}
        N->>D: getCareerOpsRun(id, userId)
        N->>H: POST /v1/runs/{hermesRunId}/approval
    end

    alt stream drops
        B->>N: GET /runs/{id}
        N->>H: GET /v1/runs/{hermesRunId}
        N-->>B: terminal status + final output
    end
```

## What it looks like

Desktop — the drawer opens beside the pipeline, which stays usable. Tool progress is shown as text plus an icon, never colour alone, and the live region announces run state rather than tokens.

![Career Ops drawer at desktop width, showing a streamed answer and finished tool step alongside the opportunity table](../screenshots/career-ops-desktop.png)

An approval gate: a plain-language summary, the operation, the sanitized arguments the event contract provides, and explicit approve/reject controls. Nothing is approved implicitly, and assistant text cannot approve on the user's behalf.

![Career Ops approval prompt showing the operation, sanitized details and approve/reject controls](../screenshots/career-ops-approval.png)

An application-scoped conversation opened from an opportunity. The badge names the linked company and role, and one control returns to global context.

![Career Ops opened from an opportunity, with an application-context badge and a switch back to global context](../screenshots/career-ops-application-context.png)

Mobile — a full-height sheet with a visible close control, no horizontal overflow, and touch targets at or above 44 px.

![Career Ops as a full-height sheet on a 390 px viewport](../screenshots/career-ops-mobile.png)

All screenshots use fictional demo records and a local mock Hermes; no real application, credential, or conversation data appears in them.

## Why the Runs API, and what that costs

The Hermes session chat-stream endpoint couples a turn to one HTTP response: losing the response loses the turn, and it exposes no run identifier to stop or approve. `POST /v1/runs` returns a `run_id` immediately (202) and gives a separate event stream, pollable status retained for an hour, plus `stop` and `approval` control endpoints.

The cost is that **the Hermes run event stream is single-consumer**: its handler discards the run's event queue when a subscriber disconnects, so a dropped stream cannot be resumed and the events emitted while disconnected are gone. Nexus does not paper over this. On a drop the drawer enters an explicit *reconnecting* state and settles from `GET /api/career-ops/runs/{id}`; the final answer is recovered from the run's `output`, and full history from the session's messages. Buffering the stream server-side would fix it, but only by turning Nexus into a transcript store — exactly what this design avoids.

## Idempotency

`POST /v1/runs` has no `Idempotency-Key` support (only the chat-completions and responses endpoints do), so retry safety lives in Nexus. Every run submission carries a bounded `clientRequestId` (`[A-Za-z0-9_-]{8,64}`), and `CareerOpsRun` holds a unique constraint on `(threadId, clientRequestId)`.

The order matters. Nexus **claims that pair before it contacts Hermes**, inserting a reservation with an empty upstream id; only the winner of the claim submits the run and then binds the returned `run_id` onto it. A duplicate therefore never reaches Hermes at all. Submitting first and deduplicating afterwards would let a retry start a second privileged agent run that could execute tools and mutate CRM data before a best-effort stop landed — and that stop can itself fail. If the upstream call errors, the reservation is released so a genuine retry still works.

A reservation that is not yet bound has nothing addressable upstream: status reports it as `queued`, stop is a no-op, and events and approval return a controlled conflict rather than sending an empty id to Hermes.

Firestore has no unique index, so the same guarantee is expressed as a deterministic document id derived from the pair — `create()` fails when the document exists. The adapter contract suite asserts both backends behave identically.

## Data ownership

| Concern | Owner |
| --- | --- |
| Applications, contacts, documents, events, submissions, follow-ups | **Nexus** (via Nexus MCP) |
| Agent reasoning, persona, skills, tool execution, run lifecycle | **Hermes** |
| Conversation transcript | **Hermes** (read on demand; not copied into Nexus) |
| Nexus user identity and session | **Nexus** |
| Thread → Hermes session, run → Hermes run mapping | **Nexus** |
| Application scope of a conversation | **Nexus** (`applicationId` only) |

Nexus stores no message bodies, no reasoning traces, no tool arguments, and no credentials for this feature.

## Application context

An application-scoped conversation persists only the owner-verified `applicationId`. Each run sends instructions naming that id plus a bounded company/role label, and tells the agent to retrieve current facts through the Nexus MCP tools. The job description is never sent and never duplicated into an agent-side store, so a conversation left open overnight still acts on today's record. Text stored in Nexus is explicitly framed to the agent as user data, not instructions.

## Long-term memory scope

Requests carry `X-Hermes-Session-Key: agent:career-ops:nexus:dm:<32 hex>`, where the suffix is `HMAC-SHA256(scope secret, userId)`. It is stable per user, differs between users, contains no email address or other personal identifier, and stays well inside the header's 256-character limit.

That key names a **Nexus-specific scope**. Every other channel the agent serves sends a different key, so a browser conversation neither reads nor writes those channels' memory: what the user told the agent on Telegram is not available here, and nothing said here reaches Telegram. This is a deliberate isolation boundary, and it is also the honest description of what the key does — an earlier version of this document claimed the opposite.

Continuity therefore comes from two places, neither of them cross-channel:

- **Within one conversation**, from the bounded `conversation_history` Nexus sends with each run. Hermes' Runs API does not hydrate prior turns from `session_id`, so a run that omitted the history would start from nothing.
- **Across conversations for one user**, only to the extent the Hermes profile persists anything under this scope key.

Whether the profile persists long-term memory at all, and what it keeps, is a property of the Hermes deployment. Nexus cannot determine it and does not claim it. This has not been verified against a live instance.

## Error mapping

| Upstream | Nexus | Rationale |
| --- | --- | --- |
| 401 / 403 | 503 `unavailable` | Nexus' own credential was rejected — an operator problem, not the user's |
| 404 | 404 | |
| 409 | 409 `conflict` | e.g. the run is no longer awaiting approval |
| 429 | 429 + `Retry-After` | |
| 5xx, network, timeout | 502 `upstream_error` | |

Response bodies are always Nexus-authored. Upstream text passes through `redactUpstreamError()` before it can reach a log line, and never reaches a response body.

## Related documents

- [Threat model](../security/hermes-career-ops-threat-model.md)
- [Hermes profile setup and deployment](../operations/hermes-career-ops-setup.md)
- OpenSpec change: `openspec/changes/integrate-hermes-career-ops/`

## Relationship to the AI operator console

The existing [AI operator console](./ai-operator-console.md) is unchanged and untouched. It runs a generic assistant *inside* Nexus on the user's own provider key. Career Ops runs *no* model in Nexus and adds no provider SDK or provider-key storage. The two features share no routes, tables, or components.

Career Ops is a browser-session feature and, like `/api/agent/*`, is not part of the API-token REST surface documented in `public/openapi.json`.
