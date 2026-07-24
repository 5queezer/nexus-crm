## 1. Domain contract

- [x] 1.1 RED: add tests for canonical event types, event-specific metadata normalization, projection derivation, bounded metadata, and controlled errors
- [x] 1.2 GREEN: implement the shared application-event domain module and notes-summary validator
- [x] 1.3 RED/GREEN: add cursor/filter normalization tests and implement deterministic opaque event cursors

## 2. Persistence and atomic commands

- [x] 2.1 RED: add Prisma command tests for ownership, projection consistency, exact replay, conflicting replay, stale concurrency, and rollback
- [x] 2.2 GREEN: extend shared types/adapter and implement the atomic Prisma event command
- [x] 2.3 RED: add Firestore parity tests for the same command and transaction behavior
- [x] 2.4 GREEN: implement the atomic Firestore event command and verify parity
- [x] 2.5 Add normalized event query dimensions plus additive Prisma migration and Firestore indexes

## 3. Event queries

- [x] 3.1 RED: add adapter tests for deterministic per-application pagination, equal timestamps, global owner scoping, filters, and both sort orders
- [x] 3.2 GREEN: implement paged event queries in Prisma and Firestore
- [x] 3.3 RED/GREEN: add REST tests and implement per-application timeline and global activity endpoints
- [x] 3.4 RED/GREEN: add MCP contract tests and implement equivalent command/timeline/activity tools
- [x] 3.5 Update OpenAPI schemas/operations and runtime parity tests

## 4. Event-first user experience

- [x] 4.1 RED: add component tests for event rendering, legacy fallbacks, order switching, incremental loading, filters, empty/error states, and links
- [x] 4.2 GREEN: implement reusable event timeline/activity components with cursor-loaded initial pages
- [x] 4.3 Add the global `/activity` page and desktop/mobile navigation entry
- [x] 4.4 RED/GREEN: add notes counter/warning tests, relabel notes as Summary, and reject oversized summaries without truncation
- [x] 4.5 Add complete English/German timeline, activity, filter, and summary messages

## 5. Verification and delivery

- [x] 5.1 Run focused tests after each RED-GREEN slice and the complete Vitest suite
- [x] 5.2 Run Prisma validation/generation, TypeScript, lint, production build, OpenAPI validation, and strict OpenSpec validation
- [x] 5.3 Complete independent security/spec/code review and resolve every blocking finding
- [x] 5.4 Commit, push, open a PR that closes #153, and verify GitHub CI
