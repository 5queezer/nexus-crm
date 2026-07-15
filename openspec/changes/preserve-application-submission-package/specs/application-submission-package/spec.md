## ADDED Requirements

### Requirement: Structured immutable submission snapshots
Nexus SHALL persist each application submission as a first-class record owned by the same user as the application. A submission SHALL store the submitted-at timestamp, application URL and optional ATS/requisition/language metadata, the exact question/answer set, candidate compensation expectation, and the exact linked document IDs. Existing submission snapshots MUST NOT be overwritten.

#### Scenario: Submitted application is recorded
- **WHEN** an authenticated owner records an application submission with valid answers and owned document IDs
- **THEN** Nexus creates one submission snapshot
- **AND** returns the stored answers and resolved submitted materials on explicit retrieval

#### Scenario: Another user references an application or document
- **WHEN** a caller references an application or document they do not own
- **THEN** Nexus rejects the operation without revealing whether the foreign record exists

### Requirement: Atomic application transition
Recording a submission SHALL atomically create the submission and submission event, update the application to `applied`, set `appliedAt`, optionally set `followUpAt`, and mark the submitted documents as submitted. A failed validation or persistence operation MUST leave all records unchanged.

#### Scenario: Submission succeeds
- **WHEN** all submission inputs pass validation
- **THEN** the application, submission, event, and materials are updated as one operation
- **AND** the response includes a successful verification summary

#### Scenario: One submitted material is invalid
- **WHEN** any referenced document is missing or not owned by the caller
- **THEN** no submission, event, application update, or material state change is persisted

### Requirement: Idempotent recording
Submission recording SHALL accept a caller-provided idempotency key unique within the authenticated user's data. Retrying the same logical operation MUST return the existing submission without creating duplicate events or material changes.

#### Scenario: Exact retry
- **WHEN** a caller repeats a completed submission request using the same idempotency key
- **THEN** Nexus returns the existing submission package
- **AND** indicates that the operation was replayed

### Requirement: Bounded answer metadata
Each answer SHALL include a question and answer plus optional stable key, kind, and sensitive flag. Nexus SHALL enforce bounded counts and lengths and SHALL omit answer bodies from list operations unless explicitly requested.

#### Scenario: Submission list is requested
- **WHEN** a caller lists submissions without requesting answers
- **THEN** Nexus returns submission summaries without answer bodies
