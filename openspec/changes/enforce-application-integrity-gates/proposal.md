## Why

Nexus can atomically preserve an application submission, but it still accepts incomplete or policy-unsafe packages and relies on the caller to remember anti-spam, identity-consistency, duplicate, and same-company rules. These safeguards need to live at the trusted submission boundary so every REST, MCP, Prisma, and Firestore path behaves consistently.

## What Changes

- Require an explicit, persisted submission-policy attestation covering human review, stable identity, factual verification, and LinkedIn/profile comparison status.
- Require at least one submitted document and either exact answers or an explicit confirmation that the form contained no answers.
- Reject repeat submissions to the same application unless a documented resubmission reason is provided.
- Reject simultaneous active submissions to another role at the same company unless a documented recruiter/user override is provided.
- Reject a duplicate ATS requisition stored on another application unless a documented resubmission reason is provided.
- Run all policy and conflict checks in dry-run mode without writes and preserve approved attestations/override reasons in the immutable submission record and event metadata.
- Keep exact idempotent replays valid; safeguards apply only before a new submission is created.

## Capabilities

### New Capabilities
- `application-integrity-gates`: Server-enforced submission attestations, package completeness, duplicate/reapplication controls, same-company conflict controls, and auditable overrides.

### Modified Capabilities

None. The existing submission package remains immutable and idempotent; this change adds a policy gate before creating a new package.

## Impact

- Shared submission types and policy validation helpers.
- Prisma `ApplicationSubmission` schema and additive migration.
- Firestore submission documents and both database adapter implementations.
- REST and MCP submission contracts and controlled error codes.
- Unit, adapter-parity, dry-run, idempotency, and conflict tests.
- OpenAPI/MCP-facing descriptions where generated from route schemas.
