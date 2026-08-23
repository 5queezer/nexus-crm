## Why

Nexus is the system of record for applications, contacts, documents, events, submissions, and follow-ups, but the Hermes "Career Ops" agent that actually works that pipeline is only reachable through Telegram. Authenticated Nexus users have no in-product way to talk to the same agent, with the same persona, skills and Nexus MCP access, while looking at the pipeline the conversation is about.

The existing in-process AI operator (`ai_operator`) solves a different problem: it runs a generic assistant inside Nexus using the user's own OpenAI/Anthropic key. It cannot reach Hermes' Career Ops profile, skills, job-source access, or approval gates, and duplicating those inside Nexus would mean running a second agent runtime. Bridging to the Hermes API server instead keeps exactly one agent runtime and one system of record.

## What Changes

- Add a server-only, capability-negotiated Hermes API client (`lib/career-ops/`) that talks to a configured Hermes profile over a private server-to-server connection with a bearer token that never reaches the browser.
- Add Nexus-owned Career Ops thread and run mappings so Nexus, not the caller, decides which Hermes session or run a request may touch. Hermes remains the owner of the transcript, tools, reasoning, and run lifecycle.
- Add an authenticated Nexus BFF under `/api/career-ops/*` (status, threads, thread messages, run start, run status, run events, stop, approval) that resolves every Hermes identifier from an owner-scoped mapping before proxying, with no generic pass-through proxy route.
- Add a responsive Career Ops drawer to the Nexus workspace: thread switcher, streaming assistant output, visible tool and run progress, stop control, approval prompts, application-context badge, and honest disabled/unavailable/reconnecting/error/empty states.
- Add optional application-scoped Career Ops threads. Nexus stores only the `applicationId` relationship and passes the verified ID to Hermes as run instructions; Hermes reads current application facts through Nexus MCP rather than from a duplicated snapshot.
- Add stable long-term memory scoping via `X-Hermes-Session-Key: agent:career-ops:nexus:dm:<opaque-user-id>` so a user's browser conversations share one memory scope, stable across runs, without exposing PII. The scope is Nexus-specific: it is deliberately separate from Telegram's, so no channel reads or writes another's memory or transcript.
- Add server-side deduplication of run creation keyed by a bounded client request ID, because the verified Hermes `POST /v1/runs` contract has no request-level idempotency.
- Add English and German translations, architecture and threat-model documentation, Hermes profile setup and deployment/rollback runbooks, and a mock Hermes server for local development and CI.
- The feature is **disabled by default**: with no `HERMES_CAREER_OPS_*` configuration the API reports a controlled unavailable status and the UI trigger is not rendered.
- No breaking changes. The existing `ai_operator` console, its routes, and its data model are untouched.

## Capabilities

### New Capabilities

- `hermes-career-ops-chat`: Authenticated browser access to the Hermes Career Ops agent — availability/capability status, thread lifecycle, bounded message submission, streamed assistant output and tool progress, reconnection, stop, and the disabled/unavailable/error states that go with them.
- `hermes-session-bridge`: Nexus-owned mapping between the authenticated Nexus user and Hermes sessions/runs, including ownership resolution, forged-identifier rejection, run-creation deduplication, backend parity across Prisma and Firestore, and cleanup on deletion.
- `hermes-human-approvals`: Capability-gated surfacing and resolution of Hermes approval gates through an authenticated, ownership-checked Nexus endpoint, with sanitized operation summaries and an honest limitation state when the connected Hermes does not support approvals.
- `career-ops-application-context`: Optional application-scoped Career Ops conversations that persist only the owner-verified `applicationId`, present the selected company and role, instruct Hermes to read live data through Nexus MCP, and allow returning to global context.

### Modified Capabilities

_None. This repository has no baseline specs under `openspec/specs/`, and no existing change's requirements are altered._

## Impact

- **Persistence:** `prisma/schema.prisma` (`CareerOpsThread`, `CareerOpsRun`), one additive migration, `lib/db/types.ts`, `lib/db/adapter.ts`, `lib/db/prisma-adapter.ts`, `lib/db/firestore-adapter.ts`, `firestore.indexes.json`.
- **Server:** new `lib/career-ops/` (config, typed Hermes client, SSE parsing, capability negotiation, thread/run service) and new `app/api/career-ops/*` routes using `requireSessionAuth()` and the existing bounded-body and rate-limit helpers.
- **UI:** new `components/career-ops/` drawer plus mount points in `components/dashboard.tsx` and `components/application-detail.tsx`; `messages/en.json` and `messages/de.json`.
- **Configuration:** server-only `HERMES_CAREER_OPS_*` variables documented in `.env.example`; no `NEXT_PUBLIC_` exposure; no CSP relaxation (all Hermes traffic is server-to-server).
- **Dependencies:** none added. No OpenAI/Anthropic SDK, provider credential, or second LLM runtime is introduced for this feature.
- **MCP/REST compatibility:** unchanged. Career Ops reads and writes Nexus data only through the existing authenticated Nexus MCP server, so application/contact/document/event semantics are not duplicated.
- **Tests:** Hermes client unit tests, adapter contract/parity tests, route authorization and tenant-isolation tests, and Career Ops UI tests, all against a mocked Hermes with no live model provider in CI.
