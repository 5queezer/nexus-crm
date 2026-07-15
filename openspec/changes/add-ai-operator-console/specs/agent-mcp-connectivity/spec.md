## ADDED Requirements

### Requirement: User-scoped remote MCP connectors
The system SHALL allow authenticated users to configure their own named remote Streamable HTTP MCP connectors with encrypted authorization metadata and SHALL isolate connector records by user.

#### Scenario: Save valid connector
- **WHEN** a user submits a valid connector name, HTTPS URL, and optional bearer credential
- **THEN** the system stores connector metadata under that user and encrypts the credential before persistence

#### Scenario: Cross-user connector identifier
- **WHEN** a user requests or invokes another user's connector
- **THEN** the system discloses no connector configuration and performs no network request

### Requirement: SSRF-resistant connector policy
The system SHALL reject unsafe MCP targets, SHALL pin each connection to a validated public address while preserving the original TLS hostname, and SHALL refuse redirects.

#### Scenario: Private or link-local target
- **WHEN** a production connector URL resolves to loopback, private, link-local, multicast, or unspecified address space
- **THEN** the system rejects the connector or invocation before sending credentials

#### Scenario: Unsupported transport
- **WHEN** a connector uses a non-HTTP scheme, embedded URL credentials, a fragment, or local stdio transport
- **THEN** the system rejects the connector

#### Scenario: Redirect to unsafe target
- **WHEN** an MCP request redirects to a destination that has not passed connector policy
- **THEN** the system refuses the redirect and does not forward authorization material

### Requirement: Bounded discovery
The system SHALL discover connector tools server-side with bounded connection time, response size, and tool count and SHALL namespace tool names by connector.

#### Scenario: Connector discovery succeeds
- **WHEN** an enabled connector responds within limits
- **THEN** the operator can display its namespaced tools without exposing credentials to the browser

#### Scenario: Connector exceeds limits
- **WHEN** discovery exceeds configured time, response, or tool-count limits
- **THEN** the system closes the connection, records a redacted failure, and exposes no tools from that attempt

### Requirement: Approval-gated MCP invocation
The system SHALL treat every external MCP invocation as consequential and SHALL require approval of the stored connector ID, immutable reviewed name, destination URL and version, namespaced tool name, and visible canonical arguments before calling the remote server. Unvalidated model arguments and rationale SHALL NOT be persisted in the tool-invocation audit record.

#### Scenario: Model requests an MCP tool
- **WHEN** the model selects an external MCP tool
- **THEN** the system creates a pending action proposal and does not invoke the connector

#### Scenario: User approves MCP invocation
- **WHEN** the proposal owner approves a valid MCP proposal
- **THEN** the system confirms the connector version and discovered tool-schema hash, revalidates and pins the connector destination, invokes the exact stored arguments, bounds execution, and persists a redacted verification result

#### Scenario: Connector or schema changed after review
- **WHEN** the connector version or discovered tool schema no longer matches the approved proposal
- **THEN** the system marks the proposal stale and performs no external invocation

#### Scenario: External outcome cannot be finalized
- **WHEN** dispatch has started but transport or bookkeeping fails before verification is durable
- **THEN** the system preserves `outcome_unknown` and does not automatically dispatch the proposal again

### Requirement: Connector credential confidentiality
The system SHALL never return decrypted connector credentials or include them in model context, chat messages, tool traces, or provider requests.

#### Scenario: Connector list requested
- **WHEN** a user lists their connectors
- **THEN** the response contains name, URL, enabled status, credential-presence indicator, and health metadata only
