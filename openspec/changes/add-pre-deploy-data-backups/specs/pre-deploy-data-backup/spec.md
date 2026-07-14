## ADDED Requirements

### Requirement: Pre-deployment recovery set
The production deployment system SHALL create one commit-addressable recovery set containing PostgreSQL data and current document object generations before applying migrations or activating the target image.

#### Scenario: Recovery set succeeds
- **WHEN** a production image has built and the deployment is ready to mutate production
- **THEN** the system creates and verifies the database and document backups
- **AND** publishes a manifest associated with the target Git commit before migration begins

#### Scenario: Recovery set fails
- **WHEN** any database dump, upload, document copy, or verification operation fails
- **THEN** the deployment stops before database migration or application activation
- **AND** restores the previous Compose and environment files
- **AND** restarts the previous production image when writes were quiesced

### Requirement: Coherent database and document boundary
The production deployment system SHALL quiesce Nexus application and MCP writes before creating the database dump and document-generation snapshot, and SHALL keep writes quiesced until backup, migration, and activation succeed or the previous service is restored.

#### Scenario: Snapshot begins
- **WHEN** preflight validation succeeds
- **THEN** the existing Nexus service is stopped before the database dump or document enumeration begins

#### Scenario: Snapshot or migration fails
- **WHEN** an operation fails after the existing service was stopped
- **THEN** the deployment restores the pre-deploy configuration
- **AND** attempts to restart the previous production image before exiting with failure

### Requirement: Verified PostgreSQL backup
The backup system SHALL produce a PostgreSQL custom-format dump, retain a protected local copy, upload the same bytes to the configured backup bucket, and verify remote size before reporting success.

#### Scenario: Database backup is valid
- **WHEN** `pg_dump` exits successfully and produces non-empty output
- **THEN** the system calculates and records its SHA-256 checksum and byte size
- **AND** confirms the uploaded object's size matches the local dump

#### Scenario: Database dump is empty
- **WHEN** the database dump is absent or zero bytes
- **THEN** no successful manifest is published
- **AND** deployment is aborted

### Requirement: Generation-addressed document snapshot
The backup system SHALL snapshot each current source document generation into a generation-addressed backup object and exclude the reserved backup namespace when source and destination are the same bucket.

#### Scenario: Unchanged document generation already exists
- **WHEN** a generation-addressed backup object already exists
- **THEN** the system reuses it without retransferring the document
- **AND** includes it in the new deployment manifest

#### Scenario: Document changes during backup
- **WHEN** a listed document receives a new generation while backup is running
- **THEN** the system copies or references the exact generation that was enumerated
- **AND** records that source generation in the manifest

### Requirement: Verified completion manifest
The backup system SHALL publish the snapshot manifest only after all database and document artifacts have been verified, and SHALL verify the remote manifest before exiting successfully.

#### Scenario: Complete manifest
- **WHEN** all artifacts have been created and verified
- **THEN** the manifest records the backup identifier, Git commit, timestamps, database checksum and size, and every document source generation and backup object
- **AND** its verified presence authorizes deployment to continue

#### Scenario: Partial backup
- **WHEN** one or more required artifacts are incomplete
- **THEN** the completion manifest is not published
- **AND** deployment remains blocked

### Requirement: Backup destination configuration
The backup system SHALL use `BACKUP_GCS_BUCKET` when configured and SHALL otherwise use the source document bucket under a reserved backup prefix.

#### Scenario: Dedicated backup bucket configured
- **WHEN** `BACKUP_GCS_BUCKET` is present
- **THEN** database, document, and manifest artifacts are written to that bucket

#### Scenario: Dedicated bucket absent
- **WHEN** `BACKUP_GCS_BUCKET` is absent but `GCS_BUCKET` is configured
- **THEN** the system writes artifacts beneath the reserved prefix in the source bucket
- **AND** excludes that prefix from document enumeration

### Requirement: Serialized production transitions
All workflows that mutate the Nexus production database or Compose deployment SHALL share one non-cancelling concurrency group.

#### Scenario: New revision arrives during backup
- **WHEN** a deployment is performing its pre-deployment backup and another revision is pushed
- **THEN** the active deployment continues to a clean terminal state
- **AND** the newer deployment waits for the concurrency group

#### Scenario: Manual recovery overlaps a deployment
- **WHEN** the manual production recovery workflow is requested while deployment is active
- **THEN** the recovery waits in the same concurrency group
- **AND** cannot modify the production database concurrently

### Requirement: Bounded production transitions
Production deployment and recovery jobs SHALL have a finite job deadline, and the backup runtime SHALL terminate with failure after a configurable hard timeout.

#### Scenario: Backup operation stalls
- **WHEN** database or GCS backup work exceeds the configured hard timeout
- **THEN** the backup process exits unsuccessfully
- **AND** the workflow restores the previous production configuration and service

#### Scenario: SSH is interrupted during a one-off database operation
- **WHEN** a deployment or recovery SSH session ends while a database-facing container is running
- **THEN** the container's in-container timeout bounds its remaining lifetime
- **AND** the next production transition removes any stale named transition container before accessing PostgreSQL
