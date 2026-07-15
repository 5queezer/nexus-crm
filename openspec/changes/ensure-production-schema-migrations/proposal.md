## Why

The Hetzner deployment workflow replaces the application image without applying committed Prisma migrations. After merge `057aa10`, production code queried newly added columns while the production PostgreSQL schema remained on the previous version, causing authenticated application and MCP requests to return HTTP 500 and making existing opportunities appear missing.

## What Changes

- Take a timestamped PostgreSQL backup before applying production migrations.
- Record read-only pre/post migration application counts without exposing row contents or credentials.
- Run `prisma migrate deploy` using the exact Prisma version used by the repository before restarting the application service.
- Abort deployment if backup or migration fails, leaving the previous application container running.
- Verify the deployed service and preserve backups for manual recovery.

## Non-Goals

- No deletion, reseeding, ownership reassignment, or application-data rewrite.
- No change to the feature schema or submission-package behavior.
- No automatic restoration from backup.

## Capabilities

### New Capabilities
- `production-schema-deployment`: Production deploys safely back up PostgreSQL and apply committed Prisma migrations before activating a new image.

## Impact

- `.github/workflows/deploy-hetzner.yml`
- Production PostgreSQL migration and deployment order
- Operational backup storage under the Coolify application directory
