## 1. Policy Contract

- [x] 1.1 Add failing unit tests for policy attestations, package completeness, normalization, and stable error codes.
- [x] 1.2 Implement shared policy types, normalization, and pure validation.

## 2. Persistence Parity

- [x] 2.1 Add the additive Prisma policy field/migration and shared submission record/input mappings.
- [x] 2.2 Add failing shared conflict tests and Firestore transaction tests for policy persistence, repeat submission, duplicate requisition, same-company conflict, narrow overrides, dry-run, and exact replay; verify the Prisma path through the shared helper, generated client, typecheck, and build.
- [x] 2.3 Implement atomic policy and conflict enforcement in both adapters.

## 3. Public Boundaries

- [x] 3.1 Update REST submission validation and controlled error mapping.
- [x] 3.2 Update MCP submission schema, descriptions, input mapping, and controlled errors.

## 4. Verification

- [x] 4.1 Run targeted RED/GREEN tests for each vertical behavior slice.
- [x] 4.2 Run Prisma validation/generation, full test suite, lint, build, and strict OpenSpec validation.
- [x] 4.3 Review the final diff for backend parity, sensitive-data exposure, idempotency, and migration safety.
