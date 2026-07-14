## Context

Nexus already records immutable application submissions through one adapter contract implemented by Prisma/PostgreSQL and Firestore. The trusted compound-write boundary currently validates ownership, document state, idempotency, and optimistic concurrency, but it does not enforce the application-integrity workflow: human review, stable identity, factual verification, profile comparison status, package completeness, same-company conflicts, or repeat/requisition duplicates.

The feature must remain caller-provider-neutral and must not attempt to automate external ATS submissions or infer whether prose was AI-generated. It enforces explicit assertions and Nexus-observable conflicts only.

## Goals / Non-Goals

**Goals:**

- Make the safest pre-submit rules impossible to accidentally skip through REST or MCP.
- Persist what was attested and why an override was allowed.
- Apply identical behavior to Prisma and Firestore.
- Keep exact retries idempotent and dry-runs mutation-free.
- Return stable machine-readable errors for agent and UI handling.

**Non-Goals:**

- Submit to LinkedIn or an ATS.
- Bypass CAPTCHA, rate limits, fraud controls, or platform terms.
- Detect AI-authored prose.
- Automatically inspect a private LinkedIn profile.
- Prove that an attestation is true; the caller/user remains responsible for the assertion.
- Ban legitimate employer-requested resubmissions or recruiter-directed same-company applications.

## Decisions

### Decision 1: Persist a structured policy snapshot on each submission

Add a `policy` JSON field to `ApplicationSubmission` and an equivalent Firestore map. The normalized shape contains:

- `humanReviewed: true`
- `identityConsistent: true`
- `factsVerified: true`
- `profileConsistencyStatus: "verified" | "unavailable_reviewed"`
- `confirmedNoAnswers: boolean`
- optional `sameCompanyOverrideReason`
- optional `resubmissionReason`

This is preferable to burying assertions in free-text answers because the gate is queryable, immutable with the submission, and backend-neutral. Existing records map a missing policy to an empty legacy object.

### Decision 2: Validate policy in a pure helper, enforce conflicts in adapters

A pure `validateSubmissionPolicy` helper normalizes strings and validates mandatory attestations, answers, and document count. REST and MCP validate transport-level fields and answers but pass the policy through to the adapters so an existing idempotency record can be resolved before new-submission policy errors. Both adapters invoke the pure helper before any new write.

Conflict checks that depend on stored state run inside each adapter's atomic submission boundary after the idempotent replay check and before any write:

- existing submission for the current application,
- owner-scoped applications at the same normalized company,
- matching requisition IDs.

This prevents REST/MCP drift and closes race windows around the actual write. PostgreSQL locks the owner's application rows in deterministic ID order before reading conflicts so concurrent submissions for two different same-company records serialize instead of both observing `inbound`. Firestore reads the owner application set inside the transaction, allowing optimistic transaction retries to re-evaluate the conflict after a concurrent status change.

### Decision 3: Overrides require a reason and remain narrow

`sameCompanyOverrideReason` only bypasses the active same-company check. `resubmissionReason` only bypasses an existing submission or duplicate-requisition check. Neither bypasses ownership, document lifecycle, policy attestations, or package completeness.

Reasons are trimmed, bounded, included in the idempotency request hash, stored in the policy snapshot, and copied to event metadata for operational visibility.

### Decision 4: Preserve exact replay semantics

The adapter computes raw and normalized hash candidates, checks for an existing idempotency record before surfacing policy-validation failures, and checks again inside the transactional lock boundary. An exact replay returns the original result even if the pipeline changed afterward. Pre-policy submissions retain exact legacy replay compatibility, including the former REST representation of omitted ATS metadata and the former REST document coercion/stringification/truncation. The route therefore preserves raw document input until the adapter replay lookup; strict document validation applies immediately afterward to every new write. Reusing the key with a different policy or payload remains an `idempotency_conflict`.

### Decision 5: Do not block generic application status editing in this slice

Existing imports and historical cleanup can legitimately update statuses without representing a new external submission. This change hardens the authoritative `recordApplicationSubmission` boundary first. Pipeline health continues to flag active records that lack a package. A later change may add origin-aware status-transition restrictions after migration impact is measured.

## Risks / Trade-offs

- [Attestations can be dishonest] → Persist them for accountability and keep automatic checks for duplicates/conflicts; do not claim Nexus verified external facts.
- [Stricter package rules break legacy callers] → Make the contract change explicit, update REST/MCP schemas together, support `confirmedNoAnswers`, and keep historical records readable.
- [Firestore query cost inside transactions] → Query only owner-scoped applications/submissions at submission time; this is a low-volume, high-value operation.
- [Company spelling variations evade matching] → Normalize case and whitespace now; defer legal-entity/alias resolution to a future capability.
- [Requisition IDs may collide across ATSs] → Require same normalized company and treat mismatching non-empty ATS names as different namespaces.
- [Additive Prisma migration] → Use a JSON default for existing rows and tolerate absent Firestore fields.

## Migration Plan

1. Add an additive `policy JSONB NOT NULL DEFAULT '{}'` column and regenerate Prisma.
2. Deploy code that maps absent/empty policy values for legacy Prisma and Firestore submissions.
3. Update REST and MCP callers to send mandatory policy input for new submissions.
4. Existing submissions remain valid and readable without backfill.
5. Rollback can leave the additive column unused; no destructive migration is required.

## Open Questions

None for the initial slice. A configurable per-user policy registry and origin-aware generic status-transition enforcement are follow-up candidates.
