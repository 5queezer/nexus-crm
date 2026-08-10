## ADDED Requirements

### Requirement: Seed execution is explicitly non-production
The development seed command SHALL fail before database writes in production or when the target user is not explicitly supplied.

#### Scenario: Production execution
- **WHEN** the seed command runs with `NODE_ENV=production` or a production deployment marker
- **THEN** it exits non-zero without reading, deleting, or creating application data

#### Scenario: Missing target user
- **WHEN** no explicit demo seed user ID is supplied
- **THEN** the command exits non-zero and does not select an arbitrary user

### Requirement: Seed is non-destructive and provider-neutral
The seed command SHALL use the configured database adapter's demo-workspace lifecycle and SHALL never perform global deletion or alter real applications.

#### Scenario: Existing real data
- **WHEN** the target user or another tenant has real applications
- **THEN** the seed command performs no deletion and follows normal demo-creation eligibility rules

#### Scenario: Configured backend
- **WHEN** the command runs with Prisma or Firestore configured
- **THEN** it invokes the same versioned provider-neutral fixture contract and lifecycle semantics

### Requirement: Seed replay is safe
Repeated seed execution for the same target SHALL converge without duplicates and failures SHALL produce a non-zero process exit status.

#### Scenario: Seed replay
- **WHEN** the seed runs twice for an existing demo workspace
- **THEN** the second run reports replay and creates no duplicate application or event

#### Scenario: Seed failure
- **WHEN** persistence returns an error
- **THEN** the command exits non-zero and does not report success
