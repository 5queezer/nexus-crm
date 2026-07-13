## Context

Nexus is the system of record for job opportunities, but the current model treats an application submission as a status change plus free-text notes. A submitted CV can be represented by a Reactive Resume ID or a loosely linked document, yet the exact submitted package is not immutable or queryable. MCP clients therefore perform read-modify-write note replacement and multiple calls that can partially succeed.

The application and document data layer supports Prisma/PostgreSQL and Firestore through one adapter contract. The solution must preserve backend parity, user scoping, compatibility with existing records, and safe agent operation.

## Goals / Non-Goals

**Goals:**

- Preserve exactly what was submitted and make it easy to recall for interviews.
- Make submission recording atomic, idempotent, scoped, and read-back verified.
- Separate advertised compensation from candidate expectations.
- Replace overloaded booleans/free text with structured optional metadata while retaining legacy fields.
- Make document retrieval token-efficient and lifecycle-aware.
- Add an event timeline and deterministic healthchecks.
- Make MCP create/update behavior consistent and safe under concurrent callers.

**Non-Goals:**

- Automatically submit applications to external ATS systems.
- Delete historical documents automatically.
- Store external credentials or application secrets in answers.
- Remove legacy fields in this change.
- Introduce an LLM dependency.

## Decisions

### Decision 1: ApplicationSubmission is a first-class immutable snapshot

Each submission belongs to one application and user, stores submission metadata and a JSON answer array, and references the exact submitted documents. An idempotency key is unique per user. New submissions may be recorded for legitimate reapplications, but existing submissions are never overwritten.

### Decision 2: Candidate expectation and advertised compensation remain separate

Application fields retain advertised salary data with explicit currency, period, and compensation type. Submission records store the candidate's expectation as submitted. This prevents form answers from corrupting market data.

### Decision 3: ApplicationEvent is append-only

Events record status/stage changes, note additions, submissions, contacts, follow-ups, and operational changes. Notes remain for compatibility, but MCP clients use append-note/event operations instead of replacing a large notes blob.

### Decision 4: Submitted document packages are immutable

Documents gain type, state, version, hash, source, generated/submitted timestamps, and optional submission linkage. A document linked to a submission cannot be silently reclassified as a draft or superseded without an explicit metadata update; the submission retains its material IDs.

### Decision 5: Backwards-compatible structured application metadata

`remote` remains a compatibility field. New structured fields cover work mode, countries, locations, office days, travel, sponsorship, right-to-work, timezone overlap, ATS/requisition, JD timestamps/hash/liveness, current interview stage, and normalized summary.

### Decision 6: Atomic submission recording lives in the adapter

`recordApplicationSubmission` verifies ownership and document ownership, checks idempotency, creates the submission and event, updates application status/appliedAt/follow-up, and marks submitted documents in one backend-specific atomic operation where supported. The returned result includes the application, submission, materials, and verification status.

### Decision 7: Optimistic concurrency is optional and fail-closed when supplied

Updates may include `expectedUpdatedAt`. Prisma uses a conditional update and Firestore uses a transaction. A mismatch returns a conflict rather than overwriting newer data. `dryRun` validates and returns intended changes without mutation.

### Decision 8: No arbitrary URL fetch in the initial implementation

An MCP tool that fetches arbitrary URLs would introduce SSRF, redirect, DNS rebinding, and payload risks. Token-efficient upload is provided through document metadata/filtering and existing HTTP multipart upload; a future signed-upload capability may be added behind the storage abstraction. This is a deliberate security exception to the audit's URL-upload option, not an omitted requirement.

## Risks / Trade-offs

- [Large additive schema] → Keep fields optional, retain legacy fields, and add adapter parity tests.
- [Sensitive answers] → Scope every query by user, cap lengths/counts, support a `sensitive` flag, and never expose answers through list tools unless requested.
- [Firestore transaction complexity] → Use dedicated collections and transaction/batch operations; add mock-backed parity tests.
- [Migration compatibility] → Add nullable columns/defaults, no destructive backfill, and derive `workMode` from legacy `remote` only in read paths when absent.
- [MCP route size] → Extract shared schemas/helpers and keep list tools field-selectable.
- [Idempotency collisions] → Scope keys by user and return the existing submission on exact retries.

## Migration Plan

1. Apply additive Prisma migration and regenerate the client.
2. Deploy code that tolerates absent Firestore fields and collections.
3. Existing applications remain unchanged; new creates default to inbound/no appliedAt.
4. Optionally backfill document hashes and work mode asynchronously later.
5. Rollback code safely; additive database objects may remain unused.
