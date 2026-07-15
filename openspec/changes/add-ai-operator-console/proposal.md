## Why

Nexus already centralizes the career pipeline, documents, email intake, and an authenticated MCP surface, but users must leave the product to use an AI assistant. A public, portfolio-grade operator console on the homepage will demonstrate a production-minded human-in-the-loop agent experience while ensuring every user brings and controls their own model credentials.

## What Changes

- Add a responsive AI operator panel to the authenticated Nexus homepage with persistent threads, streamed responses, tool activity, and reviewable action cards.
- Add per-user OpenAI and Anthropic credentials encrypted at rest, with masked metadata, validation, rotation, and deletion APIs; raw keys are never returned or logged.
- Add tenant-scoped Nexus read tools for application search, pipeline summaries, and application detail lookup.
- Add structured mutation proposals that require explicit approval, execute the exact stored payload with optimistic concurrency, and read Nexus back to persist verification evidence.
- Add per-user remote MCP connector records and a guarded server-side connector boundary. External MCP calls are treated as consequential and require approval before execution.
- Persist chat messages, agent runs, tool invocations, proposals, verification results, and connector metadata for auditability.
- Add public architecture and security documentation explaining framework selection, BYOK handling, tenant isolation, prompt-injection boundaries, and the proposal/apply/verify lifecycle.
- Add desktop and mobile visual evidence from the production build to the pull request.

## Capabilities

### New Capabilities

- `ai-operator-chat`: Persistent, streamed, responsive chat embedded in the Nexus homepage with auditable run and tool activity.
- `per-user-model-credentials`: User-owned provider configuration with encryption, masking, rotation, and strict non-disclosure guarantees.
- `agent-action-proposals`: Tenant-scoped, optimistic, idempotent proposal/approval/application/read-back verification for consequential changes.
- `agent-mcp-connectivity`: Server-side, user-scoped remote MCP discovery and approval-gated invocation behind SSRF and credential-isolation controls.

### Modified Capabilities

None.

## Impact

- **UI:** `components/dashboard.tsx`, a new operator panel and supporting credential/connector/proposal components, responsive styling, and localized strings.
- **API:** new authenticated routes under `app/api/agent/` for credentials, threads, streaming chat, proposals, and connectors.
- **Domain/runtime:** new modules under `lib/agent/` for provider construction, encryption, tenant-scoped tools, MCP policy, proposal execution, and audit persistence.
- **Data:** Prisma models and a migration for credentials, threads, messages, runs, tool invocations, proposals, verifications, and MCP connections.
- **Dependencies:** Vercel AI SDK 7 core, OpenAI/Anthropic providers, and AI SDK MCP support; Nexus remains on Next.js rather than introducing TanStack Start or a Java service.
- **Operations:** new encryption-key configuration and documented rotation/backup expectations. No operator-owned LLM key is required.
- **Security:** all reads and writes remain scoped to the authenticated user, untrusted content cannot authorize tools, and arbitrary provider/MCP secrets never reach the browser after storage.
