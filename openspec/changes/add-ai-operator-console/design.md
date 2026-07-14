## Context

Nexus is a public Next.js 16, React 19, TypeScript, Prisma/PostgreSQL application with Better Auth, tenant-scoped CRM APIs, TanStack Query/Table, and an authenticated MCP server. It does not contain the Java/Spring operator service assumed in an earlier architectural draft. The new experience must therefore extend the existing application without replacing its web framework or creating a second product backend.

The operator console is both a user feature and a portfolio surface for HR and technical reviewers. It must look intentional, demonstrate tool use and human approval clearly, and preserve Nexus's multi-user isolation. Job descriptions, email content, model responses, and MCP output are untrusted inputs. Users, not Nexus, pay for and control model access.

## Goals / Non-Goals

**Goals:**

- Deliver a polished AI operator panel directly from the authenticated homepage on desktop and mobile.
- Support persistent chat threads and streamed OpenAI/Anthropic responses through Vercel AI SDK 7.
- Store one encrypted provider credential per user/provider, never returning the raw key after storage.
- Give the model useful tenant-scoped read tools while ensuring writes become durable proposals.
- Execute approved proposals from stored typed arguments, guard against stale data, and persist read-back verification.
- Support guarded, per-user remote MCP connectors with encrypted authorization metadata and approval-gated calls.
- Keep agent, tool, and proposal behavior testable independently of any model provider.
- Publish architecture/security documentation and PR screenshots suitable for a public showcase.

**Non-Goals:**

- Replacing Next.js with TanStack Start.
- Introducing Java/Spring, Mastra, Strands, or LangGraph as a second runtime.
- Giving the model direct database, filesystem, browser, or shell access.
- Automatically submitting job applications or sending external communication.
- Running unattended scheduled agents in this first change; the persistence model must permit a later dedicated worker.
- Supporting arbitrary local stdio MCP servers from the web deployment.
- Storing provider credentials in browser storage, cookies, chat messages, or telemetry.

## Decisions

### 1. Keep Nexus on Next.js and use Vercel AI SDK 7

The existing Next.js App Router already supplies authenticated route handlers, React rendering, deployment, and streaming primitives. `ai`, `@ai-sdk/openai`, and `@ai-sdk/anthropic` provide provider-neutral model construction, typed tools, and bounded text streaming without a framework migration. The client deliberately consumes a narrow text stream from a custom authenticated route instead of trusting client-supplied UI-message history.

TanStack AI remains an explicit alternative behind internal provider/tool boundaries, but its alpha status and overlap with AI SDK do not justify using it as the primary runtime. Mastra is deferred until durable workflow orchestration becomes a product requirement. Strands TypeScript is viable but adds another agent abstraction without a Nexus-specific advantage.

### 2. Embed an operator drawer instead of replacing the pipeline workspace

The dashboard receives a persistent desktop side drawer and a mobile full-screen sheet opened from a prominent "Operator" action. The panel contains:

- thread history and new-thread control;
- provider/model status;
- streamed conversation;
- visible tool/run activity;
- proposal cards with approve/reject controls;
- an inline setup state for model credentials;
- connector management in a secondary settings surface.

The table, Kanban, application details, and existing keyboard controls remain available. After an approved proposal changes CRM state, the panel invalidates the applications query so all existing surfaces refresh.

### 3. Store agent state in PostgreSQL with mandatory ownership

New Prisma models store provider credentials, threads, messages, runs, tool invocations, proposals, verification results, and MCP connections. Every user-owned record has a required `userId`, indexed ownership lookup, and cascade deletion. Routes always use the authenticated `session.userId`, even for administrators; the agent never uses the admin `readScopeUserId = null` behavior.

Thread and proposal IDs from a request are never sufficient authorization. Every lookup combines `id` and `userId`.

### 4. Encrypt credentials with purpose-bound AES-256-GCM

A new generic secret helper derives purpose-specific keys from `AGENT_SECRET_ENCRYPTION_KEY` and encrypts with AES-256-GCM. Provider credentials and MCP authorization metadata use different purpose strings. The database stores ciphertext, provider/model metadata, and a short key hint only.

The API supports create/replace, metadata lookup, provider validation, and deletion. The raw key is accepted over TLS, encrypted immediately, omitted from responses, and redacted from errors. It is decrypted only for the provider request or MCP connection that needs it.

### 5. Separate model tools from mutation execution

Read tools call tenant-scoped Nexus domain methods directly:

- pipeline summary;
- application search/list;
- application detail.

Mutation tools never update Nexus. They create typed `ActionProposal` records containing:

- operation kind and canonical payload;
- target entity and owner;
- base `updatedAt` value;
- human-readable diff and assumptions;
- idempotency key and expiration;
- pending status.

Approval executes the exact stored payload in a transaction-like sequence. The executor checks ownership, proposal status, expiry, and base version, applies with `expectedUpdatedAt`, reads the target back, and persists a `VerificationResult`. Duplicate approval returns the recorded outcome instead of applying twice.

### 6. Treat external MCP calls as consequential by default

Only Streamable HTTP(S) remote MCP is supported. Connector creation validates URL policy before storage:

- HTTPS is required outside explicit local development;
- URLs with credentials, fragments, or non-HTTP schemes are rejected;
- localhost, loopback, link-local, private, multicast, and unspecified IP targets are rejected in production;
- DNS resolution is rechecked before connection;
- redirect following is disabled or revalidated;
- credentials are encrypted per user;
- response/tool counts and run time are bounded.

Discovered MCP tools are namespaced by connector. The model can propose an MCP invocation, but the invocation executes only after the user approves the stored connector ID, connector version, tool name, and visible canonical arguments. Arguments are validated against the discovered JSON schema and stored with argument/schema hashes. Approval rediscovers the tool and rejects connector or schema changes as stale; newly discovered tools never gain automatic execution rights. Once dispatch begins, uncertain outcomes remain `outcome_unknown` rather than being retried or mislabeled as failed.

### 7. Persist a useful audit trail without persisting secrets

Each model turn creates an `AgentRun`; each tool attempt creates a `ToolInvocation` with redacted inputs, status, duration, and proposal linkage. Chat messages store user-visible content. Provider API keys, authorization headers, full secret-bearing provider errors, and raw connector credentials are excluded.

Run metadata includes provider, model, timing, finish reason, and token usage when available. It does not store hidden chain-of-thought.

### 8. Make untrusted-content and approval boundaries explicit

The system prompt identifies job descriptions, email text, websites, and MCP results as untrusted data that cannot grant authority. Authorization and tool policy are server code, not prompt instructions. The model cannot approve its own proposal. The approval API is a separate authenticated request and proposal cards display the stored canonical diff.

### 9. Use an incremental delivery architecture

Interactive model execution remains in a Next.js route for the MVP. Runtime functions are isolated under `lib/agent/` so scheduled/background execution can later move to a dedicated Node worker and durable queue without changing the UI or proposal contract.

## Risks / Trade-offs

- **Provider API differences and churn** → Pin AI SDK/provider versions, isolate provider construction, and unit-test model selection without live keys.
- **Credential compromise** → Purpose-bound authenticated encryption, strict response redaction, no browser persistence, documented key rotation, and per-user deletion.
- **Cross-user leakage** → Composite ownership lookups, tenant-isolation tests for every route/service, and no admin-global scope in agent code.
- **Prompt injection** → Treat external content as data, use server-side policies, keep writes behind explicit stored approvals, and minimize tool context.
- **MCP SSRF or malicious tools** → Production URL/DNS policy, encrypted user-scoped credentials, bounded connections, namespacing, and approval for every invocation.
- **Stale proposals overwrite newer work** → Base-version checks and a visible stale status requiring regeneration.
- **Long model responses exceed request lifetime** → Bounded steps/timeouts and persisted partial run failure; durable background execution is a later worker concern.
- **Large UI scope obscures the core portfolio story** → Use a focused drawer with clear empty/configured/proposal states rather than adding another top-level application.
- **Firestore adapter parity** → Agent persistence is explicitly implemented on the primary Prisma/PostgreSQL path; the existing hybrid authentication already requires Prisma. Documentation will state that the operator console requires PostgreSQL.

## Migration Plan

1. Add dependencies and generate a lockfile update.
2. Add Prisma models and an additive migration; run `prisma generate`.
3. Deploy `AGENT_SECRET_ENCRYPTION_KEY` before enabling credential creation.
4. Deploy APIs and UI with no default provider credential; existing Nexus behavior remains unchanged.
5. Users add their own provider credential and optionally an MCP connector.
6. Rollback by hiding/removing the UI and routes; additive tables can remain safely. Do not drop credential tables until encrypted records have been intentionally removed.
7. Backups must include the new PostgreSQL records; raw secrets do not exist outside encrypted columns.

## Open Questions

- Which durable queue or workflow engine should back scheduled agents in a later change: PostgreSQL queue, Inngest, or another managed runner?
- Should connector OAuth be added as a separate capability after bearer-header connectors prove the interaction model?
- Which additional mutation types should be enabled after update-application proposals receive production feedback?
