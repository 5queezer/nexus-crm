## Why

Nexus can track an opportunity and attach files, but it cannot preserve an application submission as a first-class, immutable package. Submitted answers and candidate salary expectations are currently appended to notes, document versions have no lifecycle metadata, and MCP clients must coordinate several non-atomic calls to mark an application applied. This makes later interview recall, duplicate-safe automation, and reliable agent workflows unnecessarily difficult.

## What Changes

- Add structured application submission records with exact answers, candidate compensation expectations, submission metadata, idempotency, and immutable links to the submitted document package.
- Add application event history for submissions, notes, stage changes, contacts, follow-ups, and other lifecycle events.
- Add document type, state, version, hash, source, generation/submission timestamps, and submission linkage.
- Add structured work-model, location/eligibility, compensation, ATS/requisition, JD snapshot, liveness, and interview-stage metadata.
- Change new applications to default to `inbound` with no `appliedAt` until an explicit submission is recorded.
- Make MCP create/update schemas symmetrical and add atomic submission, note append, event, healthcheck, duplicate-safe lookup/upsert, document filtering, and metadata tools.
- Add optimistic concurrency, idempotency, dry-run validation, and verified mutation results.
- Update REST/OpenAPI/LLM documentation and both Prisma and Firestore adapters.

## Capabilities

### New Capabilities

- `application-submission-package`: Structured, immutable application submissions, answers, compensation expectations, and submitted materials.
- `application-timeline-health`: Auditable application events and deterministic pipeline/submission healthchecks.
- `document-lifecycle-metadata`: Typed, versioned, hashed, filterable document metadata with submission linkage.
- `career-application-metadata`: Structured work model, location eligibility, compensation, ATS, JD snapshot, and stage metadata.
- `mcp-career-operations`: Safe, idempotent, token-efficient MCP workflows for career application operations.

### Modified Capabilities

- None.

## Impact

- Database: additive Prisma migration and Firestore-compatible collections/fields.
- Adapter contract: new submission, event, healthcheck, document filtering, metadata, and concurrency operations.
- MCP: new tools and backwards-compatible optional fields; `create_application` default changes from applied to inbound.
- REST/docs: application and document metadata contracts, submission/event routes, OpenAPI and LLM guide.
- Existing records remain readable; legacy `remote` and salary fields remain available during migration.
