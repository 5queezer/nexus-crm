## 1. Incident Verification

- [x] 1.1 Confirm the merged image deployed successfully while authenticated application/MCP requests return HTTP 500.
- [x] 1.2 Verify the committed migration is additive and contains no `DROP`, `TRUNCATE`, or unconditional `DELETE` statements.
- [x] 1.3 Confirm the Hetzner workflow does not run Prisma migrations.

## 2. Safe Deployment Migration

- [x] 2.1 Add a protected pre-migration PostgreSQL backup step using the compose service environment.
- [x] 2.2 Add privacy-preserving pre/post application counts.
- [x] 2.3 Run the image-bundled, lockfile-pinned Prisma migration command before activating the target image.
- [x] 2.4 Abort without replacing the running app when backup or migration fails.

## 3. Verification and Recovery

- [x] 3.1 Validate workflow syntax, OpenSpec, tests, and build.
- [ ] 3.2 Deploy the hotfix and verify the migration job succeeds.
- [ ] 3.3 Confirm the old application count remains present and authenticated MCP access recovers.
- [ ] 3.4 Confirm the application UI shows the historical opportunities again.
