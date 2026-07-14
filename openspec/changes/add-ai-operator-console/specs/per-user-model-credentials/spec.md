## ADDED Requirements

### Requirement: User-owned provider configuration
The system SHALL require each user to configure their own supported LLM provider credential and SHALL NOT require or silently fall back to a Nexus-owned provider key.

#### Scenario: Store provider credential
- **WHEN** an authenticated user submits a supported provider, model, and API key
- **THEN** the system validates the input, encrypts the key before persistence, and returns only masked metadata

#### Scenario: Unsupported provider or model
- **WHEN** a user submits a provider or model outside the server allowlist
- **THEN** the system rejects the configuration before storing the key

### Requirement: Credential confidentiality
The system SHALL encrypt provider credentials with authenticated encryption, SHALL never return a raw stored key, and SHALL exclude credentials from logs, analytics, chat records, tool traces, URLs, cookies, and error messages.

#### Scenario: Read credential metadata
- **WHEN** a user requests their credential configuration
- **THEN** the response contains provider, model, status, timestamps, and a non-sensitive key hint only

#### Scenario: Provider error includes request metadata
- **WHEN** a provider failure includes sensitive authorization or request details
- **THEN** the system emits a redacted error that does not contain the submitted or decrypted key

### Requirement: Tenant-isolated credential lifecycle
The system SHALL scope credential create, replace, validate, and delete operations to the authenticated user.

#### Scenario: Rotate a key
- **WHEN** a user replaces an existing provider credential
- **THEN** the new encrypted key atomically replaces the old credential for that user and provider
- **AND** subsequent runs use the replacement

#### Scenario: Delete a key
- **WHEN** a user deletes their provider credential
- **THEN** the encrypted value is removed and new runs cannot use that provider

#### Scenario: Cross-user credential identifier
- **WHEN** a user supplies another user's credential identifier
- **THEN** the system does not disclose, validate, modify, or delete that credential

### Requirement: Purpose-bound encryption configuration
The system SHALL require a valid server-side agent encryption key and use a purpose separate from other Nexus encrypted integration secrets.

#### Scenario: Missing encryption key
- **WHEN** credential persistence is attempted without a valid agent encryption key
- **THEN** the request fails closed without storing plaintext or partial credential records
