## 1. Configuration and Hermes client (RED → GREEN)

- [x] 1.1 Write failing tests for `lib/career-ops/config.ts`: disabled when unset, disabled on non-absolute/non-http base URL, trailing-slash normalization, bounded timeout parsing with defaults, and `careerOpsMemoryScope()` producing a stable non-PII scope that differs per user and stays within 256 chars with no CR/LF/NUL.
- [x] 1.2 Implement `lib/career-ops/config.ts` (server-only): `readCareerOpsConfig()`, URL validation, timeout bounds, HMAC-derived memory scope, and `redactUpstreamError()`.
- [x] 1.3 Write failing tests for `lib/career-ops/hermes-client.ts`: bearer header attached; secret absent from every thrown error and returned payload; `/health` and `/v1/capabilities` parsing including partial `features`; health unavailable and degraded; session create/get/delete; session messages; run create returning `run_id`; run status mapping; stop; approval choice mapping and `409` handling; connect/idle/total timeouts and aborted connections; upstream `401/403/404/409/429/5xx` mapped to typed `HermesError`s.
- [x] 1.4 Implement `lib/career-ops/hermes-client.ts` as a typed adapter over the verified contract, with a fixed operation allowlist, no caller-supplied paths/headers, and `AbortSignal`-based timeouts.
- [x] 1.5 Write failing tests for `lib/career-ops/sse.ts`: `data:`-only frame parsing, multi-line and chunk-split frames, `:` comment/keepalive frames, unknown `event` values ignored, malformed JSON discarded without terminating, and mapping of `message.delta`/`tool.started`/`tool.completed`/`approval.request`/`approval.responded`/`run.completed`/`run.failed`/`run.cancelled` to the normalized Nexus event shapes.
- [x] 1.6 Implement `lib/career-ops/sse.ts` (incremental parser + normalizer + serializer for the Nexus-facing stream).
- [x] 1.7 Run the focused client/config/SSE suites green.

## 2. Persistence and adapter parity (RED → GREEN)

- [x] 2.1 Add `CareerOpsThreadRecord` / `CareerOpsRunRecord` types and the Career Ops methods to `lib/db/types.ts` and `lib/db/adapter.ts`.
- [x] 2.2 Write failing adapter contract tests: create/list/get/delete thread; owner scoping on every read; deterministic `updatedAt desc, id` ordering; `(threadId, clientRequestId)` uniqueness; run status update; foreign-ID rejection; application-link cleanup; user-deletion cleanup.
- [x] 2.3 Add `CareerOpsThread` and `CareerOpsRun` to `prisma/schema.prisma` with owner indexes, the composite unique constraint, `onDelete: Cascade` from `User`, and `onDelete: SetNull` from `Application`; run `prisma format` and `prisma validate`.
- [x] 2.4 Write the additive migration `prisma/migrations/<ts>_add_career_ops_session_bridge/migration.sql` and confirm it contains no destructive statement.
- [x] 2.5 Implement the Career Ops methods in `lib/db/prisma-adapter.ts`.
- [x] 2.6 Implement the Career Ops methods in `lib/db/firestore-adapter.ts` using deterministic run document IDs for uniqueness, and extend the existing application-delete and user-cleanup paths to clear/remove Career Ops references.
- [x] 2.7 Add the Career Ops composite indexes to `firestore.indexes.json`.
- [x] 2.8 Run the adapter contract tests green on both backends.

## 3. Career Ops service layer (RED → GREEN)

- [x] 3.1 Write failing tests for `lib/career-ops/service.ts`: ownership resolution returns `null` for foreign and unknown IDs; administrators are not exempt; `readScopeUserId` is ignored; thread creation verifies application ownership; run creation deduplicates on `(threadId, clientRequestId)` including the concurrent unique-violation path; thread deletion succeeds even when the upstream session delete fails.
- [x] 3.2 Implement `lib/career-ops/service.ts` as the single choke point between routes and the Hermes client.
- [x] 3.3 Implement `lib/career-ops/instructions.ts` building the bounded application-context instruction (verified ID + truncated company/role + Nexus-MCP directive), with tests asserting the full job description is never included.
- [x] 3.4 Run the focused service suites green.

## 4. API routes (RED → GREEN)

- [x] 4.1 Write failing route tests for `GET /api/career-ops/status`: `401` unauthenticated; disabled response when unconfigured; unavailable response when Hermes health fails; capability flags reflected; no upstream authorization value in the body.
- [x] 4.2 Implement `app/api/career-ops/status/route.ts`.
- [x] 4.3 Write failing route tests for threads: `GET`/`POST /api/career-ops/threads`, `GET`/`DELETE /api/career-ops/threads/[id]`, `GET /api/career-ops/threads/[id]/messages` — `401`, invalid JSON `400`, oversized body `413`, foreign thread `404`, foreign application `404`, cross-user list isolation, disabled-integration response.
- [x] 4.4 Implement the thread routes.
- [x] 4.5 Write failing route tests for runs: `POST /api/career-ops/threads/[id]/runs` (bounded message, empty message `400`, invalid/missing `clientRequestId` `400`, duplicate `clientRequestId` yields one run), `GET /api/career-ops/runs/[id]`, `GET /api/career-ops/runs/[id]/events`, `POST /api/career-ops/runs/[id]/stop`, `POST /api/career-ops/runs/[id]/approval` — including foreign-run `404` on every one, invalid approval choice `400`, and unsupported-capability handling for stop/approval.
- [x] 4.6 Implement the run routes, including the normalized SSE re-emitter and the upstream→Nexus status mapping from design D9.
- [x] 4.7 Add rate limiting consistent with the existing middleware helper to the run-creating routes, with a test for the limited response.
- [x] 4.8 Run the focused route suites green.

## 5. Career Ops UI (RED → GREEN)

- [x] 5.1 Add the English and German `career_ops` message catalogs and a test asserting key parity.
- [x] 5.2 Write failing component tests for `components/career-ops/career-ops-drawer.tsx`: open/close, focus trap and restoration, Escape behavior, mobile sheet state, thread create/switch/delete, send and stream, tool progress rendering, stop, approval approve/reject, disabled/unconfigured state, connection failure and retry, ARIA labelling, and non-color status encoding.
- [x] 5.3 Implement `components/career-ops/types.ts` and the streaming client hook (`use-career-ops-run.ts`) with duplicate-submit locking, client request ID generation, and poll-based reconnection.
- [x] 5.4 Implement the drawer, thread list, message list, composer, tool/run progress, stop control, and approval prompt using the existing Tailwind/Lucide design language.
- [x] 5.5 Write a failing test asserting application queries are invalidated after an approved run completes; implement the invalidation.
- [x] 5.6 Mount the global trigger in `components/dashboard.tsx` and the application-scoped trigger in `components/application-detail.tsx`, gated on the status endpoint; add tests for global vs application context and for returning to global context.
- [x] 5.7 Run the focused UI suites green.

## 6. Documentation and developer tooling

- [x] 6.1 Add the `HERMES_CAREER_OPS_*` entries to `.env.example` with safe defaults and no real credentials.
- [x] 6.2 Add `docs/architecture/hermes-career-ops.md` with the trust boundary and a request/stream sequence diagram.
- [x] 6.3 Add `docs/security/hermes-career-ops-threat-model.md` covering bearer-token disclosure, cross-user session access, malicious job descriptions and MCP output, prompt injection, forged run/session IDs, SSE disconnection/replay, approval spoofing, upstream Hermes compromise, and over-privileged profiles.
- [x] 6.4 Add `docs/operations/hermes-career-ops-setup.md`: Hermes `career-ops` profile creation, API server enablement, distinct API key, Nexus MCP wiring, loopback/private binding, and `/health` + `/v1/capabilities` verification.
- [x] 6.5 Add a mock Hermes server (`scripts/mock-hermes.mjs`) plus local-development and production-like smoke-test instructions.
- [x] 6.6 Document the Hetzner/systemd deployment steps and the rollback procedure.

## 7. Verification gates

- [x] 7.1 `npx -y @fission-ai/openspec@latest validate integrate-hermes-career-ops --strict`
- [x] 7.2 Targeted new test suites pass.
- [x] 7.3 `npm test` (full suite) passes.
- [x] 7.4 `npm run lint` passes.
- [x] 7.5 `npm run build` passes.
- [x] 7.6 `npx prisma generate` and migration validation pass.
- [x] 7.7 Secret scan over the diff, `git diff --check`, and `git status --short` are clean.
- [x] 7.8 Production-like smoke test against the mock Hermes server, with desktop and mobile browser verification and screenshots.

## 8. Review hardening (RED → GREEN)

Everything below was added during review, each with a test verified to fail
against the code it replaced.

- [x] 8.1 Move the one-active-run invariant into the database: a Postgres partial unique index and a deterministic Firestore document id, claimed before Hermes is contacted, so a lost response resolves to the same run instead of a second one.
- [x] 8.2 Bind the idempotency key to the request it was claimed for (`requestHash`), so a reused id with edited text is refused rather than answering the earlier question.
- [x] 8.3 Bind an approval decision to the disclosed action with a signed, single-use, TTL-bounded challenge minted where the sanitized prompt is shown; grants are single-use only.
- [x] 8.4 Give the approval gate its own column, claimed by one conditional write for grants and denials alike, with recovery when polling is the first observer — including on a run that has never had a decision.
- [x] 8.5 Strip credentials from every string taken from an upstream frame, redacting before bounding, with a boundary-aware redactor that never cuts inside a credential shape.
- [x] 8.6 Send bounded `conversation_history` with each run: the Runs API does not hydrate prior turns from `session_id`.
- [x] 8.7 Require `HERMES_CAREER_OPS_OWNER_USER_ID` and fail closed for anyone else, because the Hermes profile holds one Nexus MCP token and every run acts as its owner.
- [x] 8.8 Never free a run's active slot on a Nexus-local timeout; expire only an unbindable reservation, as `abandoned`.
- [x] 8.9 Treat every "check, then act" in this subsystem as a race: run admission, thread deletion, session uniqueness, challenge consumption, gate claiming and gate opening are each decided by an index, a foreign key, a transaction, a conditional write, or a row lock.
- [x] 8.10 Record an interrupted Firestore child cleanup durably so a later operation finishes it.
- [x] 8.11 Re-read a transcript whose conversation settled after it was taken; never present a conversation whose run state could not be read as idle.
- [x] 8.12 Leave an event stream that reports it cannot deliver the outcome, and settle from run status; poll from the start on a Hermes that serves no event stream.
- [x] 8.13 Adopt a refreshed server record on the application detail page, including the form's concurrency token, without discarding unsaved edits.
- [x] 8.14 Correct the documentation this change shipped with: cross-channel memory, the Hermes MCP configuration format, the required capability set, and one deployment topology.
- [x] 8.15 Correct every test double found agreeing with broken code — SQL `NOT IN` null semantics, Firestore write isolation, batch limits and failures, abort signals, query limits.
- [x] 8.16 Offer denial only for an approval prompt that discloses no operation, summary or details, and say so in the drawer.
- [x] 8.17 Report from the adapters whether a guarded gate open actually happened, and never reinstate a released gate on a settled run.
- [x] 8.18 Keep the status entry point and its retry reachable after a failed read, and normalize the status shape on both read paths.
- [x] 8.19 Take the creation lock for the drawer's automatic first conversation, not only for direct clicks.
- [x] 8.20 Compare the transcript snapshot and the run settle time on one clock, both server-issued.
- [x] 8.21 Resume an interrupted Firestore run cleanup from an ordinary listing, not only from the next deletion.
- [x] 8.22 Make an approval outcome a conditional transition on the challenge it was claimed for, so a late outcome cannot overwrite the next gate's audit or resolve its pending state.
- [x] 8.23 Judge approval disclosure on what survives redaction, so a prompt made entirely of credentials is denial-only rather than appearing disclosed.
- [x] 8.24 Clear the unknown-run lock when another conversation is selected or created, since it describes the one being left.
- [x] 8.25 Report a forgotten run as gone only once Nexus has recorded it terminal, so a conclusive 404 never contradicts an active row.
