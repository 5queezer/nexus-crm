## Why

New users currently enter an empty CRM without a quick way to understand the application and event workflow. A removable demo workspace provides guided, realistic exploration without contaminating real user data, analytics, or MCP automation.

## What Changes

- Add an optional onboarding action that creates a versioned set of clearly marked fictional applications and lifecycle events for the authenticated user only.
- Persist demo workspace identity and demo markers explicitly and equivalently in Prisma/PostgreSQL and Firestore.
- Make creation concurrency-safe and idempotent, and allow creation only while the user has no real applications.
- Exclude demo applications and their child data from regular statistics, public sharing, MCP reads, and MCP mutations.
- Add an authenticated, owner-scoped action that completely removes only the current user's demo workspace and all of its generated data; repeated deletion remains safe.
- Harden `prisma/seed.ts`: require an explicit user, reject production, remove every global/arbitrary-user operation, and reuse the same provider-neutral demo workspace lifecycle.
- Add tenant-isolation, replay/idempotency, MCP visibility, backend-parity, and safe-deletion regression tests.

## Capabilities

### New Capabilities

- `demo-workspace-lifecycle`: Versioned, tenant-scoped creation, visibility, idempotency, and complete deletion of fictional demo applications and events across Prisma and Firestore.
- `demo-workspace-onboarding`: Optional onboarding and empty-state controls, clear visual demo labeling, statistics exclusion, and safe removal.
- `demo-data-boundaries`: Demo-data exclusion from MCP, agent, public-share, and regular analytics surfaces, including read-before-write authorization.
- `safe-development-seeding`: Production-blocked, explicit-user, provider-neutral seeding without global deletion or arbitrary tenant selection.

### Modified Capabilities

_None; this repository currently has no baseline specs under `openspec/specs/`._

## Impact

- **Persistence:** `prisma/schema.prisma`, an additive Prisma migration, `lib/db/types.ts`, `lib/db/adapter.ts`, and both database adapters.
- **API/security:** a new authenticated `/api/demo-workspace` route plus demo-aware MCP and public-share access paths.
- **UI:** onboarding, empty-state, dashboard/action menu, application presentation, analytics calculations, and English/German messages.
- **Operations:** `prisma/seed.ts` becomes explicit, non-production, provider-neutral, and non-destructive.
- **Tests:** adapter contract coverage, Firestore/Prisma lifecycle tests, route/MCP tests, and focused UI/statistics tests.
