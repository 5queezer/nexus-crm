## ADDED Requirements

### Requirement: Deterministic application timeline query
Nexus SHALL provide an owner-scoped per-application event query ordered by occurrence time and a deterministic tie-breaker. The query SHALL support opaque cursor pagination, bounded page sizes, and both newest-first and oldest-first ordering.

#### Scenario: Timeline page is loaded
- **WHEN** an owner requests a timeline page with a valid limit
- **THEN** Nexus returns ordered events and an opaque next cursor only when more matching events exist

#### Scenario: Equal occurrence timestamps
- **WHEN** multiple events share the same occurrence timestamp
- **THEN** pagination returns each event exactly once in deterministic order

### Requirement: Global owner activity query
Nexus SHALL provide a global owner-scoped activity query across applications. The query SHALL support filters for time range, one or more canonical event types, application, source, actor, contact, and outcome, with the same cursor and ordering semantics as the application timeline.

#### Scenario: Activity is filtered
- **WHEN** an owner filters activity by application, event type, and time range
- **THEN** every returned event satisfies all requested filters
- **AND** no event owned by another user is returned

#### Scenario: Linked dimensions are filtered
- **WHEN** an owner filters by contact or outcome
- **THEN** Nexus matches normalized indexed event dimensions rather than searching arbitrary metadata prose

### Requirement: Query contract parity
REST and MCP SHALL expose equivalent global and per-application event filters, result fields, limits, cursors, and controlled validation errors. Event query results SHALL include occurrence time, ingestion time, source, actor, application reference, normalized link dimensions, and structured metadata.

#### Scenario: Invalid query is supplied
- **WHEN** REST or MCP receives an invalid cursor, timestamp, order, type, or limit
- **THEN** it returns a controlled `event_query_invalid` error

### Requirement: Backend-equivalent indexed ordering
Prisma/PostgreSQL and Firestore SHALL implement equivalent owner-scoped ordering and filtering. Additive indexes SHALL support the primary owner/time and application/time query shapes without rewriting existing event records.

#### Scenario: Existing event lacks normalized dimensions
- **WHEN** a legacy event has no normalized contact or outcome fields
- **THEN** it remains visible in unfiltered timeline and activity queries
- **AND** is excluded only from filters whose normalized dimension is absent
