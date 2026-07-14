## Why

The production deployment currently creates only a server-local PostgreSQL dump immediately before Prisma migrations. It does not protect GCS documents, verify an off-host database copy, or bind both data sets to the Git commit being deployed, so a server or storage incident can leave the pre-deployment recovery point incomplete.

## What Changes

- Replace the local-only database dump step with one fail-closed pre-deployment backup command that protects PostgreSQL and document objects before migrations or application activation.
- Retain the protected local PostgreSQL custom-format dump and upload a verified copy to the configured GCS backup location.
- Snapshot every current GCS document generation into a deduplicated backup object namespace and publish an immutable manifest for the target Git commit.
- Permit a dedicated `BACKUP_GCS_BUCKET`; fall back to the document bucket with a reserved backup prefix when a separate bucket is not yet configured.
- Quiesce application and MCP writes while PostgreSQL and GCS generations are captured, then restart the previous service on any pre-activation failure.
- Restore the previous Compose and `.env` state when backup, migration, or activation fails.
- Abort deployment if the database dump, remote upload, document snapshot, manifest publication, or verification fails.
- Serialize deployment and manual production recovery through one non-cancelling concurrency group.
- Bound jobs and backup operations with explicit timeouts.
- Document restore boundaries, configuration, retention expectations, and validation procedures.

## Capabilities

### New Capabilities

- `pre-deploy-data-backup`: Commit-addressable, fail-closed PostgreSQL and GCS document backups executed before production migration and activation.

### Modified Capabilities

None. The repository has no archived production-deployment capability spec; the previous local-dump behavior exists only in an active historical change and is superseded by the new capability.

## Impact

- `.github/workflows/deploy-hetzner.yml`
- `.github/workflows/recover-production-db.yml`
- `.github/workflows/container-smoke.yml`
- `Dockerfile`
- New backup runtime and focused unit tests under `scripts/`
- New operational recovery documentation under `docs/operations/`
- Repository-local OpenSpec artifacts
- Production GCS storage usage; no application API or database schema changes
