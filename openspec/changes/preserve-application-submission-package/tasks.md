## 1. Contracts and failing tests

- [x] 1.1 Add failing tests for inbound/no-appliedAt creation defaults and create/update schema parity
- [x] 1.2 Add failing adapter contract tests for structured application metadata
- [x] 1.3 Add failing tests for submission idempotency, ownership, answer limits, exact material linkage, and atomic status/follow-up updates
- [x] 1.4 Add failing tests for append-only events, note append, optimistic concurrency, and dry-run validation
- [x] 1.5 Add failing tests for document lifecycle metadata and filtering
- [x] 1.6 Add failing tests for deterministic healthcheck findings and duplicate-safe URL lookup

## 2. Persistence and migration

- [x] 2.1 Add additive Prisma application/document fields and ApplicationSubmission/ApplicationEvent models
- [x] 2.2 Add SQL migration with indexes, ownership constraints, idempotency uniqueness, and cascading relations
- [x] 2.3 Extend shared database types and adapter interface
- [x] 2.4 Implement Prisma adapter operations and transactions
- [x] 2.5 Implement Firestore fields, collections, transactions, filters, and parity tests
- [x] 2.6 Generate Prisma client and validate schema/migration

## 3. Application metadata and lifecycle

- [x] 3.1 Default new applications to inbound and leave appliedAt null
- [x] 3.2 Add structured work, location, compensation, ATS, JD, liveness, and interview-stage metadata to create/update/batch flows
- [x] 3.3 Add append-note and application-event use cases
- [x] 3.4 Add optimistic concurrency and dry-run behavior
- [x] 3.5 Add exact canonical-job-URL lookup and duplicate-safe upsert

## 4. Submission packages

- [x] 4.1 Implement structured ApplicationSubmission and answer validation
- [x] 4.2 Implement atomic/idempotent submission recording and read-back verification
- [x] 4.3 Implement list/get submission operations with answers excluded by default from list results
- [x] 4.4 Link and mark exact submitted materials without mutating historical packages

## 5. Documents and healthchecks

- [x] 5.1 Add document type/state/version/hash/source/timestamp metadata
- [x] 5.2 Add filtered/paginated/field-selectable document listing and consistent application links on get
- [x] 5.3 Add deterministic pipeline healthcheck for next action, submission package, answers, materials, status/date consistency, and orphan documents
- [x] 5.4 Preserve rejected-application materials as historical rather than auto-deleting

## 6. MCP, REST, and documentation

- [x] 6.1 Make create/update MCP schemas symmetrical and expose structured metadata
- [x] 6.2 Add MCP tools for record/list/get submission, append note, add/list events, healthcheck, duplicate lookup/upsert, document metadata/filtering
- [x] 6.3 Add dry-run/idempotency/concurrency arguments and structured error/verification responses
- [x] 6.4 Add REST submission/event routes and document filters
- [x] 6.5 Update OpenAPI, llm.txt, README, and MCP tool documentation

## 7. Verification and delivery

- [ ] 7.1 Run Prisma validation/generation and migration checks *(schema/client validation passed; live PostgreSQL apply blocked because Docker daemon is unavailable)*
- [x] 7.2 Run the full Vitest suite and confirm new tests failed before implementation and pass afterward
- [x] 7.3 Run ESLint and production build, comparing against baseline warnings
- [x] 7.4 Run strict OpenSpec validation
- [x] 7.5 Run independent security/code review and address findings
- [ ] 7.6 Open PR, request CodeRabbit, address all actionable comments, wait for green CI, and merge *(PR #127 open; actionable Codex findings addressed; CI and GitGuardian green; merge pending)*
