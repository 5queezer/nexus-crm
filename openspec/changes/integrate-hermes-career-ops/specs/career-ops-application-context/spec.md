## Purpose

Lets a Career Ops conversation be scoped to one Nexus application so the agent works on a specific opportunity, while Nexus stores only the owner-verified application relationship and Hermes retrieves current application facts through Nexus MCP instead of a duplicated snapshot.

## ADDED Requirements

### Requirement: Global and application-scoped entry points
The system SHALL let an authenticated user open Career Ops globally from the workspace and, additionally, in the context of a specific application they own.

#### Scenario: Global entry
- **WHEN** a user opens Career Ops from the workspace header
- **THEN** the conversation starts with no application link

#### Scenario: Application entry
- **WHEN** a user opens Career Ops from an application they own
- **THEN** the conversation is created with that application linked

#### Scenario: Return to global context
- **WHEN** a user in an application-scoped conversation chooses the global context
- **THEN** the user is placed in a conversation with no application link, and the application-scoped conversation is left unchanged

### Requirement: Owner-verified application linkage
The system SHALL verify that a requested application belongs to the authenticated user AND is readable through the same machine-read policy the Nexus MCP server applies, before linking it to a Career Ops conversation, and SHALL persist only the application relationship.

#### Scenario: Foreign application
- **WHEN** a user requests an application-scoped conversation for an application owned by another user
- **THEN** the system responds `404` and creates no conversation

#### Scenario: Unknown application
- **WHEN** a user requests an application-scoped conversation for an application that does not exist
- **THEN** the system responds `404` and creates no conversation

#### Scenario: Application the agent cannot read
- **WHEN** a user requests an application-scoped conversation for an application that the machine-read policy excludes, such as a demo record
- **THEN** the system responds `404` and creates no conversation
- **AND** no conversation is left whose stated context the agent could never retrieve

#### Scenario: Linked application stops being agent-readable
- **WHEN** a run starts on a conversation whose linked application is no longer readable under the machine-read policy
- **THEN** the run proceeds with global context instead of naming an application the agent cannot retrieve

#### Scenario: Only the relationship is stored
- **WHEN** an application-scoped conversation is created
- **THEN** Nexus stores the application identifier on the thread and stores no copy of the job description, company profile, or application notes for the agent

### Requirement: Live data through Nexus tools, not stale client context
The system SHALL communicate the selected application identifier to Hermes through the supported instruction mechanism and SHALL direct the agent to read current application facts through the authenticated Nexus MCP server, so a conversation that stays open does not act on stale data.

#### Scenario: Application identifier conveyed
- **WHEN** a run starts in an application-scoped conversation
- **THEN** the upstream request carries the verified application identifier as run context

#### Scenario: Application changes while the conversation is open
- **WHEN** the linked application is edited in Nexus after the conversation started
- **THEN** a later run reflects the current Nexus values, because the agent retrieves them through Nexus tools

#### Scenario: No parallel job-data store
- **WHEN** an application-scoped conversation runs
- **THEN** no application, contact, document, submission, or event record is duplicated into a separate agent-owned datastore

### Requirement: Visible application context
The system SHALL display the linked application's company and role in the Career Ops surface whenever a conversation is application-scoped, and SHALL make the scope distinguishable without relying on color alone.

#### Scenario: Context badge shown
- **WHEN** an application-scoped conversation is open
- **THEN** the surface shows the linked application's company and role

#### Scenario: Conversation scoped to a different application than the page
- **WHEN** the open conversation is scoped to an application other than the one whose page is displayed, or no application page is displayed
- **THEN** the surface shows the linked application's own company and role, never the displayed page's

#### Scenario: Link no longer readable by the agent
- **WHEN** the linked application has been deleted or is excluded from machine reads
- **THEN** the surface states that the conversation is scoped to another opportunity rather than naming a record the agent cannot retrieve

#### Scenario: Global conversation
- **WHEN** a conversation has no application link
- **THEN** the surface presents it as global context with no application badge

#### Scenario: Localized context labels
- **WHEN** the interface renders the application-context labels in English or German
- **THEN** the labels come from the shared translation catalogs

### Requirement: Application context is bounded and non-authoritative
The system SHALL treat retrieved application text as untrusted content for display and SHALL NOT let application-derived text alter the Career Ops request boundary, the configured endpoint, or the ownership checks.

#### Scenario: Injected instructions in application data
- **WHEN** a linked application contains text that reads as instructions to change endpoints, headers, or ownership
- **THEN** the system's upstream request is unchanged and the ownership checks still apply

#### Scenario: Bounded context payload
- **WHEN** application context is included in an upstream request
- **THEN** it is limited to the verified identifier and a bounded descriptive reference, not the full application record
