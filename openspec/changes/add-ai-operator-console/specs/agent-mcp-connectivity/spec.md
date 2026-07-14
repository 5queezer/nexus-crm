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
The system SHALL reject unsafe MCP targets and SHALL revalidate resolved destinations before connecting.

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
The system SHALL treat every external MCP invocation as consequential and SHALL require approval of the stored connector ID, namespaced tool name, and canonical arguments before calling the remote server.

#### Scenario: Model requests an MCP tool
- **WHEN** the model selects an external MCP tool
- **THEN** the system creates a pending action proposal and does not invoke the connector

#### Scenario: User approves MCP invocation
- **WHEN** the proposal owner approves a valid MCP proposal
- **THEN** the system revalidates the connector destination, invokes the exact stored tool arguments, bounds execution, and persists a redacted result reference

### Requirement: Connector credential confidentiality
The system SHALL never return decrypted connector credentials or include them in model context, chat messages, tool traces, or provider requests.

#### Scenario: Connector list requested
- **WHEN** a user lists their connectors
- **THEN** the response contains name, URL, enabled status, credential-presence indicator, and health metadata only
