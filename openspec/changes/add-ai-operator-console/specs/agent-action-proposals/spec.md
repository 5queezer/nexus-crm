## ADDED Requirements

### Requirement: Consequential changes become proposals
The system SHALL prevent the model from directly mutating Nexus and SHALL persist a structured action proposal for every requested CRM mutation.

#### Scenario: Model proposes an application update
- **WHEN** the model determines that an application field should change
- **THEN** the system stores a pending proposal containing the operation, canonical payload, target, base version, expected diff, assumptions, expiration, and idempotency key
- **AND** Nexus remains unchanged

### Requirement: Explicit authenticated approval
The system SHALL execute a proposal only after its owner submits a separate authenticated approval request for the exact stored proposal.

#### Scenario: Approve pending proposal
- **WHEN** the proposal owner approves a pending, unexpired proposal
- **THEN** the executor applies the stored payload without regenerating it through the model

#### Scenario: Reject proposal
- **WHEN** the owner rejects a pending proposal
- **THEN** the system marks it rejected and makes no Nexus mutation

#### Scenario: Cross-user proposal access
- **WHEN** a user attempts to view, approve, or reject another user's proposal
- **THEN** the system returns not-found or forbidden and performs no action

### Requirement: Stale-write protection
The system SHALL compare the proposal's base entity version with current Nexus state before mutation.

#### Scenario: Target changed after proposal
- **WHEN** the target application's `updatedAt` no longer matches the proposal base version
- **THEN** the system marks the proposal stale and does not overwrite newer data

### Requirement: Idempotent application
The system SHALL ensure that repeated approval requests cannot apply a proposal more than once.

#### Scenario: Approval request is retried
- **WHEN** a client retries approval for an already applied proposal
- **THEN** the system returns the recorded execution and verification outcome without another mutation

### Requirement: Read-back verification
The system SHALL read the target from Nexus after application, compare every expected field, and persist a verification result.

#### Scenario: Applied state matches
- **WHEN** all expected fields match the read-back state
- **THEN** the proposal is marked applied and the verification records success with the checked fields

#### Scenario: Applied state differs
- **WHEN** one or more expected fields differ from read-back state
- **THEN** the system records verification failure and exposes the mismatch without concealing that the mutation was attempted

#### Scenario: Post-dispatch verification is interrupted
- **WHEN** a mutation may have been applied but read-back or persistence does not complete
- **THEN** the proposal remains `outcome_unknown`, the UI communicates uncertainty, and retrying approval does not dispatch the mutation again

### Requirement: UI refresh after verified mutation
The system SHALL refresh affected homepage CRM queries after a proposal is applied so table, Kanban, and details surfaces show the verified state.

#### Scenario: Status proposal completes
- **WHEN** an approved status change verifies successfully
- **THEN** the application table and Kanban data are invalidated and refreshed
