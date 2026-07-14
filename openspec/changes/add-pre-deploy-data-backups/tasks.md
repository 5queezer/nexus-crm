## 1. Backup Runtime

- [x] 1.1 Add failing unit tests for backup identifiers, database URL normalization, reserved-prefix exclusion, and generation-addressed object names.
- [x] 1.2 Implement the pure backup naming and URL helper functions and make focused tests pass.
- [x] 1.3 Implement protected PostgreSQL custom-dump creation with non-empty, size, SHA-256, and permissions checks.
- [x] 1.4 Implement verified database-dump upload to the configured GCS backup destination.
- [x] 1.5 Implement exact-generation document enumeration, deduplicated copy, and destination verification.
- [x] 1.6 Implement manifest construction, publish-last behavior, and remote manifest verification.
- [x] 1.7 Ensure all failure paths exit non-zero without logging credentials or database URLs.

## 2. Runtime Packaging and Deployment Gate

- [x] 2.1 Install PostgreSQL client tools and copy the backup runtime into the production image.
- [x] 2.2 Disable cancellation of in-progress production deployments.
- [x] 2.3 Replace the local-only dump block with the unified backup runtime before Prisma migration.
- [x] 2.4 Bind the protected host backup directory and pass commit-addressable backup metadata without exposing secrets.
- [x] 2.5 Preserve pre/post migration count checks and fail-closed ordering before application activation.
- [x] 2.6 Add a path-scoped production-container smoke workflow for the backup CLI and PostgreSQL tools.
- [x] 2.7 Restore Compose, `.env`, and the previous image on every pre-activation failure.
- [x] 2.8 Quiesce application and MCP writes across the database and document snapshot.
- [x] 2.9 Share a non-cancelling concurrency group with manual recovery and add bounded deadlines.
- [x] 2.10 Bound and deterministically clean every database-facing one-off transition container.

## 3. Operations Documentation

- [x] 3.1 Document dedicated-bucket configuration and same-bucket fallback behavior.
- [x] 3.2 Document backup layout, manifest fields, retention expectations, and security boundaries.
- [x] 3.3 Document isolated database-and-document restore and verification procedures.

## 4. Validation and Delivery

- [x] 4.1 Run focused backup-runtime unit tests.
- [x] 4.2 Run the complete test suite, lint, and production build.
- [ ] 4.3 Validate workflow YAML/embedded shell and verify required tools in the built image.
- [x] 4.4 Run strict OpenSpec validation and repository diff/whitespace checks.
- [ ] 4.5 Commit and push the implementation branch, open the pull request, and monitor CI plus automated review feedback.
