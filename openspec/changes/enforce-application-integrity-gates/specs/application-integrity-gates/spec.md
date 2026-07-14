## ADDED Requirements

### Requirement: Explicit application-integrity attestation
Nexus SHALL require a submission-policy attestation for every new application submission. The attestation MUST confirm final human review, stable candidate identity across application materials, factual claim verification, and a profile comparison status of either `verified` or `unavailable_reviewed`. Nexus SHALL persist the normalized attestation in the immutable submission record.

#### Scenario: Fully reviewed application
- **WHEN** a caller records a new submission with all required attestations set and an accepted profile comparison status
- **THEN** Nexus accepts the policy attestation for further validation
- **AND** persists it with the submission snapshot

#### Scenario: Missing human review
- **WHEN** a caller records a new submission without confirming final human review
- **THEN** Nexus rejects the request with `human_review_required`
- **AND** writes no submission, event, application transition, or document state change

#### Scenario: LinkedIn profile cannot be accessed
- **WHEN** the caller could not access the current profile but explicitly reviewed that limitation
- **THEN** the caller may use `unavailable_reviewed`
- **AND** Nexus persists that status rather than claiming the profile was verified

### Requirement: Complete submitted package
Nexus SHALL require at least one owned document for every submission. Nexus SHALL require at least one exact application answer unless the policy attestation explicitly confirms that the external form contained no answers.

#### Scenario: Submission has materials and answers
- **WHEN** a caller provides an owned document and at least one exact answer
- **THEN** package-completeness validation passes

#### Scenario: Form contained no application answers
- **WHEN** a caller provides an owned document, no answers, and `confirmedNoAnswers=true`
- **THEN** package-completeness validation passes
- **AND** the explicit confirmation is preserved in the policy snapshot

#### Scenario: Submission has no material
- **WHEN** a caller provides no document IDs
- **THEN** Nexus rejects the request with `submission_materials_required`
- **AND** writes nothing

#### Scenario: Submission omits answers without confirmation
- **WHEN** a caller provides no answers and does not confirm that the form contained none
- **THEN** Nexus rejects the request with `submission_answers_required`
- **AND** writes nothing

#### Scenario: Contradictory no-answer confirmation
- **WHEN** a caller supplies one or more answers and also sets `confirmedNoAnswers=true`
- **THEN** Nexus rejects the request with `submission_answers_conflict`
- **AND** writes nothing

### Requirement: Repeat and duplicate submission protection
Nexus SHALL reject a second new submission for the same application unless the policy contains a non-empty `resubmissionReason`. Nexus SHALL reject a submission whose ATS requisition matches another owner-scoped application at the same normalized company unless a non-empty `resubmissionReason` is supplied. Exact idempotent replays SHALL continue to return the original submission without requiring a new override.

#### Scenario: Accidental second submission
- **WHEN** an application already has a submission and a caller uses a new idempotency key without a resubmission reason
- **THEN** Nexus rejects the request with `application_already_submitted`
- **AND** writes nothing

#### Scenario: Employer-requested resubmission
- **WHEN** an application already has a submission and the caller supplies a non-empty resubmission reason
- **THEN** Nexus may create a second immutable submission after all other checks pass
- **AND** persists the reason in the policy snapshot

#### Scenario: Exact idempotent replay
- **WHEN** a completed request is repeated with the same idempotency key and request hash
- **THEN** Nexus returns the original submission as a replay
- **AND** does not apply new conflict checks or create writes

#### Scenario: Exact replay of a pre-policy submission
- **WHEN** a submission created before integrity-policy persistence is retried with its original idempotency key and a payload equivalent under the former REST coercion rules
- **THEN** Nexus reconstructs the legacy request hash, including former document stringification and 20-item truncation, and returns the original submission without requiring a retroactive policy attestation
- **AND** strict current document validation applies if no matching replay exists
- **AND** an altered payload or malformed policy under that key returns `idempotency_conflict` before new-submission policy errors

#### Scenario: Duplicate requisition on another record
- **WHEN** another application for the same normalized company has the same ATS requisition ID and the caller supplies no resubmission reason
- **THEN** Nexus rejects the request with `duplicate_requisition`
- **AND** writes nothing

### Requirement: Same-company active-process protection
Nexus SHALL reject a new submission when another application at the same normalized company is already in `applied`, `interview`, or `offer`, unless the policy contains a non-empty `sameCompanyOverrideReason` documenting recruiter redirection or an explicit user strategy override.

#### Scenario: Parallel same-company application
- **WHEN** another application at the same normalized company is active and no override reason is supplied
- **THEN** Nexus rejects the request with `same_company_active_application`
- **AND** writes nothing

#### Scenario: Recruiter redirects the candidate
- **WHEN** another same-company application is active and the caller provides a non-empty override reason
- **THEN** Nexus may record the new submission after all other checks pass
- **AND** persists the override reason in the policy snapshot and submission event metadata

### Requirement: Backend-parity and dry-run enforcement
Prisma and Firestore SHALL enforce the same integrity rules inside their submission-recording atomic boundary. Dry-run SHALL execute policy, ownership, package, repeat, duplicate-requisition, and same-company checks but MUST NOT mutate any record.

#### Scenario: Dry-run detects a conflict
- **WHEN** a dry-run submission conflicts with an active same-company application
- **THEN** Nexus returns `same_company_active_application`
- **AND** performs no writes

#### Scenario: Equivalent valid submission on both backends
- **WHEN** the same valid policy-complete request is processed by Prisma and Firestore
- **THEN** each backend persists an equivalent policy snapshot and applies the same application/document transitions
