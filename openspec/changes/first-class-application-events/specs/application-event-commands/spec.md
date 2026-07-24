## ADDED Requirements

### Requirement: Canonical application event taxonomy
Nexus SHALL expose the canonical event types `opportunity_discovered`, `application_submitted`, `recruiter_contacted`, `stage_changed`, `interview_invited`, `interview_scheduled`, `interview_completed`, `feedback_received`, `follow_up_scheduled`, `offer_received`, `application_rejected`, `document_attached`, and `note_added`. REST and MCP boundaries MUST reject unknown event types with the controlled code `event_type_invalid` while existing stored legacy types remain readable.

#### Scenario: Unknown type is submitted
- **WHEN** an owner submits a new event with a type outside the canonical taxonomy
- **THEN** Nexus rejects the command with `event_type_invalid`
- **AND** does not mutate the event history or application projection

#### Scenario: Legacy type is read
- **WHEN** an existing event contains a pre-taxonomy type
- **THEN** Nexus returns it as an unrecognized legacy event without rewriting or dropping it

### Requirement: Event-specific bounded metadata
Nexus SHALL validate event metadata against the selected event type, reject missing or malformed command fields with controlled validation codes, and enforce the existing 100-key, 100-character-key, and 32,000-byte aggregate metadata limits. Common optional link fields SHALL include contact, document, submission, outcome, next action, and evidence identifiers where applicable.

#### Scenario: Interview schedule is valid
- **WHEN** an `interview_scheduled` command contains a valid interview type, scheduled timestamp, optional duration, contact, and next action
- **THEN** Nexus stores normalized structured metadata

#### Scenario: Required command metadata is missing
- **WHEN** `follow_up_scheduled` omits a valid `followUpAt` timestamp
- **THEN** Nexus rejects the command with `event_metadata_invalid`

### Requirement: Atomic event and projection command
Nexus SHALL append the immutable event and update the owning `Application` projection in one backend transaction. The command result SHALL include the stored event, resulting application projection, and replay status. PostgreSQL and Firestore implementations MUST have equivalent observable behavior.

#### Scenario: Stage changes
- **WHEN** an owner records `stage_changed` with a new stage and optional new application status
- **THEN** Nexus appends the event and updates `currentStage` and the supplied status atomically
- **AND** metadata preserves the prior and resulting values

#### Scenario: Interview is scheduled
- **WHEN** an owner records `interview_scheduled`
- **THEN** Nexus atomically sets status to `interview`, records the current interview stage, updates `lastContact`, and sets the next actionable time from the schedule

#### Scenario: Interview is completed
- **WHEN** an owner records `interview_completed`
- **THEN** Nexus atomically records completion in the current stage, updates `lastContact`, and applies any explicit next follow-up

#### Scenario: Follow-up is scheduled
- **WHEN** an owner records `follow_up_scheduled`
- **THEN** Nexus atomically appends the event and updates `followUpAt`

#### Scenario: Application is rejected
- **WHEN** an owner records `application_rejected`
- **THEN** Nexus atomically sets status and current stage to rejected, updates `lastContact`, and clears stale follow-up state

#### Scenario: Submission is recorded
- **WHEN** an application submission package is successfully recorded
- **THEN** the existing submission transaction appends the canonical `application_submitted` event and updates the projection in the same transaction

### Requirement: Idempotent and concurrency-safe commands
Event commands SHALL accept an owner-scoped idempotency key and stable occurrence time. The same key and normalized payload SHALL return the original event without applying the projection twice; the same key with a different payload SHALL fail with `idempotency_conflict`. Commands SHALL support an optional expected application update timestamp and fail with `conflict` before writing when stale.

#### Scenario: Exact command replay
- **WHEN** the same owner repeats a command with the same idempotency key and normalized payload
- **THEN** Nexus returns the stored event with `replayed: true`
- **AND** does not append another event or reapply the projection mutation

#### Scenario: Conflicting command replay
- **WHEN** the same owner reuses an idempotency key for a different payload
- **THEN** Nexus returns `idempotency_conflict`

#### Scenario: Concurrent projection update
- **WHEN** `expectedUpdatedAt` differs from the current application timestamp
- **THEN** Nexus returns `conflict`
- **AND** writes neither the event nor the projection update

### Requirement: Owner-scoped contract parity
REST and MCP SHALL expose equivalent command semantics, metadata validation, idempotency, and controlled error codes. Every command MUST verify application ownership before reading or writing event or projection state.

#### Scenario: Cross-owner command
- **WHEN** a user targets another owner's application
- **THEN** REST and MCP return a not-found response without revealing the record
- **AND** no event or projection mutation occurs
