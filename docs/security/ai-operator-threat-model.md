# AI operator threat model

This document covers the Nexus AI operator console, its per-user model credentials, tenant-scoped career data tools, action proposals, and remote HTTP MCP connectors. It describes the implemented controls and calls out residual risk rather than treating an LLM prompt as a security boundary.

## Assets and security objectives

| Asset | Objective |
| --- | --- |
| Provider API keys | Confidentiality; use only for the owning user's provider requests |
| MCP authorization values | Confidentiality; send only to the owning connector's validated destination |
| Applications and career history | Tenant isolation and integrity |
| Threads and messages | Tenant isolation and confidentiality |
| Proposals and verification records | Integrity, ownership, idempotency, and auditability |
| Agent/run/tool metadata | Accurate status without secret-bearing payloads |
| `AGENT_SECRET_ENCRYPTION_KEY` | Server-only confidentiality and recoverability |

## Trust boundaries

1. **Browser → Next.js API.** Requests, IDs, provider selections, messages, and approval clicks are untrusted until authenticated and validated.
2. **Next.js → model provider.** The selected provider receives the owning user's prompt context and decrypted API key. Provider retention and processing are governed by that provider and the user's account.
3. **Agent runtime → Nexus domain layer.** The model can select only registered tools. Server code supplies tenant identity and enforces schemas and policy.
4. **Next.js → remote MCP server.** The remote service, its DNS, tool descriptions, schemas, and outputs are untrusted. Connector authorization must not cross destinations.
5. **Application → PostgreSQL and secret manager.** PostgreSQL contains user data and authenticated-encryption envelopes. The secret manager contains the master key; compromise of both enables decryption.
6. **Public showcase → authenticated product.** Public source, docs, and screenshots must contain synthetic or redacted content. They do not grant public access to the operator or its data.

## Threats and controls

### Cross-tenant object access (IDOR)

**Threat:** An attacker supplies another user's thread, proposal, credential, connector, run, or application ID.

**Controls:**

- API routes derive `userId` from a Better Auth browser session with development bypass disabled.
- AI credential, chat, thread, connector, proposal-list, approval, and rejection routes reject API/OAuth bearer tokens so delegated integrations cannot silently obtain interactive secret-management or approval authority.
- Repositories combine record ID/provider/name with `userId` for reads, updates, and deletes.
- Agent application reads pass the authenticated user ID to the domain adapter.
- Proposal approval resolves and transitions the proposal under the same user ID.
- Agent records have required ownership fields and user-deletion cascades.
- Agent code does not inherit the existing administrator-wide read scope.

**Residual risk:** Every new repository method and nested relation must retain the ownership predicate. IDs are not capabilities.

### Provider-key disclosure

**Threat:** A key leaks through API responses, logs, errors, chat history, model context, browser storage, or database disclosure.

**Controls:**

- Keys are accepted only by the authenticated server endpoint and are not returned after storage.
- AES-256-GCM uses a random 96-bit IV, authentication tag, version/purpose additional authenticated data, and a purpose-derived key (`llm:<provider>`).
- API metadata exposes only a last-four-character hint.
- Decryption occurs only when constructing the server-side provider client.
- Provider errors pass through explicit secret and common token-pattern redaction before logging; users receive a generic failure.
- There is no Nexus-owned fallback provider key.

**Residual risk:** The application process can decrypt keys and is therefore sensitive. A server compromise, malicious dependency, unsafe instrumentation, heap dump, or simultaneous database/master-key compromise can expose them. Redaction is defense in depth, not proof that arbitrary future errors are safe.

### Master-key loss or unsafe rotation

**Threat:** Losing the master key makes credentials unavailable; replacing it in place makes existing envelopes undecryptable.

**Controls:**

- The server fails closed unless `AGENT_SECRET_ENCRYPTION_KEY` is exactly 64 hexadecimal characters (32 bytes).
- Envelopes are versioned and purpose-bound.
- Setup documentation requires protected backup and forbids client exposure.

**Residual risk:** The current envelope has no key ID or multi-key decrypt support. Rotation requires a controlled re-encryption migration while the old key remains available. Restoring a database backup also requires the matching key backup.

### Prompt injection and confused deputy behavior

**Threat:** A job description, email, website, user message, provider response, or MCP result instructs the model to reveal secrets or perform an unauthorized action.

**Controls:**

- These sources are explicitly classified as untrusted data in the system prompt and architecture.
- Secrets are not included in tool outputs or model context.
- The model receives a fixed, narrow tool registry; it has no database, shell, filesystem, browser, or direct HTTP primitive.
- Server schemas, ownership checks, and proposal policy—not prompt text—decide what can execute.
- Mutation tools create proposals only. The model cannot call the approval endpoint or approve its own proposal.

**Residual risk:** Untrusted content can still influence answers or cause nuisance proposals. Users must review displayed diffs and assumptions; the approval interface must never imply that model-generated rationale is trusted evidence.

### Unauthorized or stale mutation

**Threat:** The model writes directly, approval arguments are changed, a stale proposal overwrites newer data, or a retry applies twice.

**Controls:**

- The only implemented mutation tool stores an `ActionProposal`; it does not update Nexus.
- Approval is a separate authenticated request by the proposal owner.
- Execution uses the canonical stored payload, not fresh model output or client-supplied changes.
- Proposal status, expiry, target ownership, operation kind, and base `updatedAt` are checked before execution.
- Conditional status transition from `pending` to `executing` claims the proposal.
- The domain update receives `expectedUpdatedAt` for optimistic concurrency.
- Per-user idempotency keys and completed-result replay prevent duplicate application.
- The executor reads the record back, compares every expected field, and persists expected, actual, and mismatch evidence.
- Once a consequential dispatch starts, `outcome_unknown` is persisted before verification; post-dispatch transport or bookkeeping failures are never mislabeled as definitive failures or automatically retried.

**Residual risk:** The database adapter's optimistic update and proposal state transition are separate operations rather than one cross-table transaction. A process failure can leave an `executing` or `outcome_unknown` proposal requiring operational reconciliation. Verification failure means the write was attempted; it must not be presented as a rollback.

### SSRF, DNS rebinding, and credential forwarding through MCP

**Threat:** A connector targets internal services or cloud metadata, resolves to a non-public address, redirects after validation, or captures authorization meant for another host.

**Controls:**

- Only HTTP(S) URL parsing is accepted; production requires HTTPS.
- Embedded credentials and fragments are rejected.
- DNS is resolved before connect, every returned address must pass public-address policy, and the validated address is pinned in the HTTP transport while the original hostname remains the TLS SNI/Host identity.
- Blocked IPv4 ranges include unspecified, private, carrier-grade NAT, loopback, link-local, benchmarking, and multicast space; IPv4-mapped IPv6 forms plus IPv6 unspecified, loopback, unique-local, link-local, and multicast are blocked.
- Redirects fail rather than forwarding headers.
- Connector records and encrypted authorization are per-user; authorization is decrypted and attached only server-side.
- MCP clients use no retries and are closed in `finally` blocks.
- Discovery has a five-second timeout and a 50-tool limit; tool names are connector-namespaced.
- MCP tool discovery is model-accessible, but invocation is not direct: the model can only persist a proposal containing canonical schema-validated arguments, argument/schema hashes, and the connector version. The approval UI exposes those arguments, and approval rejects connector or schema changes as stale before sending the exact reviewed invocation.
- Changing a connector to a different origin without a replacement authorization clears the prior authorization rather than forwarding it to the new host.
- Transport responses are byte-limited while streaming, before the SDK buffers or parses the complete payload.

**Residual risk:** Application filtering is defense in depth, not a substitute for network egress controls. Operators should also block private/link-local destinations at the host or network layer. Connector endpoints may log requests and returned data, and a public endpoint can still return misleading or hostile content within the bounded response.

### Denial of service and cost abuse

**Threat:** Long prompts, repeated runs, tool loops, slow providers, or hostile MCP services consume compute or the user's provider budget.

**Controls:**

- Chat and connector inputs have Zod length/schema limits.
- Runs are capped at six steps and 60 seconds, with per-step/tool/chunk limits and one provider retry.
- MCP discovery is time- and tool-count-bounded; calls use a 15-second timeout.
- Existing application middleware rate limits API routes.
- BYOK assigns provider usage to the user's own account.

**Residual risk:** Generic rate limits may not be sufficient for expensive model traffic, and there are no documented per-user token/cost quotas. Streaming connections and provider-side retries can still incur cost. Production operators should monitor per-user run volume, provider usage, latency, and failure rates.

### Audit-log poisoning and secret persistence

**Threat:** Attacker-controlled strings create misleading audit records or place credentials in persisted tool input/chat content.

**Controls:**

- Tool names and kinds are server-defined.
- Tool schemas constrain structured input.
- Tool records store completion summaries and error codes rather than raw provider/MCP responses.
- MCP proposal audit records omit unvalidated arguments and free-text rationale; only connector/tool identifiers and an omission marker are persisted before connector lookup, discovery, canonical schema validation, and sensitive-key/value validation.
- Accepted MCP proposals persist only canonical, size-bounded, sensitive-key-and-value-screened arguments.
- Provider and connector credentials are omitted from metadata responses and model context.
- Hidden chain-of-thought is not stored.

**Residual risk:** User messages and bounded application context are intentionally sent to the selected provider and persisted in Nexus; users can still paste secrets despite the in-product warning. Tool timeline serialization uses explicit metadata fields and omits tool inputs, and any future observability export must preserve field-level allowlists rather than broad event serialization.

### Supply-chain and provider risk

**Threat:** A compromised npm dependency, model provider, MCP endpoint, or deployment artifact accesses sensitive process memory or data.

**Controls:**

- Provider construction and MCP transport are isolated behind small server modules.
- Provider/model combinations are allowlisted.
- MCP is remote HTTP only; arbitrary local processes are not launched.
- Package versions are lockfile-pinned for reproducible installation.

**Residual risk:** Third parties remain trusted processors. Dependency review, lockfile scanning, rapid patching, provider account controls, and connector allowlisting are operational responsibilities.

## Security assumptions

- TLS terminates at a trusted reverse proxy or the Next.js deployment.
- Better Auth session configuration and CSRF/origin protections are correctly deployed.
- PostgreSQL, backups, logs, and the environment secret store are access-controlled.
- Production does not invoke any local-development MCP exception.
- Public screenshots use non-sensitive demonstration data.
- Users understand that selected conversation/application context is sent to their chosen model provider.

## Operational checklist

### Before enabling the operator

- [ ] Apply the additive Prisma migration on PostgreSQL.
- [ ] Generate `AGENT_SECRET_ENCRYPTION_KEY` with `openssl rand -hex 32`.
- [ ] Store the key in a server-side secret manager and create a separately protected backup.
- [ ] Confirm the value is absent from `NEXT_PUBLIC_*`, client bundles, logs, and CI output.
- [ ] Enforce HTTPS for Nexus and outbound MCP connectors.
- [ ] Add host/network egress rules blocking private and link-local networks.
- [ ] Verify public screenshots and seed data contain no personal information or credentials.
- [ ] Configure monitoring for failed decryptions, rejected destinations, stale proposals, runs stuck in `executing`, provider failures, and unusual per-user run volume.

### Incident response

1. Disable the operator routes or UI if secret exposure or cross-tenant access is suspected.
2. Revoke affected provider keys and connector credentials at their issuers.
3. Preserve redacted run/proposal/audit evidence; do not copy raw secrets into tickets.
4. If the master key may be compromised, treat all encrypted agent credentials as exposed, rotate them at providers, and replace stored credentials.
5. If only the master key is lost, restore the matching protected key backup; changing the value will not recover existing records.
6. Reconcile proposals left in `executing` against application state and verification records before allowing retries.

## Out of scope

The first release does not provide unattended scheduled agents, automatic job submission, external messaging, local stdio MCP, direct model database access, or public unauthenticated conversations. Remote MCP invocations remain human-approved and are not available as direct model-executable tools.
