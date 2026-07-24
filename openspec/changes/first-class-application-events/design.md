## Context

`ApplicationEvent` already exists in Prisma and Firestore and is exposed through append/list REST and MCP operations. It currently accepts arbitrary strings and generic metadata, updates no application projection, has no cross-application query, and is absent from the UI. Submission recording is the one mature compound transaction: it creates an immutable package and canonical event while updating application state. The new detail page provides a stable surface for an event-first experience, but its application PATCH route still silently truncates notes and mutates lifecycle fields without history.

## Goals / Non-Goals

**Goals:**

- Make lifecycle history typed, immutable, visible, owner-scoped, and queryable.
- Keep application projection and event history consistent through backend transactions.
- Provide deterministic replay, concurrency control, cursor pagination, REST/MCP parity, and Prisma/Firestore parity.
- Preserve all existing notes/events and keep submission evidence immutable.
- Give users per-application and global activity experiences without turning notes into a hidden log.

**Non-Goals:**

- Rebuild application state by replaying events or introduce full event sourcing.
- Claim existing prose or legacy event metadata is authoritative structured history.
- Replace immutable submission/document records with event metadata.
- Build compliance-grade auditing or unrestricted metadata search.
- Remove legacy application fields or existing event endpoints.

## Decisions

### Decision 1: Canonical commands sit above the shared adapter

A shared domain module owns event constants, event-specific metadata normalization, controlled validation codes, and derivation of the allowed projection patch. REST and MCP call the same parser. The adapter accepts only normalized commands.

Alternative: validate independently in each boundary. Rejected because REST/MCP behavior would drift and backend code would receive untrusted shapes.

### Decision 2: Add `recordApplicationEvent` rather than overload append-only creation

The adapter gains a compound command returning `{ event, application, replayed }`. Existing `createApplicationEvent` remains for compatibility and non-projecting legacy callers, but new lifecycle REST/MCP tools use the compound method. The submission transaction remains specialized and emits the canonical submission type.

The compound command transaction boundaries are:

- Prisma: owner-scoped transaction, application row concurrency check/update, unique event insert, and replay lookup within one transaction.
- Firestore: transaction reads the application and deterministic event document, verifies owner/concurrency/hash, then creates the event and updates the application.

Alternative: create an event and call `updateApplication` separately. Rejected because partial success recreates the consistency problem.

### Decision 3: Projection updates are derived, not arbitrary

Event metadata never contains a free-form application patch. The domain parser derives a whitelist limited to `status`, `currentStage`, `lastContact`, and `followUpAt` for the relevant event type. Before/after values are enriched from the transaction's current projection so clients cannot forge the previous state.

Alternative: accept arbitrary projection fields. Rejected because it would make event commands a second unsafe general update API.

### Decision 4: Denormalize query dimensions on events

Add nullable `contactId` and `outcome` event columns/fields derived from validated metadata. This supports equivalent filters across PostgreSQL and Firestore without backend-specific JSON query behavior. Existing events leave these fields null and remain visible in unfiltered queries.

Alternative: query JSON metadata directly. Rejected because Firestore/PostgreSQL query semantics and indexes differ.

### Decision 5: Opaque cursor is occurrence time plus event identity

Pages order by `(occurredAt, id)` in the selected direction. The cursor is a versioned base64url JSON payload and is validated centrally. Page size is bounded to 1–100. Each adapter fetches one extra matching row to decide whether to emit `nextCursor`. This avoids offset drift when new events arrive.

For Firestore, compound queries order by `occurredAt` and document identity. Required composite indexes are additive. Prisma adds owner/occurrence and application/occurrence/id indexes.

### Decision 6: Preserve old endpoints and add explicit paged surfaces

The current application-events GET/list MCP behavior remains compatible. New timeline and global activity endpoints/tools expose paged results and filters. Event POST is upgraded to the canonical compound command response. OpenAPI documents both compatibility and new contracts.

Alternative: change existing list response from an array to a page object. Rejected as an unnecessary breaking change.

### Decision 7: Server-load the first UI page, then increment client-side

The application page and new `/activity` page load the initial owner-scoped event page on the server. Reusable client components render events, change filters/order, and fetch subsequent opaque cursors. Application references are included in global results; linked resource IDs render as safe internal links only when present.

### Decision 8: Notes validation is fail-closed at every mutation boundary

Shared summary validation accepts null/empty values and rejects strings over 10,000 characters. Existing storage is untouched. UI presents a counter and warning threshold; it does not silently cut input. REST and MCP update tools call the same validation.

## Risks / Trade-offs

- [Broad cross-layer PR] → Implement and review vertical slices: domain contract, adapter transaction, query, API/MCP, then UI.
- [Existing arbitrary event producers] → Preserve reads and append compatibility while requiring canonical types only on new compound commands.
- [Firestore index deployment lag] → Commit indexes with the code and keep rollback compatible with old unpaged reads.
- [Replay after later projection changes] → Return the original immutable event plus the current projection and mark `replayed`; never reapply an old projection patch.
- [Filter combinations can require many Firestore indexes] → Use normalized dimensions and a documented primary owner/time ordering; apply secondary filters in bounded adapter scans only where Firestore cannot compose them safely.
- [Event UI leaks sensitive metadata] → Render a fixed allowlist of human-readable metadata fields and linked identifiers; never dump arbitrary JSON by default.

## Migration Plan

1. Deploy the additive Prisma migration and Firestore indexes.
2. Deploy readers that tolerate missing normalized dimensions.
3. Deploy canonical command/query APIs and MCP tools while preserving existing list/read behavior.
4. Deploy timeline/activity UI and notes guidance.
5. Do not backfill or rewrite notes/events automatically.
6. Rollback may leave additive nullable columns/indexes unused; old readers and data remain compatible.

## Open Questions

None blocking. A future explicit migration tool may let a user review and approve selected legacy-note events, but that is intentionally outside this change.
