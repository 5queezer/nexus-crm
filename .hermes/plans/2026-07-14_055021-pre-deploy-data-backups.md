# Pre-Deploy Database and File Backups Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make every Nexus CRM production deployment create and verify a Git-commit-addressable PostgreSQL and GCS document recovery set before migrations or application activation.

**Architecture:** A tested Node.js backup program runs inside a one-off target-image Compose container after application writes are quiesced, creates a protected local PostgreSQL custom dump, uploads and verifies it in GCS, snapshots exact document generations into a deduplicated namespace, and publishes a completion manifest last. A protected EXIT trap restores Compose, `.env`, and the previous service on failure; deployment and manual recovery share a bounded, non-cancelling concurrency group.

**Tech Stack:** GitHub Actions, Docker Compose, Node.js 22, PostgreSQL 17 client tools, Google Cloud Storage SDK, Vitest, OpenSpec.

---

## Current context

- `.github/workflows/deploy-hetzner.yml` already creates a server-local PostgreSQL dump immediately before `prisma migrate deploy`.
- The current step checks only that the dump is non-empty; it does not upload or checksum it.
- GCS document objects are not included in a pre-deploy recovery set.
- Deployment concurrency currently permits cancellation of an in-progress deploy and does not coordinate with manual recovery.

## Implementation tasks

### Task 1: Define testable backup naming and URL helpers

**Files:**
- Create: `scripts/pre-deploy-backup.mjs`
- Create: `scripts/__tests__/pre-deploy-backup.test.ts`

1. Add failing tests for backup ID validation, Prisma URL sanitization, backup-prefix exclusion, and generation-addressed object names.
2. Run `npx vitest run scripts/__tests__/pre-deploy-backup.test.ts`; expect failure because exports do not exist.
3. Implement the pure helpers without network or process side effects.
4. Rerun the focused tests; expect all to pass.

### Task 2: Implement the fail-closed backup runtime

**Files:**
- Modify: `scripts/pre-deploy-backup.mjs`
- Modify: `scripts/__tests__/pre-deploy-backup.test.ts`

1. Add tests for manifest construction and same-bucket exclusion behavior.
2. Implement PostgreSQL custom dump creation using `pg_dump`, local SHA-256/size calculation, and protected file permissions.
3. Implement verified database upload to the backup bucket.
4. Enumerate source GCS objects, pin each source generation, copy missing generation-addressed backups, and verify destination metadata.
5. Upload and verify `manifest.json` only after every prior operation succeeds.
6. Ensure errors exit non-zero and do not log credentials or database URLs.
7. Rerun focused tests and `node scripts/pre-deploy-backup.mjs --help`.

### Task 3: Package required production tooling

**Files:**
- Modify: `Dockerfile`

1. Install `postgresql-client` in the runner image.
2. Copy `scripts/pre-deploy-backup.mjs` into `/app/scripts/`.
3. Build the production image and verify `pg_dump`, `psql`, and the backup script are present.

### Task 4: Make backup a deployment gate

**Files:**
- Modify: `.github/workflows/deploy-hetzner.yml`
- Modify: `.github/workflows/recover-production-db.yml`
- Create: `.github/workflows/container-smoke.yml`

1. Use the shared `nexus-production-transition` concurrency group with cancellation disabled in deployment and manual recovery.
2. Add bounded job, backup-runtime, and in-container database-operation deadlines with deterministic cleanup of stable transition-container names.
3. Protect and restore Compose and `.env` through an EXIT trap until target activation succeeds.
4. Stop the existing application before the database dump and document snapshot to quiesce writes.
5. Replace the inline local-only dump block with one invocation of `/app/scripts/pre-deploy-backup.mjs` before `prisma migrate deploy`.
6. Pass only non-secret backup identifiers explicitly; inherit database and GCS configuration from the Compose service environment.
7. Bind the protected host backup directory to `/backups` for local dump retention.
8. Keep pre/post migration counts and ensure migration or service activation cannot run after backup failure.
9. Add a path-scoped container smoke workflow that builds the production image and verifies `pg_dump`, `psql`, and the packaged backup CLI.
10. Validate workflow YAML and embedded shell syntax.

### Task 5: Document configuration and recovery

**Files:**
- Create: `docs/operations/pre-deploy-backups.md`

Document:
- `BACKUP_GCS_BUCKET` and `BACKUP_GCS_PREFIX`.
- Same-bucket fallback limitations.
- Backup object layout and manifest fields.
- Deployment failure behavior.
- Local and remote retention recommendations.
- Explicit database/document restore procedure into isolated resources.
- First-deployment and restore-drill verification checklist.

### Task 6: Validate the complete change

Run:

```bash
npx vitest run scripts/__tests__/pre-deploy-backup.test.ts
npm test
npm run lint
npm run build
/opt/data/npm-global/bin/openspec validate add-pre-deploy-data-backups --strict
```

Then inspect:

```bash
git diff --check
git diff --stat origin/main...HEAD
git status --short
```

Expected: focused tests, full tests, lint, build, strict OpenSpec validation, and whitespace checks pass.

### Task 7: Publish through a PR

1. Commit with `ci: add pre-deploy data backup gate`.
2. Push branch `ci/pre-deploy-backups`.
3. Open a PR against `main` describing the hard gate, same-bucket fallback, validation, and required production configuration.
4. Monitor all PR checks and automated review comments.
5. Do not merge or trigger production deployment without explicit user approval.

## Risks and trade-offs

- The same-bucket fallback protects against application mistakes but not total GCP project loss; a dedicated bucket/project remains recommended.
- The first generation-addressed snapshot transfers every current document and extends deployment downtime; later snapshots reuse unchanged generations.
- The workflow quiesces Nexus application/API/MCP writes for a coherent database-and-document recovery boundary and restores the previous service on failure.
- Remote retention must be configured through GCS lifecycle rules; destructive cleanup does not belong in deployment code.
