# Nexus CRM pre-deploy backups

Every production deployment is gated by a verified recovery set created after the target image builds and before Prisma migrations or application activation.

## What is protected

Each recovery set contains:

- A PostgreSQL custom-format dump retained on the Hetzner host.
- The same database dump uploaded to GCS and verified by byte size and SHA-256 metadata.
- A generation-pinned backup copy of every current document object.
- A manifest tying the database and document artifacts to the target Git commit.

The manifest is uploaded last. Its verified presence is the completion marker that allows deployment to continue.

## Configuration

The backup process inherits production configuration from the Coolify Compose service. Do not add database URLs or service-account JSON to GitHub Actions secrets for this feature.

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `GCS_BUCKET` | Yes | — | Source bucket containing Nexus documents |
| `BACKUP_GCS_BUCKET` | No | `GCS_BUCKET` | Dedicated backup destination |
| `BACKUP_GCS_PREFIX` | No | `_nexus-backups/pre-deploy` | Reserved destination namespace |
| `BACKUP_TIMEOUT_SECONDS` | No | `1200` | Hard deadline for the complete backup runtime |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | — | Existing mounted GCS credential file |

`BACKUP_ID`, `SOURCE_COMMIT`, and `BACKUP_LOCAL_DIR` are supplied by the deployment workflow.

### Recommended destination

Configure `BACKUP_GCS_BUCKET` as a private bucket in a separate GCP project or administrative boundary. Grant the Nexus backup identity:

- Read access to source document objects and generations.
- Create/read access to the backup bucket.
- No public access.
- No broad project-level permissions.

If `BACKUP_GCS_BUCKET` is absent, the backup uses the source document bucket beneath the reserved prefix. This protects against deployment and application mistakes but does **not** protect against loss of the bucket, GCP project, or its credentials.

## Object layout

```text
<backup-prefix>/
├── objects/
│   └── <source-generation>/
│       └── <base64url-source-name>
└── snapshots/
    └── <UTC timestamp>-<Git SHA>/
        ├── database.dump
        └── manifest.json
```

Document copies are addressed by source generation and encoded source name. An unchanged generation is transferred only once and can be referenced by many deployment manifests.

The manifest records:

- Backup format version and identifier.
- Target Git commit.
- Started/completed timestamps.
- Source and backup bucket names.
- Database object, local filename, size, and SHA-256.
- Each source object name, generation, size, CRC32C/MD5 where available, and backup object.

It contains storage identifiers and integrity metadata, not database credentials or document contents.

## Fail-closed deployment behavior

The deployment stops before `prisma migrate deploy` and before target-image activation when any of these operations fail:

- `pg_dump` execution.
- Non-empty local dump verification.
- Database upload or remote metadata verification.
- Source document enumeration.
- Exact-generation document copy or verification.
- Manifest publication or remote verification.

Before the dump begins, the workflow marks recovery as required and then stops the Nexus service to quiesce browser, API, and MCP writes. If stopping, backup, or migration fails, an EXIT trap removes any transition containers, restores the previous Compose and `.env` files, and restarts the previous image. Temporary environment snapshots are removed on both success and failure.

Partial objects can remain in the backup namespace, but no completion manifest is published for an incomplete recovery set. The backup runtime has a 20-minute default hard deadline, and deployment/recovery jobs have 75-minute GitHub Actions deadlines. Database-facing one-off containers use stable names and in-container deadlines; each transition removes stale named containers before accessing PostgreSQL.

Deployment and manual production recovery share one concurrency group. New pushes and recovery requests wait instead of overlapping or cancelling a production transition already in progress.

## First deployment checklist

1. Rotate the currently mounted GCS service-account key before using it for backups.
2. Preferably create and configure a dedicated `BACKUP_GCS_BUCKET`.
3. Confirm the credential can read the source bucket and create/read backup objects.
4. Manually dispatch **Deploy to Hetzner**.
5. Confirm logs show:
   - PostgreSQL dump creation.
   - Database upload verification.
   - Document generation snapshot.
   - Completion-manifest verification.
   - Only then Prisma migration and application activation.
6. Confirm a protected local dump exists under:

   ```text
   <COOLIFY_APP_DIR>/database-backups/nexus-before-<backup-id>.dump
   ```

7. Confirm the remote `manifest.json` exists and references the deployed Git SHA.
8. Confirm Nexus is healthy and an existing document downloads successfully.

## Isolated restore drill

Never test restoration against the production database or source document bucket.

### 1. Select and verify a snapshot

Choose a completed manifest by Git SHA. Verify that:

- `version` is supported.
- `sourceCommit` is the intended deployment.
- The database object exists with the manifest's byte size and SHA-256 metadata.
- Every listed document backup object exists with the recorded size/checksum metadata.

### 2. Restore PostgreSQL

Download `database.dump` into a protected temporary directory, verify SHA-256 locally, and restore it into a newly created isolated PostgreSQL database:

```bash
createdb nexus_restore_test
pg_restore \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --dbname nexus_restore_test \
  database.dump
```

Then verify:

```bash
npx prisma migrate status
```

Run read-only row counts and foreign-key checks. Do not print user records, tokens, document contents, or credentials into CI logs.

### 3. Restore documents

Create an isolated restore bucket. For each manifest entry, copy its `backupObject` to the recorded source `name` in the isolated bucket. Pin the backup object's generation when the storage tool supports it.

Verify every restored object's size and CRC32C/MD5 against the manifest. Report missing or mismatched identifiers without downloading or displaying document contents unless required for an authorized checksum test.

### 4. Validate the application

Deploy Nexus in an isolated environment using the restored database and bucket. Verify:

- Login succeeds.
- Application table and Kanban load.
- Existing documents download.
- A new application can be created and updated.
- One account cannot read another account's applications or documents.
- MCP/API authentication succeeds.

Record restore duration and results. The backup system should not be considered operational until this drill succeeds.

## Retention

Recommended starting policy:

- Local dumps: retain the most recent 20 successful deployments.
- Complete remote recovery sets: retain at least 90 days.
- Monthly recovery points: retain 12 months.

Do not attach a simple age-based deletion rule to the shared `objects/` namespace. A document generation created months ago can still be referenced by the newest manifest. Remote cleanup must be manifest-aware: delete a generation-addressed object only when no retained manifest references it.

Automated destructive cleanup is deliberately outside the deployment path.

## Recovery boundaries

- Application rollback is safe to automate by reactivating the previous image.
- Database and document restoration is always an explicit operator action.
- This system does not provide PostgreSQL point-in-time recovery.
- The same-bucket fallback is not an independent off-site backup.
- Coolify configuration, OAuth secrets, and IAM recovery require a separate encrypted control-plane runbook.
