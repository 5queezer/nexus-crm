## Context

The production service runs from a minimal standalone Next.js image on Hetzner/Coolify. The image includes `prisma/schema.prisma` and migration SQL but not the Prisma CLI. The existing workflow starts the new image immediately and never runs migrations. Database credentials are available only through the compose service environment on the server.

## Goals / Non-Goals

**Goals**
- Preserve all existing application data.
- Produce a verified backup before schema mutation.
- Apply migrations before the new application container becomes active.
- Fail closed if backup or migration fails.
- Keep credentials out of workflow output.

**Non-goals**
- Changing database providers.
- Backfilling optional metadata.
- Automated destructive recovery.

## Decisions

1. Run backup and migration through one-off compose containers using the target service environment. This avoids exporting `DATABASE_URL` into GitHub Actions logs.
2. Install the PostgreSQL client only inside the ephemeral backup container and stream a custom-format dump to a server-side file with mode `0600`.
3. Run the repository-pinned Prisma CLI version through `npx` in an ephemeral migration container. The image already contains the schema and migration directory.
4. Execute backup and migration before `docker compose up -d`, so the prior application remains active if either operation fails.
5. Emit only aggregate counts and migration status, never row data or connection strings.

## Risks and Mitigations

- **Package download unavailable:** deployment aborts before replacing the running app.
- **Backup failure:** deployment aborts; migration does not run.
- **Migration failure:** the backup remains available and the old app remains active. The additive migration contains no destructive statements.
- **Disk growth:** backups are compressed custom-format dumps; retention cleanup is intentionally manual until a reviewed policy exists.

## Rollback

If migration fails after partial application, stop deployment, inspect Prisma migration state, and restore only from the verified backup after explicit operator approval. Application image rollback alone does not reverse database schema changes.
