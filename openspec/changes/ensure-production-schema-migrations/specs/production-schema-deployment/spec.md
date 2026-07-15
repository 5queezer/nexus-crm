## ADDED Requirements

### Requirement: Backup before production migration
The deployment system SHALL create and verify a timestamped PostgreSQL custom-format backup before executing any committed production migration.

#### Scenario: Backup succeeds
- **WHEN** a production deployment includes schema migrations
- **THEN** the current database is dumped to a protected server-side backup file
- **AND** the deployment verifies that the backup is non-empty before continuing

#### Scenario: Backup fails
- **WHEN** the database backup command fails or creates an empty file
- **THEN** the deployment stops before migration or application replacement

### Requirement: Migrate before activating the image
The deployment system SHALL apply committed Prisma migrations before replacing the running application container.

#### Scenario: Migration succeeds
- **WHEN** backup verification succeeds
- **THEN** `prisma migrate deploy` runs against the compose service database environment
- **AND** the new application image is activated only after migration succeeds

#### Scenario: Migration fails
- **WHEN** `prisma migrate deploy` fails
- **THEN** the deployment stops
- **AND** the previous application container remains active
- **AND** the verified backup is retained

### Requirement: Privacy-preserving verification
The deployment system SHALL verify data presence without exposing credentials or application contents.

#### Scenario: Migration is observed
- **WHEN** pre- and post-migration diagnostics run
- **THEN** logs contain only aggregate application counts and migration status
- **AND** connection strings, user IDs, company names, and job details are not logged
