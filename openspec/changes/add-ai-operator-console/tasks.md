## 1. Foundation and Data Model

- [x] 1.1 Add pinned AI SDK, React, OpenAI, Anthropic, and MCP client dependencies and update the lockfile.
- [x] 1.2 Add agent credential, thread, message, run, tool invocation, proposal, verification, and MCP connection models to Prisma.
- [x] 1.3 Add and review an additive PostgreSQL migration for the operator-console tables and ownership indexes.
- [x] 1.4 Generate Prisma Client and verify the existing schema remains valid.

## 2. Per-User Secret Handling

- [x] 2.1 Write failing tests for purpose-bound AES-256-GCM encryption, malformed ciphertext, missing keys, and redaction.
- [x] 2.2 Implement the agent secret encryption/redaction module and make the focused tests pass.
- [x] 2.3 Write failing route/service tests for user-scoped provider credential create, metadata read, rotation, and deletion.
- [x] 2.4 Implement supported provider/model policy and credential lifecycle services.
- [x] 2.5 Implement authenticated provider credential API routes that never return raw keys.

## 3. Tenant-Scoped Agent Domain

- [x] 3.1 Write failing tests for per-user thread/message ownership and cross-user access rejection.
- [x] 3.2 Implement the Prisma-backed agent store for threads, messages, runs, tool traces, proposals, and verifications.
- [x] 3.3 Write failing tests for pipeline summary, application search, and application detail tools using authenticated user scope rather than admin-global read scope.
- [x] 3.4 Implement model-independent Nexus read tools and redacted tool audit events.
- [x] 3.5 Write failing tests that application mutation requests create proposals without changing Nexus.
- [x] 3.6 Implement typed update-application proposal creation with canonical diff, base version, expiration, and idempotency metadata.

## 4. Approval, Application, and Verification

- [x] 4.1 Write failing tests for proposal ownership, rejection, expiry, stale target detection, and repeated approval.
- [x] 4.2 Implement authenticated proposal list, approve, and reject routes.
- [x] 4.3 Implement exact-payload application with `expectedUpdatedAt` optimistic concurrency.
- [x] 4.4 Implement Nexus read-back verification and persist success or mismatch evidence.
- [x] 4.5 Verify approved changes refresh table, Kanban, and details query data.

## 5. Model Runtime and Persistent Chat

- [x] 5.1 Implement request-scoped OpenAI and Anthropic model construction from the authenticated user's decrypted credential.
- [x] 5.2 Write failing tests for missing credentials, unsupported provider/model selection, bounded steps, and provider-error redaction.
- [x] 5.3 Implement the authenticated streaming chat route with persisted user/assistant messages and run metadata.
- [x] 5.4 Register read tools and proposal-creation tools with the model; prevent direct mutation tools from entering the registry.
- [x] 5.5 Implement thread list/create/read/delete routes and verify cross-user IDs disclose nothing.

## 6. Guarded MCP Connectivity

- [x] 6.1 Write failing tests for URL normalization and rejection of non-HTTPS, embedded credentials, fragments, loopback, private, link-local, multicast, and unspecified targets.
- [x] 6.2 Implement DNS-aware MCP destination policy with redirect revalidation and bounded timeouts.
- [x] 6.3 Write failing tests for encrypted, user-scoped connector create/list/update/delete and cross-user rejection.
- [x] 6.4 Implement connector lifecycle APIs with masked credential metadata.
- [x] 6.5 Implement bounded server-side Streamable HTTP MCP discovery with connector-prefixed tool names.
- [x] 6.6 Wrap every MCP invocation as an approval-gated proposal and execute only the approved stored tool name and arguments.

## 7. Showcase User Experience

- [x] 7.1 Write component tests for operator open/close, missing-credential setup, message rendering, proposal controls, and mobile semantics.
- [x] 7.2 Build the responsive homepage operator drawer/full-screen mobile sheet using the existing Nexus visual system.
- [x] 7.3 Add persistent thread navigation, provider/model status, starter prompts, streamed message states, and visible tool/run activity.
- [x] 7.4 Add inline provider credential setup/rotation/delete controls with explicit privacy disclosure.
- [x] 7.5 Add proposal cards with canonical diff, assumptions, approve/reject actions, stale state, and verification result.
- [x] 7.6 Add MCP connector management and tool discovery status behind a secondary settings view.
- [x] 7.7 Add English and German translations and accessible labels, focus management, keyboard behavior, and reduced-motion handling.
- [x] 7.8 Ensure approved changes invalidate existing application queries without regressing table, Kanban, details, onboarding, or keyboard shortcuts.

## 8. Documentation and Operations

- [x] 8.1 Add architecture documentation covering framework selection, trust boundaries, data flow, and proposal lifecycle.
- [x] 8.2 Add security documentation covering BYOK encryption, tenant isolation, prompt injection, MCP SSRF, redaction, and rotation.
- [x] 8.3 Document required environment variables, supported providers/models, local setup, migration, rollback, and public-demo limitations.
- [x] 8.4 Update the public README with a concise operator-console section and architecture links.

## 9. Validation and Pull Request

- [x] 9.1 Run focused tests after every TDD slice and record expected red-to-green evidence.
- [x] 9.2 Run the full test suite, lint, production build, Prisma validation, migration checks, and strict OpenSpec validation.
- [x] 9.3 Perform a tenant-isolation and secret-leak review of all new routes, logs, traces, and serialized payloads.
- [ ] 9.4 Perform an independent architecture/code review and resolve every high/medium blocker.
- [x] 9.5 Capture inspected desktop and mobile screenshots from a production build, including configured chat, tool activity, and proposal approval states.
- [x] 9.6 Remove all temporary preview fixtures, rebuild, and verify no preview route or secret-bearing artifact is committed.
- [ ] 9.7 Commit with the repository's verified Git identity, push the feature branch, and open a PR with architecture summary, test evidence, security notes, and screenshots.
- [ ] 9.8 Monitor GitHub checks and automated review comments to completion and fix failures before reporting the PR ready.
