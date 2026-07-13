## ADDED Requirements

### Requirement: Symmetric application mutation tools
MCP create, update, and batch-upsert tools SHALL expose the same applicable application metadata fields and validation rules. Create SHALL default to inbound/no applied date.

#### Scenario: Agent moves from discovery to application
- **WHEN** the agent creates an inbound lead and later records a submission
- **THEN** no intermediate operation falsely marks the lead applied

### Requirement: Atomic submission tool
MCP SHALL expose `record_application_submission` with structured answers, candidate expectation, material IDs, submitted/follow-up timestamps, idempotency, dry-run, and verification output.

#### Scenario: Agent records final application package
- **WHEN** the tool succeeds
- **THEN** one response returns the updated application, immutable submission summary, resolved materials, event, and verification checks

### Requirement: Dedicated retrieval and append tools
MCP SHALL expose tools to list/get submissions, append notes, add/list events, run healthchecks, and get an interview-recall package. List tools SHALL exclude large fields by default.

#### Scenario: Interview preparation is requested
- **WHEN** an agent requests the application's recall package
- **THEN** Nexus returns the job snapshot, submitted answers, candidate expectation, exact submitted materials, contacts, and timeline in one bounded response

### Requirement: Duplicate-safe application intake
MCP SHALL support exact canonical job URL lookup and idempotent create-or-update behavior without fuzzy company matching.

#### Scenario: Same ATS URL is imported again
- **WHEN** a caller upserts an application with a canonical URL already owned by the user
- **THEN** Nexus updates or returns that application instead of creating a duplicate

### Requirement: Structured errors and verification
Agent-facing tools SHALL return stable error codes for validation, not found/access denied, conflict, and duplicate/idempotent replay. Successful mutations SHALL include verification data sufficient for read-back confirmation.

#### Scenario: Concurrency conflict
- **WHEN** an update carries a stale expectedUpdatedAt
- **THEN** the tool returns a stable `conflict` code and no mutation

### Requirement: MCP operational health
MCP SHALL expose a lightweight health tool reporting server version, active database provider, and capability availability without exposing secrets or user data.

#### Scenario: Agent checks prerequisites
- **WHEN** the health tool is called by an authenticated user
- **THEN** it reports usable capabilities and backend identity without credentials

### Requirement: Safe document ergonomics
MCP SHALL expose filtered document listing and metadata updates. The server MUST NOT fetch arbitrary caller-provided URLs unless a separately specified SSRF-safe upload design is implemented.

#### Scenario: Agent needs a submitted CV
- **WHEN** it filters documents by application, type, and state
- **THEN** the matching metadata is returned without requiring a full unfiltered document dump
