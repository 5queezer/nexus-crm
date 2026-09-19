# Nexus workspace redesign delivery

Branch: `feat/nexus-workspace-assistant`.

## Changed surfaces

| Surface | Main implementation |
| --- | --- |
| Shared shell and persistent assistant | `components/app-header.tsx`, `app/providers.tsx`, `components/ai-operator/` |
| Focus/List/Stages, URL filters, selection and review | `components/dashboard.tsx`, `components/focus-queue.tsx`, `components/bulk-review-controls.tsx`, `lib/applications/workspace-url.ts` |
| Activity/Brief/Materials detail and next action | `components/application-detail.tsx`, `components/application-detail/`, `components/application-timeline.tsx`, `lib/applications/events.ts` |
| Documents and task-oriented settings | `components/documents-client.tsx`, `components/settings-client.tsx`, `components/agent-settings-section.tsx` |
| Email review and task history | `components/activity-feed.tsx`, `components/scanned-emails.tsx`, `components/bulk-task-history.tsx` |
| Event-evidence analytics | `lib/analytics/`, `app/api/analytics/`, `components/analytics-dashboard.tsx` |
| Structured assistant transport and typed context | `lib/agent/protocol.ts`, `lib/agent/run-events.ts`, `lib/agent/stream-events.ts`, `lib/assistant/`, `app/api/agent/runs/` |
| Persisted bulk plans, jobs, conflicts and undo | `lib/agent/bulk/`, `app/api/agent/bulk/`, `app/tasks/[id]/`, `components/task-workspace.tsx` |

Existing status values, contacts, Triage fields, resume submissions, storage, provider credentials and MCP policy are retained. The redesigned pages reuse their existing forms/domain APIs. One global assistant replaces dashboard-local instances. Manual and agent bulk changes share one preview/execution path.

## Migrations and startup

Apply the three additive Prisma migrations before running the updated application:

- `20260919100000_add_bulk_commands`: durable commands, immutable plans and per-item checkpoints.
- `20260919110000_add_application_next_action`: nullable next action; backfill only explicit event metadata.
- `20260919120000_repair_email_integration_tables`: idempotent repair for existing email models absent from the original migration chain.

The entire migration chain was applied successfully to a fresh isolated PostgreSQL database. No production migration was run.

`npm run build` also bundles the worker. The Docker image starts web and worker processes under a supervisor. Local development needs both `npm run dev` and `npm run bulk:worker`, using the same database. See [worker operations](operations/bulk-worker.md).

The assistant uses a validated AG-UI-compatible SSE subset without adding an SDK dependency. See [event protocol](assistant-event-protocol.md) for exact events and replay behavior.

## Verification evidence

- Full Vitest suite: 145 files / 942 tests pass. TypeScript, ESLint, production build, container build and `git diff --check` pass.
- Production container smoke: login HTTP 200; both web and durable worker processes start; graceful shutdown verified.
- Real PostgreSQL bulk verifier: 31 matching writes, wait-instruction exclusion, repeated approval/execute, stale record preservation, refreshed conflict review, strict version-checked undo, pause, partial cancellation and partial undo.
- Real storage/API/browser verifier: upload/link/rename preserve versions; owner read succeeds; anonymous/foreign access fails; share link works before revocation and fails afterward.
- Browser: preview → approval → execution → reload → undo; 320px main pages without horizontal overflow or runtime errors; 768px dark pages and detail; keyboard focus; desktop review and Focus layout.
- Calendar tests also pass with `TZ=America/Los_Angeles`.

Reproducible integration scripts: `scripts/verify-bulk-domain.ts` and `scripts/verify-document-lifecycle.mjs`. They require an isolated local test database. Visual verdict and screenshots are session QA artifacts, not production data.

## Limits and operational details

- Live external model providers, mailbox scanning and remote MCP servers were not exercised against production accounts. Provider/runtime/connector contracts are covered by tests; real credentials remain required.
- Analytics intentionally reports unknown evidence instead of inferring replies or stage history from current status. Automatic acknowledgements do not count as human replies.
- Analytics date filters and reply durations use calendar days in the requested IANA `timeZone`. The browser supplies its timezone; API and assistant callers that omit it retain the explicit UTC default.
- Bulk target budget is 10,000 matching records; resolution has explicit scan/time limits and never reports a truncated set as complete.
- Undo is conservative: any intervening record version conflicts and preserves the newer edit, even if the affected field returned to the same value.
- Model runs can reconnect while the server continues their bounded execution. A server-interrupted model run is marked interrupted; it is not silently replayed against a provider. Bulk jobs resume independently through their durable worker leases.
- Existing build notices about the development authentication secret and Turbopack file tracing are not deployment credentials. Configure the existing production environment normally.

No deployment, merge, outbound message or production-data change was performed.
