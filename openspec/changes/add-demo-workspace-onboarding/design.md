## Context

Nexus CRM exposes a shared `DatabaseAdapter` through Prisma/PostgreSQL and Firestore. The normal application list powers dashboard views, analytics, public sharing, MCP, and the internal agent, so inserting ordinary sample rows would contaminate metrics and automation. The current `prisma/seed.ts` is unsafe because it chooses an arbitrary user and globally deletes applications.

## Goals / Non-Goals

**Goals:**
- Give an authenticated user with no real applications an optional, realistic demo workspace.
- Make demo identity explicit, versioned, owner-scoped, backend-equivalent, idempotent, and concurrency-safe.
- Keep demos visible and clearly labeled in the interactive CRM while excluding them from real analytics and machine/public interfaces.
- Remove all generated demo applications/events without touching real or foreign-tenant data.
- Reuse the lifecycle from a production-blocked, explicit-user seed CLI.

**Non-Goals:**
- Create demo documents, submissions, contacts, credentials, email integrations, or external files.
- Convert Application into an event-sourced aggregate.
- Migrate or classify existing applications as demos from names, notes, URLs, or sources.
- Expose demo creation through MCP or general application-create payloads.

## Decisions

### 1. First-class workspace plus explicit row markers

Add `DemoWorkspace` keyed uniquely by `userId`, with `seedVersion` and lifecycle state. Add `isDemo`, `demoWorkspaceId`, and stable `demoKey` to applications and events. Database constraints require all-or-none demo markers, and workspace deletion cascades in Prisma.

**Why:** A workspace is a lockable idempotency boundary; explicit row markers make query exclusion, UI labeling, and safe cleanup auditable. Names or `source` strings are unsafe because genuine data can collide.

**Alternative rejected:** only a nullable marker on Application. It cannot reliably represent in-progress/replayed lifecycle state or lock concurrent creates.

### 2. Provider-neutral fixture contract, adapter-owned atomic lifecycle

`lib/demo-workspace/fixtures.ts` defines a small versioned set of fictional applications and coherent events using stable keys and dates relative to creation. `DatabaseAdapter.ensureDemoWorkspace(userId, fixtures)` and `deleteDemoWorkspace(userId)` own persistence semantics.

Prisma uses one transaction and a user-row/workspace lock. Firestore uses deterministic owner-derived document IDs and a transaction/batch lifecycle. Both reject first creation when a non-demo application exists and return replay results for repeated calls.

**Why:** Ordinary create APIs intentionally cannot set demo markers. Adapter-owned methods can enforce backend-specific atomicity without exposing privileged fields.

### 3. Demo visibility is explicit at read boundaries

Application and event reads accept `demoVisibility: "include" | "exclude" | "only"`, defaulting to `include` for the authenticated CRM UI. MCP, agent, and public-share paths always pass `exclude`; direct lookups and read-before-write paths return not-found for demo targets. Event pagination filters at the persistence layer so limits and cursors describe only visible rows.

**Why:** Post-filtering pages gives incorrect totals/cursors and can leak demos through detail or mutation paths. Explicit visibility is clearer than route-specific array filtering.

### 4. UI separates demos from real metrics

The onboarding wizard and true-empty state can call `POST /api/demo-workspace`. The dashboard shows a demo banner and visual badges, and exposes a confirmed `DELETE /api/demo-workspace` action. Dashboard and analytics derive metrics from `applications.filter(!isDemo)` while normal table/Kanban/detail views continue displaying marked demos.

**Why:** Users need to explore the workflow, but sample rows must not look like or count as real pipeline performance.

### 5. Seed CLI is a guarded lifecycle client

`prisma/seed.ts` rejects `NODE_ENV=production` and production deployment markers, then requires `DEMO_SEED_ENABLED` to equal the exact string `true` and requires `DEMO_SEED_USER_ID`, all before resolving the configured adapter. Only after those guards pass does it call `ensureDemoWorkspace`. Missing or non-`true` opt-in values fail closed. It performs no deletion and never chooses the first user. Failures set a non-zero exit code.

**Why:** The seed command becomes an explicit development convenience instead of a destructive database initializer.

## Risks / Trade-offs

- **[Firestore legacy documents lack `isDemo`]** → Map absence to false and ensure exclusion queries/scans preserve correct logical pagination; add required composite indexes where query shapes permit.
- **[Concurrent real and demo creation]** → Prisma locks the user boundary; Firestore uses a workspace transaction and deterministic IDs. API rechecks for real rows and fails closed.
- **[New MCP call site forgets exclusion]** → Centralize an `MCP_DEMO_VISIBILITY` option and add transport tests for list, detail, event, canonical-URL, package, and mutation paths.
- **[Partial Firestore deletion]** → Persist `deleting` state, reuse retryable application cascade, re-query by `userId + workspaceId + isDemo`, verify no remnants, then remove workspace. Retrying resumes safely.
- **[Migration rollback leaves marked rows]** → Roll back application code before dropping schema. The migration is additive; old code ignores new columns. Do not drop columns until demo rows/workspaces are removed.

## Migration Plan

1. Deploy the additive Prisma migration and regenerate the client.
2. Deploy code that treats missing Firestore demo markers as real (`false`) and writes explicit markers for new demos.
3. Add/update Firestore indexes required by demo-aware query paths.
4. Deploy API/UI/MCP changes.
5. Validate Prisma and Firestore adapter contract tests, then run lint, full tests, typecheck, and production build.
6. Rollback: disable UI/API creation, delete demo workspaces through the lifecycle endpoint if desired, roll back application code, and retain additive columns/table until a later cleanup migration.

## Open Questions

None blocking. Version 1 intentionally contains only applications and events so complete deletion has no external-file or historical-submission retention ambiguity.
