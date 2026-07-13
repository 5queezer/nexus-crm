## ADDED Requirements

### Requirement: Append-only application timeline
Nexus SHALL preserve application lifecycle events as append-only records with event type, occurrence timestamp, optional actor/source, and bounded structured metadata. Events SHALL be scoped through application ownership.

#### Scenario: Note is appended
- **WHEN** an owner appends a note through the dedicated operation
- **THEN** Nexus appends the text to the legacy notes field without replacing concurrent content
- **AND** creates a corresponding timeline event

#### Scenario: Status or stage changes
- **WHEN** an application status or current stage changes
- **THEN** a timeline event records the before and after values

### Requirement: Optimistic concurrency
Application mutations SHALL accept an optional expected update timestamp. When supplied, the mutation MUST fail with a conflict if the stored application changed after the caller read it.

#### Scenario: Stale update
- **WHEN** expectedUpdatedAt does not equal the stored updatedAt
- **THEN** Nexus returns a conflict and leaves the record unchanged

### Requirement: Dry-run validation
Agent-facing compound mutations SHALL support a dry-run mode that validates ownership, limits, consistency, and intended changes without persisting data.

#### Scenario: Dry-run submission
- **WHEN** a valid submission request sets dryRun
- **THEN** Nexus returns the planned changes and validation result
- **AND** creates no submission, event, or material mutation

### Requirement: Deterministic healthcheck
Nexus SHALL calculate health findings without an LLM. The healthcheck SHALL identify inconsistent status/application dates, missing next action, incomplete submitted packages, missing submitted answers or materials, stale follow-ups, and orphan documents. Findings SHALL include stable codes, severity, affected record IDs, and suggested remediation.

#### Scenario: Applied application lacks a submission package
- **WHEN** an applied application has no submission record
- **THEN** the healthcheck emits an `applied_without_submission` finding

#### Scenario: Rejected application retains materials
- **WHEN** a rejected application has linked documents
- **THEN** Nexus treats the materials as historical
- **AND** does not recommend deletion solely because the application is rejected
