## ADDED Requirements

### Requirement: Structured work and eligibility metadata
Applications SHALL optionally store work mode, eligible countries, primary locations, minimum office days, travel percentage, sponsorship availability, right-to-work requirement, and timezone overlap. The legacy remote boolean SHALL remain compatible.

#### Scenario: Legacy remote application is read
- **WHEN** an application has `remote=true` and no work mode
- **THEN** clients may derive remote work mode without mutating the stored record

### Requirement: Separate compensation concepts
Advertised compensation SHALL support currency, period, and compensation type. Candidate expectations SHALL be stored in the submission snapshot and MUST NOT overwrite advertised salary fields.

#### Scenario: Candidate submits a minimum salary answer
- **WHEN** a submission includes a candidate compensation expectation
- **THEN** the value is stored on the submission
- **AND** the advertised salary range remains unchanged

### Requirement: ATS and JD provenance
Applications SHALL optionally store ATS name, requisition ID, captured/verified/posted/closed timestamps, content hash, liveness state, and normalized job summary while retaining the raw job description snapshot.

#### Scenario: Job description is refreshed
- **WHEN** a caller records a verified JD snapshot
- **THEN** Nexus stores verification metadata and hash separately from free-text notes

### Requirement: Detailed process stage
Applications SHALL optionally store the current interview stage independently of the broad pipeline status.

#### Scenario: Technical interview is scheduled
- **WHEN** the application remains broadly in `interview`
- **THEN** currentStage can identify the specific technical interview step

### Requirement: Safe creation defaults
New applications SHALL default to `inbound` and SHALL have no `appliedAt` unless the caller explicitly records an applied status or submission.

#### Scenario: MCP client creates a lead
- **WHEN** status and appliedAt are omitted
- **THEN** Nexus creates an inbound application with appliedAt null
