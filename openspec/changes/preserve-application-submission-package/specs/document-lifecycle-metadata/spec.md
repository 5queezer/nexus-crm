## ADDED Requirements

### Requirement: Typed document lifecycle metadata
Each document SHALL support a type, lifecycle state, version, content hash, source, generation timestamp, submission timestamp, and optional submission linkage. Existing documents SHALL remain readable with safe defaults.

#### Scenario: Existing untyped document is read
- **WHEN** a legacy document lacks lifecycle fields
- **THEN** Nexus returns it with compatible default metadata

#### Scenario: Document becomes submitted
- **WHEN** a submission package includes a document
- **THEN** Nexus records its submitted state and timestamp
- **AND** links it to that submission

### Requirement: Consistent resolved links
Single-document and list-document reads SHALL consistently return resolved application references subject to caller scope.

#### Scenario: Single linked document is retrieved
- **WHEN** an owner retrieves a linked document by ID
- **THEN** the response includes the owned application's ID, company, and role

### Requirement: Token-efficient document listing
Document listing SHALL support pagination, filtering by application, type, state, submission linkage, and orphan status, plus field selection and bounded limits.

#### Scenario: Agent lists submitted CVs for one application
- **WHEN** filters specify application ID, type `cv`, and state `submitted`
- **THEN** only matching documents are returned
- **AND** large binary content is not included

### Requirement: Historical preservation
Nexus SHALL support `draft`, `current`, `submitted`, `superseded`, `historical`, and `orphaned` lifecycle states. Terminal application status MUST NOT automatically delete documents.

#### Scenario: Application is rejected
- **WHEN** a linked application's status changes to rejected
- **THEN** submitted materials remain retrievable for later recall
