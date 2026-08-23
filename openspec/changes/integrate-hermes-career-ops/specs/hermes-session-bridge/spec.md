## Purpose

Keeps Nexus the authority over which Hermes session or run a browser request may touch, by persisting a minimal owner-scoped mapping between the authenticated Nexus user and the Hermes conversation and run identifiers, with identical behavior on the Prisma and Firestore backends.

## ADDED Requirements

### Requirement: Nexus-owned Hermes session mapping
The system SHALL persist, per Career Ops thread, the owning Nexus user identifier, the Hermes session identifier, a title, an optional application link, and creation/update timestamps, and SHALL NOT copy Hermes message transcripts, reasoning traces, upstream authorization headers, or provider credentials into Nexus storage.

#### Scenario: Thread created
- **WHEN** an authenticated user starts a Career Ops conversation
- **THEN** the system creates a Hermes session and stores a thread mapping owned by that user

#### Scenario: Transcript not duplicated
- **WHEN** a Career Ops conversation exchanges messages
- **THEN** Nexus stores no assistant or user message bodies for that conversation
- **AND** message history is read from Hermes on demand

#### Scenario: No secrets at rest
- **WHEN** thread and run mappings are inspected
- **THEN** they contain no API key, bearer token, or authorization header value

### Requirement: Ownership resolution precedes every upstream operation
The system SHALL resolve a Nexus-owned mapping using the authenticated user identifier before performing any Hermes operation, and SHALL NOT accept a caller-supplied Hermes session or run identifier as authority.

#### Scenario: Forged Hermes session identifier
- **WHEN** a request supplies a Hermes session identifier directly instead of a Nexus thread identifier
- **THEN** the system ignores it and resolves the session only from the caller's own mapping

#### Scenario: Foreign thread identifier
- **WHEN** user A requests, lists, reads messages from, or deletes a thread owned by user B
- **THEN** the system responds `404` without disclosing that the thread exists or any of its content

#### Scenario: Foreign run identifier
- **WHEN** user A requests status, events, stop, or approval for a run owned by user B
- **THEN** the system responds `404` and performs no upstream request

#### Scenario: Administrators are not exempt
- **WHEN** an administrator requests another user's Career Ops thread or run
- **THEN** the system applies the same owner-scoped rule and responds `404`

#### Scenario: Unauthenticated access
- **WHEN** an unauthenticated caller invokes any Career Ops endpoint
- **THEN** the system responds `401` and performs no upstream request

### Requirement: Nexus-owned run mapping and deterministic deduplication
The system SHALL persist, per run, the owning user identifier, the owning thread identifier, the Hermes run identifier, a bounded client request identifier, a last-known status, and timestamps; and SHALL guarantee that two run-creation requests carrying the same thread and client request identifier produce exactly one Hermes run.

#### Scenario: Duplicate client request identifier
- **WHEN** the same thread receives two run-creation requests with an identical client request identifier
- **THEN** exactly one Hermes run exists for that pair and both requests resolve to the same run mapping

#### Scenario: Distinct client request identifiers
- **WHEN** the same thread receives two run-creation requests with different client request identifiers
- **THEN** two distinct run mappings exist

#### Scenario: Client request identifier bounded
- **WHEN** a client request identifier exceeds the permitted length or character set
- **THEN** the system responds `400` and creates no run

#### Scenario: One active run per conversation
- **WHEN** a run is submitted for a conversation whose latest run is observably in a non-terminal state
- **THEN** the system rejects it with a controlled conflict and starts no upstream run

#### Scenario: A reservation nothing can settle does not block the conversation
- **WHEN** a submission's outcome was ambiguous, so its reservation carries no upstream run identifier
- **THEN** the reservation stops counting as an active run after a bounded period
- **AND** the conversation accepts new submissions again without operator intervention

#### Scenario: Deduplication is scoped to the owner
- **WHEN** two different users submit the same client request identifier
- **THEN** each user's request creates its own run and neither observes the other's mapping

### Requirement: The agent acts as exactly one declared Nexus user
The connected Hermes profile authenticates to the Nexus MCP server with a single Nexus credential, so every agent tool call acts as that credential's owner regardless of who started the conversation. The system SHALL require that owner to be declared in configuration and SHALL refuse Career Ops to every other user.

#### Scenario: Owner not declared
- **WHEN** the owning user is not declared in configuration
- **THEN** the system reports Career Ops as unavailable and performs no upstream request

#### Scenario: A different user requests Career Ops
- **WHEN** an authenticated user who is not the declared owner invokes any Career Ops operation
- **THEN** the system responds with a controlled unavailable status and starts no run
- **AND** no upstream request is made on that user's behalf

#### Scenario: Administrators gain no exemption
- **WHEN** an administrator who is not the declared owner invokes Career Ops
- **THEN** the system responds with a controlled unavailable status

### Requirement: Deterministic listing and retrieval
The system SHALL list a user's Career Ops threads in a stable, deterministic order and SHALL return only that user's threads.

#### Scenario: Stable ordering
- **WHEN** a user lists Career Ops threads
- **THEN** threads are returned most-recently-updated first with a deterministic tiebreak

#### Scenario: Foreign threads excluded
- **WHEN** a user lists Career Ops threads while other users have threads
- **THEN** the listing contains only the requesting user's threads

### Requirement: Deletion and cleanup
The system SHALL delete a Career Ops thread and its run mappings on owner request, SHALL remove all mappings when the owning user or linked application is deleted, and SHALL NOT leave a mapping that could grant access across users when the upstream Hermes deletion fails.

#### Scenario: Owner deletes a thread
- **WHEN** the owner deletes a Career Ops thread
- **THEN** the thread mapping and its run mappings are removed and the Hermes session deletion is requested

#### Scenario: Active run cannot be stopped
- **WHEN** a conversation with a run still in flight is deleted and the agent cannot be stopped
- **THEN** the system keeps the mapping and reports a controlled conflict, so the run does not become unreachable while it is still executing

#### Scenario: Upstream deletion fails
- **WHEN** the Hermes session deletion request fails
- **THEN** the Nexus mapping is still removed and the caller receives a success outcome with the upstream failure recorded only in redacted form

#### Scenario: Run mappings cannot all be removed with the thread
- **WHEN** a backend cannot remove a deleted conversation's run mappings in the same operation that removes the conversation, and their removal afterwards fails
- **THEN** the caller is still told the conversation is deleted, and the outstanding removal is recorded durably so a later operation finishes it, rather than leaving the mappings behind permanently

#### Scenario: User deleted
- **WHEN** a user record is deleted from the relational store
- **THEN** that user's Career Ops thread and run mappings are removed by the relational cascade
- **AND** on every backend a mapping whose owner no longer exists stays unreachable, because each read is filtered by the authenticated user identifier

#### Scenario: Linked application deleted
- **WHEN** an application linked to a Career Ops thread is deleted
- **THEN** the thread survives as a global thread with no application link, and no dangling application reference remains

### Requirement: Backend parity across Prisma and Firestore
The system SHALL provide Career Ops thread and run persistence through the shared database adapter with equivalent observable behavior on the Prisma/PostgreSQL and Firestore backends, including ownership scoping, ordering, deduplication, and cleanup, and SHALL declare the composite indexes the Firestore queries require.

#### Scenario: Equivalent create, list, get, delete
- **WHEN** the same sequence of Career Ops persistence operations runs on each backend
- **THEN** both backends produce equivalent records, ordering, and ownership outcomes

#### Scenario: Equivalent deduplication
- **WHEN** a duplicate client request identifier is submitted on each backend
- **THEN** both backends yield exactly one run mapping for that thread and identifier

#### Scenario: Firestore composite indexes declared
- **WHEN** the Firestore index configuration is inspected
- **THEN** it declares the owner-scoped ordering and deduplication indexes the Career Ops queries require

### Requirement: Stable non-identifying long-term memory scope
The system SHALL scope Hermes long-term memory with a stable opaque identifier derived from the authenticated Nexus user, SHALL NOT place an email address or other personal identifier in that scope, and SHALL keep browser conversations in Hermes sessions distinct from other channels' sessions.

#### Scenario: Stable memory scope
- **WHEN** the same user starts Career Ops conversations at different times
- **THEN** each upstream request carries the same memory scope value for that user

#### Scenario: No personal data in the memory scope
- **WHEN** the memory scope value is inspected
- **THEN** it contains no email address, display name, or other personal identifier

#### Scenario: Distinct users, distinct scopes
- **WHEN** two different users use Career Ops
- **THEN** their memory scope values differ

#### Scenario: Browser sessions are independent
- **WHEN** a user opens Career Ops in the browser
- **THEN** the conversation uses a Nexus-created Hermes session and never reads or lists another channel's session transcript
