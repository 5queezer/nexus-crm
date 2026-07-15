## ADDED Requirements

### Requirement: Homepage operator access
The system SHALL provide authenticated users with an AI operator panel directly from the Nexus homepage without replacing or obscuring the existing application table, Kanban board, and details workflow.

#### Scenario: Desktop operator drawer
- **WHEN** an authenticated user opens the operator from a desktop-width homepage
- **THEN** the system displays a side drawer alongside the pipeline workspace
- **AND** closing the drawer restores the full existing workspace

#### Scenario: Mobile operator sheet
- **WHEN** an authenticated user opens the operator on a narrow viewport
- **THEN** the system displays a full-screen, keyboard-accessible sheet with a visible close action

### Requirement: Persistent tenant-scoped threads
The system SHALL persist chat threads and messages under the authenticated user's identity and SHALL reject access to another user's thread even when its identifier is known.

#### Scenario: Resume a thread
- **WHEN** a user reopens one of their saved threads
- **THEN** the system displays that thread's ordered user, assistant, tool, and proposal-visible events

#### Scenario: Cross-user thread identifier
- **WHEN** a user requests a thread owned by another user
- **THEN** the system returns a not-found or forbidden response without disclosing thread content

### Requirement: Streamed provider-neutral responses
The system SHALL stream assistant output from the model provider and model selected in the user's stored configuration and SHALL bound the number of tool/model steps per turn.

#### Scenario: Configured provider
- **WHEN** a user with a valid provider credential sends a message
- **THEN** the system streams the assistant response and persists the completed visible message
- **AND** records provider, model, timing, finish status, and available usage metadata

#### Scenario: Missing provider credential
- **WHEN** a user without a configured provider credential opens or uses the operator
- **THEN** the system presents a credential setup state without attempting a model request

#### Scenario: Provider failure
- **WHEN** the provider rejects or times out during a turn
- **THEN** the system marks the run failed with a redacted user-visible error
- **AND** does not persist credential material or hidden chain-of-thought

### Requirement: Auditable tool activity
The system SHALL persist and present model tool activity with redacted inputs, status, duration, and proposal linkage where applicable.

#### Scenario: Read tool completes
- **WHEN** the model invokes a tenant-scoped read tool
- **THEN** the user can see the tool name and completion state in the conversation
- **AND** the audit record contains no provider or connector secret

### Requirement: Untrusted content boundary
The system SHALL treat job descriptions, email content, websites, model output, and MCP output as untrusted data that cannot authorize tools or bypass server-side policy.

#### Scenario: Prompt injection in job content
- **WHEN** an application job description contains instructions to reveal secrets or execute a write
- **THEN** the system exposes no secret to the model or tool result
- **AND** any consequential operation still requires a separately authenticated approval
