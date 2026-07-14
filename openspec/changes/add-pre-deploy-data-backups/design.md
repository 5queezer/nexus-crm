## Context

Nexus deploys an ARM64 image through GitHub Actions and activates it through a Coolify-generated Compose project on the Hetzner host. The workflow already creates a protected local PostgreSQL custom dump before Prisma migrations, but the dump remains in the application directory and documents in GCS are not represented in the same recovery point. Production documents are immutable UUID-named objects in GCS; their metadata and ownership live in PostgreSQL.

The backup must run with the target image's tooling while application and MCP writes are quiesced, then guarantee that the previous Compose/environment state and image are restored on any pre-activation failure. It must use the Compose service environment so database and GCS credentials are never copied into GitHub Actions logs.

## Goals / Non-Goals

**Goals:**

- Produce one transactionally coherent recovery set by quiescing application writes across the database dump and document-generation snapshot.
- Keep a local PostgreSQL custom dump and verify an uploaded GCS copy.
- Preserve the exact GCS generations visible at snapshot time without retransferring unchanged generations on every deployment.
- Publish the manifest last so its presence is the completion marker.
- Fail closed before migration or container replacement.
- Work with the current GCS bucket immediately while supporting a dedicated backup bucket through configuration.
- Keep implementation behavior unit-testable without production credentials.

**Non-Goals:**

- Automatic database restoration or rollback.
- Point-in-time recovery/WAL archiving.
- Automatic GCS lifecycle or Object Lock configuration.
- Backing up OAuth/API secrets or the Coolify control plane.
- Pausing writes during the snapshot.

## Decisions

### 1. Run one backup program inside a one-off target-image container

The workflow invokes `node /app/scripts/pre-deploy-backup.mjs` through `docker compose run --no-deps` after the image and Compose file validate but before migration. The container inherits the production database URL, GCS bucket, and mounted credential file without exposing their values to GitHub Actions.

Alternative considered: implement all operations inline in workflow YAML. Rejected because inline JavaScript and shell would be hard to test and maintain.

### 2. Add PostgreSQL client tooling to the runner image

The runtime image installs `postgresql-client`, ensuring `pg_dump` and `psql` exist for both the backup gate and existing migration verification. This removes dependence on accidental base-image contents.

Alternative considered: run a separate PostgreSQL image. Rejected because resolving the private Coolify network and transferring credentials would add complexity and increase secret-handling risk.

### 3. Retain a local dump and upload the same bytes remotely

`pg_dump --format=custom --no-owner --no-privileges` writes to a bind-mounted protected backup directory. The program calculates SHA-256 and size, uploads the dump, reads remote metadata back, and refuses to continue on mismatch. The local file remains available for fast operator-led recovery.

### 4. Snapshot GCS by immutable source generation

The backup enumerates source objects and records each generation. Each generation is copied to `<backup-prefix>/objects/<generation>/<original-name>`. Existing destinations are reused, so unchanged object generations are deduplicated across deployments. When source and backup buckets are the same, the reserved backup prefix is excluded from enumeration.

Alternative considered: copy every object into a timestamped directory. Rejected because storage would grow by the full bucket size on every deployment.

### 5. Publish a manifest as the atomic completion marker

After the database upload and all document generation copies verify, the program uploads `snapshots/<backup-id>/manifest.json`. The manifest contains the commit, timestamps, database checksum/size/object, document source generations and backup object names, plus aggregate counts. A deployment is permitted only when the program exits successfully after reading the manifest metadata back.

### 6. Support dedicated and same-bucket destinations

`BACKUP_GCS_BUCKET` selects a dedicated destination. If absent, the document `GCS_BUCKET` is used with `_nexus-backups/pre-deploy` as the default reserved prefix. This makes the gate deployable with current infrastructure while documenting that a separately controlled bucket is the desired production configuration.

### 7. Serialize and bound every production transition

The deployment and manual recovery workflows share the `nexus-production-transition` concurrency group with cancellation disabled. Both jobs have a 45-minute Actions deadline. Every database-facing one-off container has a stable name, an in-container `timeout` as PID 1, and deterministic host cleanup; a new transition removes any orphan before touching PostgreSQL. The backup runtime also has a configurable hard deadline (20 minutes by default).

### 8. Restore configuration and the old image on pre-activation failure

Before rewriting Compose or `.env`, the workflow creates protected snapshots and installs an EXIT trap. Until the new image is successfully activated, any failure restores both files and restarts the previous service if it was stopped. The temporary `.env` snapshot is removed on both success and failure.

### 9. Quiesce writes for a coherent recovery boundary

After preflight checks, the workflow stops the existing application service before counting rows, dumping PostgreSQL, or enumerating GCS. This prevents application, browser, API, and MCP writes from creating database/document mismatches. The service is restarted from the previous configuration on failure or replaced by the new image after successful backup and migration.

## Risks / Trade-offs

- **Same-bucket fallback shares a failure domain with source documents** → clearly label it as baseline protection and support a dedicated destination without code changes.
- **Writes outside the Nexus service could violate snapshot consistency** → serialize the manual recovery workflow and restrict direct database/bucket writers operationally; the restore drill verifies all manifest references.
- **Backup downtime increases with first-time document volume** → exact consistency requires quiescing writes; generation-addressed deduplication makes later snapshots incremental and the hard timeout restores the previous service on stalls.
- **No automatic retention cleanup** → document lifecycle rules and keep deletion out of the deploy path to avoid destructive mistakes.
- **A backup manifest can reveal object names** → backup buckets remain private and the manifest records storage identifiers, not document contents or user data.
- **Installing PostgreSQL tooling increases image size** → accepted to guarantee production backup and migration commands exist.

## Migration Plan

1. Merge workflow-only changes without triggering automatic deployment because the workflow path is ignored.
2. Configure `BACKUP_GCS_BUCKET` in Coolify when an independent bucket is available; otherwise use the protected same-bucket fallback.
3. Manually dispatch the deployment workflow.
4. Verify logs show a non-empty local dump, remote database verification, document snapshot count, and manifest verification before migration begins.
5. Verify the new application becomes healthy and existing documents download successfully.
6. Perform a test restore into an isolated database and verify one document from the manifest.

Rollback is application-only: reactivate the previous image. Database or document restoration remains an explicit operator action using the manifest; deployment never restores automatically.

## Open Questions

- Which independent GCS project/bucket should become the long-term `BACKUP_GCS_BUCKET`?
- What lifecycle policy should be applied to local dumps and remote snapshot manifests after the first verified restore drill?
