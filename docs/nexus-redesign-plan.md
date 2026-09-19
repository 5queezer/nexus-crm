# Nexus workspace implementation

Reference: `nexus-implementation-prompt.md` and `nexus-complete-prototype.html` supplied on 2026-09-19.

## Inventory and preservation

- Next 16.2.10, React 19.2.3, Tailwind 4.3, TanStack Query 5, Prisma 6, AI SDK 7, Zod 4; no AG-UI package installed. Keep dependencies unchanged and validate the compatible event wire format.
- Existing Focus/List/Stages, archive filters, optimistic status updates, demo isolation, contact CRUD, resume submissions, private documents, share-link APIs, provider credentials and MCP policy remain the integration points.
- Existing event projection and proposal version/idempotency contracts are authoritative. Preserve all status values and translated CRM terminology.
- Initial baseline: 121 test files / 822 tests pass.

## Increments

1. Persistent global assistant, restrained sidebar/breadcrumb shell, URL-aware opportunity views and explicit selection scope.
2. Readable Activity/Brief/Materials opportunity view; searchable document collection; task-oriented Settings and Activity.
3. Owner-authorized event-evidence analytics with cohort denominators and honest coverage.
4. Typed assistant context/actions and ordered persisted event transport with replay.
5. Persisted bulk preview/digest approval, atomic version checks, durable processing, pause/cancel, verified outcomes and compensating undo, shared by manual UI and agent tools.
6. Cross-page invalidation, responsive/theme/accessibility checks, full type/lint/test/build verification.

## Verification

Add focused tests for evidence semantics, owner isolation, >25 target membership, approval identity, stale changes, repeated execution and undo. Exercise the supplied prototype and inspect rendered app pages at 320px, tablet and desktop in both themes. Use isolated local test data only. Never deploy, merge or modify production data.

## Migration strategy

Add only evidence supported by explicit event metadata; do not synthesize historical human replies from statuses. Bulk/run persistence migrations are additive. Record exact migration and worker requirements in the delivery notes once contracts are integrated.
