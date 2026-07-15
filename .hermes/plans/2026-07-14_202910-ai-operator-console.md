# AI Operator Console Implementation Plan

> **For Hermes:** Use TDD and independent subagent review to implement this plan task-by-task.

**Goal:** Add a polished, tenant-safe AI operator directly to the Nexus homepage, using each user's encrypted OpenAI or Anthropic credentials, with persistent chat, auditable tools, guarded MCP connectors, and proposal/apply/verify mutations.

**Architecture:** Keep the existing Next.js 16 application and add an isolated `lib/agent` domain/runtime package, Prisma persistence, authenticated App Router APIs, and a responsive dashboard drawer. Read tools execute with the authenticated user's ID; every mutation and external MCP invocation becomes a stored proposal that only a separate approval request can apply. Interactive turns use Vercel AI SDK 7; persistence boundaries permit a later dedicated worker without changing the proposal contract.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Prisma/PostgreSQL, Better Auth, Vercel AI SDK 7, OpenAI/Anthropic AI SDK providers, MCP Streamable HTTP, Zod, Vitest, Tailwind CSS 4.

---

## Task 1: Add runtime dependencies and data model

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260714203000_add_ai_operator_console/migration.sql`

**Steps:**
1. Install pinned `ai`, `@ai-sdk/react`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, and `@ai-sdk/mcp` packages.
2. Add user-owned models for credentials, connectors, threads, messages, runs, tool invocations, proposals, and verification results.
3. Add mandatory ownership indexes and unique constraints for `(userId, provider)`, proposal idempotency, and thread ordering.
4. Add an additive SQL migration with matching foreign keys and cascade behavior.
5. Run `npx prisma format`, `npx prisma validate`, and `npx prisma generate`.
6. Confirm the generated migration contains no destructive statement.

## Task 2: Implement purpose-bound encryption with TDD

**Files:**
- Create: `lib/agent/secrets.ts`
- Create: `lib/agent/__tests__/secrets.test.ts`

**Steps:**
1. Write tests for round-trip encryption, random IVs, wrong-purpose failure, malformed ciphertext, missing/invalid environment key, key hints, and secret redaction.
2. Run the focused test and confirm it fails because the module is missing.
3. Implement AES-256-GCM with a versioned ciphertext envelope and purpose-derived key.
4. Implement conservative error redaction for provider authorization values.
5. Run focused and full tests.

## Task 3: Implement provider policy and credential services with TDD

**Files:**
- Create: `lib/agent/providers.ts`
- Create: `lib/agent/credentials.ts`
- Create: `lib/agent/__tests__/providers.test.ts`
- Create: `lib/agent/__tests__/credentials.test.ts`
- Create: `app/api/agent/credentials/route.ts`

**Steps:**
1. Write tests for allowlisted providers/models, unsupported values, per-user upsert, masked reads, rotation, deletion, and cross-user isolation.
2. Implement OpenAI/Anthropic request-scoped model factories using decrypted user credentials.
3. Implement metadata-only responses and fail-closed encryption configuration.
4. Add authenticated `GET`, `PUT`, and `DELETE` route behavior with Zod validation.
5. Verify API serialization never contains ciphertext or plaintext keys.

## Task 4: Implement agent persistence and tenant isolation with TDD

**Files:**
- Create: `lib/agent/store.ts`
- Create: `lib/agent/types.ts`
- Create: `lib/agent/__tests__/store.test.ts`
- Create: `app/api/agent/threads/route.ts`
- Create: `app/api/agent/threads/[id]/route.ts`

**Steps:**
1. Define typed view records for threads, messages, tool activity, proposals, and verifications.
2. Write tests showing every lookup combines `id` and authenticated `userId`.
3. Implement create/list/get/delete thread and ordered message persistence.
4. Implement run/tool audit creation and redacted serialization.
5. Add routes and cross-user not-found behavior.

## Task 5: Build Nexus read tools and proposal creation with TDD

**Files:**
- Create: `lib/agent/tools.ts`
- Create: `lib/agent/proposals.ts`
- Create: `lib/agent/__tests__/tools.test.ts`
- Create: `lib/agent/__tests__/proposals.test.ts`

**Steps:**
1. Write failing tests proving admin sessions still use `session.userId` for agent reads.
2. Implement pipeline summary, search/list applications, and application detail using `getDb()` tenant scope.
3. Write failing tests proving requested updates produce proposals without calling `updateApplication`.
4. Implement canonical update payloads, human-readable diffs, base `updatedAt`, expiration, and idempotency.
5. Ensure external content is truncated/minimized before model context.

## Task 6: Implement approval, optimistic application, and verification with TDD

**Files:**
- Create: `lib/agent/proposal-executor.ts`
- Create: `lib/agent/__tests__/proposal-executor.test.ts`
- Create: `app/api/agent/proposals/route.ts`
- Create: `app/api/agent/proposals/[id]/approve/route.ts`
- Create: `app/api/agent/proposals/[id]/reject/route.ts`

**Steps:**
1. Write failing tests for ownership, pending status, expiry, stale target, repeated approval, rejection, and read-back mismatch.
2. Implement exact stored-payload execution using `expectedUpdatedAt`.
3. Read the target back and persist field-by-field verification.
4. Make repeated approvals return the recorded outcome without a second mutation.
5. Add authenticated routes and safe response shapes.

## Task 7: Implement the AI SDK streaming runtime with TDD

**Files:**
- Create: `lib/agent/runtime.ts`
- Create: `lib/agent/system-prompt.ts`
- Create: `lib/agent/__tests__/runtime.test.ts`
- Create: `app/api/agent/chat/route.ts`

**Steps:**
1. Write tests for missing credentials, provider/model policy, maximum steps, secret redaction, and a registry containing reads/proposal creation but no direct mutations.
2. Build request-scoped `streamText` execution with bounded steps and timeout.
3. Persist the user message before execution, an `AgentRun`, tool traces, and the final visible assistant message.
4. Return an AI SDK UI message stream compatible with `@ai-sdk/react`.
5. Mark job descriptions, email content, websites, and MCP output as untrusted data in the system prompt without treating prompt text as a security control.

## Task 8: Implement guarded MCP connectors with TDD

**Files:**
- Create: `lib/agent/mcp-policy.ts`
- Create: `lib/agent/mcp-client.ts`
- Create: `lib/agent/__tests__/mcp-policy.test.ts`
- Create: `lib/agent/__tests__/mcp-client.test.ts`
- Create: `app/api/agent/connectors/route.ts`
- Create: `app/api/agent/connectors/[id]/route.ts`
- Create: `app/api/agent/connectors/[id]/tools/route.ts`

**Steps:**
1. Write URL/IP policy tests including IPv4, IPv6, hostname resolution, fragments, embedded credentials, and development-only localhost.
2. Implement production HTTPS enforcement, DNS revalidation, no unsafe redirects, timeout, response size, and tool-count limits.
3. Write connector ownership/encryption tests.
4. Implement connector lifecycle and metadata-only responses.
5. Implement bounded MCP discovery and connector-prefixed names.
6. Register external calls only as proposal creators; execute approved MCP proposals through the executor.

## Task 9: Build the polished operator UI with component tests

**Files:**
- Create: `components/ai-operator/ai-operator-panel.tsx`
- Create: `components/ai-operator/thread-list.tsx`
- Create: `components/ai-operator/chat-timeline.tsx`
- Create: `components/ai-operator/message-composer.tsx`
- Create: `components/ai-operator/credential-setup.tsx`
- Create: `components/ai-operator/proposal-card.tsx`
- Create: `components/ai-operator/connector-settings.tsx`
- Create: `components/ai-operator/__tests__/ai-operator-panel.test.tsx`
- Create: `components/ai-operator/__tests__/proposal-card.test.tsx`
- Modify: `components/dashboard.tsx`
- Modify: `messages/en.json`, `messages/de.json`

**Steps:**
1. Write failing component tests for open/close, mobile dialog semantics, missing credentials, starter prompts, message states, proposal approval, rejection, and verified refresh callback.
2. Add a prominent Operator button to the homepage workspace.
3. Implement desktop right drawer and mobile full-screen sheet with focus management and accessible labels.
4. Add thread history, provider state, model badge, starter prompts, streamed timeline, tool status, and proposal cards.
5. Add inline credential and connector settings without ever displaying a stored key.
6. Invalidate the existing `applications` query after verified proposal execution.
7. Add English/German translations and responsive/reduced-motion polish.

## Task 10: Document architecture and operations

**Files:**
- Create: `docs/architecture/ai-operator-console.md`
- Create: `docs/security/ai-operator-threat-model.md`
- Modify: `README.md`
- Modify: `.env.example` if present

**Steps:**
1. Document why Nexus keeps Next.js and selects AI SDK over TanStack AI, Mastra, Strands, and LangGraph for this phase.
2. Document data flow, trust boundaries, proposal lifecycle, and future worker seam.
3. Document BYOK encryption/rotation, tenant isolation, prompt injection, MCP SSRF, limits, and non-goals.
4. Document `AGENT_SECRET_ENCRYPTION_KEY`, local setup, provider/model allowlists, migration, backup, and rollback.
5. Add concise public README screenshots/architecture links without marketing the product specifically “for recruiters.”

## Task 11: Validate and prepare portfolio-grade PR evidence

**Files:**
- Create: `docs/screenshots/ai-operator-desktop.png`
- Create: `docs/screenshots/ai-operator-mobile.png`
- Create: `docs/screenshots/ai-operator-proposal.png`
- Temporary only: `app/ai-operator-preview/` if authenticated fixture access is required

**Steps:**
1. Run `npm test`, `npm run lint`, `npm run build`, `npx prisma validate`, and strict OpenSpec validation.
2. Search for credential keys, authorization values, unsafe connector logging, unscoped Prisma lookups, and direct mutation tools.
3. Run independent architecture and security reviews and resolve every high/medium finding.
4. Serve the production build and capture desktop/mobile screenshots with representative, non-sensitive data.
5. Inspect screenshots, exercise proposal approval and connector states, then remove temporary preview scaffolding.
6. Rebuild and confirm the preview route is absent and the worktree is clean except intended changes.
7. Commit, push, open a PR with the OpenSpec/design links, validation output, security notes, and screenshots.
8. Monitor CI and automated review comments; fix failures before calling the PR ready.
