## Why

Nexus already stores immutable `ApplicationEvent` rows, but event creation is an untyped append operation that is disconnected from application projection updates and invisible in the product UI. As a result, mutable notes still act as a fragile timeline, direct state changes can drift from history, and neither users nor agents can query a reliable cross-application activity stream.

## What Changes

- Define canonical application event types with bounded, event-specific metadata and controlled validation errors shared by REST and MCP.
- Add an atomic event command that appends an immutable event and updates the owning `Application` projection in one Prisma or Firestore transaction, with deterministic replay/conflict behavior.
- Route lifecycle operations for stage changes, interview scheduling/completion, follow-ups, rejections, and submissions through atomic event-plus-projection writes.
- Add cursor-paginated, owner-scoped application and global event queries with filters for time, type, application, source, actor, contact, and outcome.
- Add a per-application timeline that distinguishes occurrence from ingestion time and renders structured links/metadata.
- Add a global activity page with filter controls and incremental loading.
- Reframe `notes` as a current summary, show an explicit 10,000-character counter/warning, and reject oversized values rather than silently truncating them.
- Preserve legacy notes and events without destructive parsing or inferred historical claims.
- Update OpenAPI, MCP schemas, Prisma indexes/migration, Firestore indexes, localization, and parity tests.

## Capabilities

### New Capabilities

- `application-event-commands`: Canonical event taxonomy, metadata validation, and atomic event-plus-projection lifecycle commands.
- `application-event-queries`: Owner-scoped per-application and global activity queries with deterministic cursor pagination and filters.
- `application-timeline-experience`: Application timeline, global activity UI, and notes-as-summary guidance/limits.

### Modified Capabilities

None.

## Impact

- Data contracts and adapters: `lib/db/types.ts`, `lib/db/adapter.ts`, Prisma and Firestore adapters.
- Persistence: additive Prisma/Firestore indexes; no destructive data migration.
- Domain validation: shared application-event command and metadata helpers.
- APIs: application event routes, a global events route, application update behavior, MCP tools, and `public/openapi.json`.
- UI: application detail page, new activity page, header navigation, reusable timeline components, and English/German messages.
- Tests: domain validation, REST routes, adapter parity/transactions, MCP contract parity, timeline/activity rendering, note limits, OpenAPI, TypeScript, lint, and production build.
