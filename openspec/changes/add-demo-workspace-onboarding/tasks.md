## 1. Persistence contract (RED → GREEN)

- [x] 1.1 Add failing fixture-contract tests for stable unique keys, coherent fictional labels/events, bounded counts, and valid dates/statuses.
- [x] 1.2 Implement the provider-neutral versioned demo fixture module until fixture tests pass.
- [x] 1.3 Add failing shared adapter contract tests for owner isolation, empty-CRM eligibility, repeated/concurrent creation, visibility modes, and repeated safe deletion.
- [x] 1.4 Add Prisma schema fields, `DemoWorkspace`, constraints/indexes, and an additive migration; regenerate Prisma Client.
- [x] 1.5 Extend database record/filter/result types and `DatabaseAdapter` with explicit demo visibility and lifecycle methods.
- [x] 1.6 Implement atomic Prisma create/replay/delete and visibility predicates; prove focused Prisma tests pass.
- [x] 1.7 Implement deterministic Firestore create/replay and retryable owner/workspace-scoped deletion, including legacy missing-marker handling and logical pagination; prove focused Firestore tests pass.

## 2. API and security boundaries (RED → GREEN)

- [x] 2.1 Add failing `/api/demo-workspace` route tests for authentication, use of `auth.userId`, conflict on real data, replay, and deletion isolation.
- [x] 2.2 Implement authenticated POST/DELETE lifecycle endpoints with controlled errors and cache-safe responses.
- [x] 2.3 Add failing MCP transport tests covering demo exclusion from list/detail/filtered/canonical URL/events/activity/packages/health and rejection of demo-targeted mutations.
- [x] 2.4 Apply `demoVisibility: "exclude"` consistently to MCP and internal-agent list, detail, nested, read-before-write, and canonical-URL paths; prove focused tests pass.
- [x] 2.5 Add failing public-share tests and exclude demo applications before disclosure and share statistics.

## 3. Onboarding and presentation (RED → GREEN)

- [x] 3.1 Add failing onboarding tests for optional demo creation, pending state, localized failure, query invalidation, and completion.
- [x] 3.2 Implement the onboarding and true-empty demo actions using a dashboard-owned mutation.
- [x] 3.3 Add failing UI/statistics tests proving demo-only metrics are zero, mixed metrics count only real data, and demo removal preserves real rows.
- [x] 3.4 Add localized demo banner/badges and confirmed removal control; display markers in focus, table, Kanban, and application detail surfaces.
- [x] 3.5 Filter demo rows from dashboard/analytics calculations while keeping them browsable, and add English/German translations.

## 4. Safe seed command (RED → GREEN)

- [x] 4.1 Add failing tests for production rejection, required explicit user ID, no global deletion/arbitrary user selection, adapter selection, replay, and non-zero failures.
- [x] 4.2 Replace `prisma/seed.ts` with a guarded provider-neutral demo lifecycle client and verify it contains no global delete operation.

## 5. Verification and delivery

- [x] 5.1 Run focused tenant-isolation, idempotency, deletion, MCP, seed, and UI tests and record real output.
- [x] 5.2 Run `npm run lint`, full `npm test`, `npx tsc --noEmit`, and `npm run build`; fix every introduced failure.
- [x] 5.3 Run `openspec validate add-demo-workspace-onboarding --strict` and reconcile every task checkbox with repository state.
- [x] 5.4 Review the final diff for cross-tenant, fail-open, migration, seed, pagination, and unrelated-change risks.
- [ ] 5.5 Commit conventionally, push `feat/demo-workspace-onboarding`, open a detailed PR, verify base/head/files, and monitor CI without merging.
