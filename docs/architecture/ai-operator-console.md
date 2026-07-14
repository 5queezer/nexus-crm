# AI operator console architecture

The Nexus AI operator is a human-in-the-loop assistant for a user's personal career pipeline. It can answer questions from that user's Nexus records, prepare a reviewable application update, and apply the stored update only after a separate authenticated approval.

The console extends the existing application rather than introducing another backend:

- **Web and API:** Next.js 16 App Router and React 19
- **Agent runtime:** Vercel AI SDK 7 core with OpenAI and Anthropic providers
- **Persistence:** Prisma 6 and PostgreSQL
- **Authentication:** Better Auth sessions
- **Validation:** Zod
- **Remote tools:** AI SDK Streamable HTTP MCP client

The authenticated operator is the functional product surface. This repository, its public documentation, and screenshots can be used as a showcase without making conversations, credentials, connectors, or career records public.

## System boundary

```text
Browser
  │ authenticated HTTPS
  ▼
Next.js 16 route handlers ───────────────┐
  │                                     │
  ├─ /api/agent/credentials             ├─ Better Auth session
  ├─ /api/agent/threads                 ├─ tenant policy (session.userId)
  ├─ /api/agent/chat                    └─ input validation
  ├─ /api/agent/proposals
  └─ /api/agent/connectors
          │
          ├─ AI SDK 7 ─────► OpenAI or Anthropic (user's key)
          ├─ Nexus domain adapter ──────► PostgreSQL
          └─ guarded HTTP MCP client ──► public HTTPS endpoint
```

The browser never receives a stored provider key or connector authorization value. Provider and MCP network calls originate on the server.

## Request and data flow

### 1. Bring your own model key

Each user configures an allowlisted provider/model pair and their own API key. Nexus has no operator-owned fallback model credential.

1. `PUT /api/agent/credentials` authenticates the request and validates its shape and provider/model allowlist.
2. The server derives a purpose-specific key from `AGENT_SECRET_ENCRYPTION_KEY`.
3. It encrypts the API key with AES-256-GCM and stores the envelope under `(userId, provider)`.
4. Metadata responses contain provider, model, state, timestamps, and a last-four-character hint—not the key.
5. For a model request, the credential is decrypted only in server memory and passed directly to the selected provider client.

OpenAI and Anthropic are currently supported. The exact model allowlist lives in `lib/agent/providers.ts`; unsupported provider/model combinations fail before persistence.

### 2. Persistent chat and bounded execution

A chat request supplies a thread ID, provider, and user message. The route resolves both the thread and credential using the authenticated `session.userId`. It then creates an `AgentRun`, streams provider output, and records visible messages and run metadata.

Runtime limits are code-enforced:

| Limit | Current value |
| --- | ---: |
| Maximum model/tool steps | 6 |
| Total run time | 60 seconds |
| Per-step time | 30 seconds |
| Tool time | 15 seconds |
| Provider retries | 1 |

The persisted audit trail includes provider/model, timing, finish reason, token usage when supplied, tool status, and proposal linkage. It intentionally excludes provider secrets, connector authorization, and hidden chain-of-thought.

### 3. Tenant-scoped read tools

The runtime exposes a narrow tool set rather than database, filesystem, browser, or shell access:

- `get_pipeline_summary`
- `search_applications`
- `get_application`
- `propose_application_update`

Read tools call the existing Nexus database adapter with the authenticated user ID. Agent code does not use the broader administrator read scope. IDs from the model or request are selectors, not authorization: ownership is a required lookup condition.

### 4. Proposal → apply → verify

The model cannot update an application directly. `propose_application_update` stores a typed `ActionProposal` with the canonical payload, target, expected field diff, target `updatedAt` base version, expiration, and per-user idempotency key. Creating it leaves the application unchanged.

```text
model suggests change
        │
        ▼
 pending proposal ── reject ──► rejected (no mutation)
        │
 authenticated owner approval
        ▼
 ownership + status + expiry + base-version checks
        │
        ├─ stale/expired ──────► no mutation
        ▼
 apply exact stored payload with expectedUpdatedAt
        ▼
 read target back and compare expected fields
        │
        ├─ all match ─────────► applied + successful verification
        └─ mismatch ──────────► applied_unverified + mismatch evidence
```

Approval is a separate authenticated API request. The executor does not ask the model to regenerate arguments. A conditional status transition claims a pending proposal before execution, and repeated approval of an already completed proposal returns its recorded verification instead of applying it again. After a successful update, clients should invalidate application queries so table, Kanban, and details views show the read-back state.

The currently implemented mutation is an application update limited to status, follow-up date, last-contact date, notes, and rating.

### 5. Guarded remote HTTP MCP

Remote connectors are per-user records containing a name, URL, enabled state, health metadata, and optional encrypted authorization value. Only remote Streamable HTTP(S) transport is supported; local stdio connectors are outside the web deployment boundary.

Before saving and again before connecting, the server:

- rejects URL credentials and fragments;
- requires HTTPS (except an explicit localhost development policy used only when invoked by code);
- resolves DNS and rejects loopback, private, link-local, carrier-grade NAT, multicast, unspecified, and other blocked ranges;
- disables redirects (`redirect: "error"`);
- sends authorization only from the server;
- disables retries and closes the client after use;
- limits discovery to 5 seconds and 50 tools;
- namespaces discovered tool names with the connector name.

Connector discovery is available to the authenticated model through `list_mcp_tools`. `propose_mcp_tool_call` validates the selected user-owned connector and discovered tool, then persists the canonical connector, remote tool name, and arguments. It does not call the remote server. Only the separate owner approval route reconnects and sends the exact stored invocation, records bounded completion evidence, and returns the external result.

## Persistence model

All operator records use PostgreSQL through Prisma. The operator is not available on the optional Firestore application adapter path.

| Record | Purpose | Ownership |
| --- | --- | --- |
| `LlmCredential` | encrypted BYOK credential and safe metadata | `(userId, provider)` unique |
| `AgentThread` / `AgentMessage` | conversation history | required `userId` |
| `AgentRun` | provider/model execution metadata | required `userId` and thread |
| `AgentToolInvocation` | tool audit state and redacted summary | required `userId` and run |
| `ActionProposal` | canonical proposed mutation and lifecycle | required `userId` |
| `AgentVerificationResult` | expected/actual read-back evidence | required `userId`, proposal unique |
| `AgentMcpConnection` | guarded remote connector metadata and encrypted auth | required `userId` |

User deletion cascades to these records. Thread/proposal/connector IDs are always combined with the authenticated user ID in service or repository lookups.

## Deployment and operations

1. Use PostgreSQL and apply the Prisma migration before enabling the console.
2. Generate a dedicated 32-byte encryption key:

   ```bash
   openssl rand -hex 32
   ```

3. Set the resulting 64 hexadecimal characters as `AGENT_SECRET_ENCRYPTION_KEY` in the server's secret manager. Do not expose it through `NEXT_PUBLIC_*`, build logs, or client bundles.
4. Back up the database and encryption key through separate protected systems. Encrypted rows are unrecoverable without the key.
5. Deploy the Next.js server, then let each user add their own provider credential from the authenticated console.

The current envelope is versioned (`v1`) but stores no key identifier. Do not replace the master key while encrypted rows remain. A safe rotation requires application support to decrypt every existing envelope with the old key, re-encrypt with the new key, verify completion, and only then retire the old key.

## Extension rules

New capabilities should preserve these invariants:

- derive tenant identity from the authenticated session, never model input;
- keep provider and connector secrets server-only and purpose-separated;
- expose narrow domain tools, not infrastructure primitives;
- represent every consequential action as a typed, expiring proposal;
- execute only the exact stored payload after separate owner approval;
- use optimistic concurrency and persist read-back verification;
- treat job descriptions, email, websites, model output, and MCP output as untrusted data;
- add bounded execution and redacted audit records for every new tool.

See [AI operator threat model](../security/ai-operator-threat-model.md) for trust boundaries, abuse cases, and residual risks.
