## ADDED Requirements

### Requirement: Tenant-scoped versioned demo creation
The system SHALL create a versioned demo workspace only for the authenticated user's tenant, only when that tenant has no real applications, and SHALL create explicitly marked fictional applications and events through both Prisma and Firestore.

#### Scenario: Empty tenant creates demos
- **WHEN** an authenticated user with no real applications requests demo creation
- **THEN** the system creates the expected marked applications and events owned only by that user

#### Scenario: Tenant with real data is rejected
- **WHEN** a user with at least one non-demo application requests first-time demo creation
- **THEN** the system returns a controlled conflict and performs no writes

#### Scenario: Backend parity
- **WHEN** the same fixture version is created through Prisma and Firestore
- **THEN** both backends expose equivalent logical demo applications, events, keys, and ownership markers

### Requirement: Idempotent and concurrency-safe lifecycle
The system SHALL converge repeated or concurrent create requests on one logical workspace and one record per stable demo key.

#### Scenario: Repeated creation
- **WHEN** the owner repeats demo creation for an existing ready workspace of the same version
- **THEN** the system returns the existing workspace as a replay without duplicates

#### Scenario: Concurrent creation
- **WHEN** two creation requests run concurrently for the same owner and fixture version
- **THEN** exactly one logical workspace and one copy of every fixture exist

### Requirement: Complete owner-scoped deletion
The system SHALL remove only demo data belonging to the authenticated user's workspace, SHALL remove all generated applications and events, and SHALL treat repeated deletion as success.

#### Scenario: Mixed real and demo records
- **WHEN** an owner removes their demo workspace while real applications exist
- **THEN** only that owner's marked demo applications, events, and workspace metadata are deleted

#### Scenario: Foreign tenant protection
- **WHEN** one tenant deletes its demo workspace
- **THEN** another tenant's real and demo data remain unchanged

#### Scenario: Delete replay
- **WHEN** deletion is repeated after the workspace is absent
- **THEN** the operation succeeds with zero additional deletions

#### Scenario: Firestore retry after partial failure
- **WHEN** Firestore deletion is interrupted after a partial batch
- **THEN** retrying resumes the deleting lifecycle and eventually leaves no owner-scoped demo remnants
