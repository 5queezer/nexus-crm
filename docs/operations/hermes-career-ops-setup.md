# Hermes Career Ops setup, deployment and rollback

Career Ops bridges Nexus to an external Hermes agent. This runbook covers configuring the Hermes side, running the feature locally against a mock, deploying it on the Hetzner/systemd host, and rolling it back.

It assumes **one topology throughout**: Nexus as the `job-tracker` systemd unit and Hermes on the same host bound to loopback. See section 7 for why, and for what a containerised Nexus would change.

Nothing here contains credentials. Replace every placeholder with your own values and keep them out of version control.

## 0. Prerequisites

- A Hermes Agent installation on (or reachable privately from) the Nexus host.
- A Nexus API token for the user Career Ops will act for, created from **Settings → API token**.
- Nexus migrated to a revision that includes `20260819080000_add_career_ops_session_bridge`.

## 1. Create the `career-ops` Hermes profile

Hermes serves each profile under its own URL prefix (`/p/<profile>/…`) with its own key, which is what lets Career Ops be isolated from any other agent on the same host.

```bash
hermes profile create career-ops     # or: mkdir -p ~/.hermes/profiles/career-ops
```

Give the profile the Career Ops persona and the skills it needs. Keep the toolset as narrow as the work actually requires — see the threat model's T8.

## 2. Enable the profile's API server

In `~/.hermes/profiles/career-ops/config.yaml`:

```yaml
gateway:
  api_server:
    enabled: true
    host: 127.0.0.1        # loopback only; never 0.0.0.0 on a public host
    port: 8642
    cors_origins: ""       # leave empty — the browser must never reach Hermes
    max_concurrent_runs: 4
```

And in `~/.hermes/profiles/career-ops/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=<generate with: openssl rand -hex 32>
```

Use a key that is **not** shared with any other profile. Nexus rejects an unauthenticated `X-Hermes-Session-Key`, so this key is what makes per-user memory scoping safe.

Nexus refuses to enable the feature with an API key (or an explicit `HERMES_CAREER_OPS_SCOPE_SECRET`) shorter than **16 characters**, and reports it unconfigured. That is the same bound its redaction uses: a secret shorter than that is not stripped from upstream text, so a key Nexus accepted but could not redact would ride an error message or a transcript straight into the logs and the browser. `openssl rand -hex 32` is well past it.

## 3. Configure the Nexus MCP server for the profile

Career Ops must read and write Nexus through the Nexus MCP server rather than a duplicated store. Hermes reads MCP servers from the `mcp_servers` key of the profile's **`config.yaml`** — the same file as section 2, not a separate JSON file. Add:

```yaml
mcp_servers:
  nexus:
    url: "https://<your-nexus-host>/api/mcp"     # HTTP transport: `url`, never `command`
    headers:
      Authorization: "Bearer <nexus-api-token>"
    timeout: 120                                  # per tool call, seconds
    connect_timeout: 60                           # initial connection and discovery
```

Restart Hermes afterwards: servers are discovered at startup. Each discovered tool is registered as `mcp_nexus_<tool>` — that prefix is what you name when narrowing the profile's toolset for T8.

The MCP server scopes every operation to the token's owner, so this token defines exactly what Career Ops can reach. Rotate it independently of the Hermes API key.

> **This makes Career Ops a single-user feature per profile.** Because the profile holds one Nexus token, *every* run's tool calls act as that token's owner, whoever started the conversation. Nexus therefore requires you to declare that owner in `HERMES_CAREER_OPS_OWNER_USER_ID` and refuses the feature to everyone else. Without it the feature stays disabled — that is deliberate, so a multi-user deployment cannot silently serve one user's CRM data to another.
>
> Supporting several users means giving each their own Hermes profile and Nexus token, and pointing each user's Nexus at their own profile. That is not covered by this change.

## 4. Verify the Hermes side before touching Nexus

From the Nexus host:

```bash
curl -s http://127.0.0.1:8642/p/career-ops/health
# {"status":"ok","platform":"hermes-agent","version":"…"}

curl -s -H "Authorization: Bearer $API_SERVER_KEY" \
     http://127.0.0.1:8642/p/career-ops/v1/capabilities | jq .features
```

Nexus **requires** `run_submission`, `run_status` and `session_resources`. Without any one of them the status endpoint reports the feature *unavailable* rather than degraded: a run that cannot be submitted, observed, or attached to a session is not usable at all.

Everything else is optional, and Nexus degrades explicitly rather than inventing behavior:

| Feature | Absent means |
|---|---|
| `run_events_sse` | **Polling only.** The drawer does not open a stream it knows will be refused; it settles each run from `run_status`. Answers arrive complete instead of token by token, tool progress is not shown, and an approval reaches the browser only as the denial-only prompt (the operation details ride on the stream, so they cannot be recovered — see the approval section of the architecture doc). |
| `run_stop` | The stop control is hidden. A run then ends only by finishing or by reaching the run timeout. |
| `run_approval_response` | The approval limitation is stated in the drawer; no decision can be submitted from Nexus. |

The event stream is optional on purpose: it is single-consumer and unresumable upstream, so `run_status` is the recovery path in every deployment, and a build without a stream is that recovery path used from the start.

Also confirm the port is *not* reachable from outside the host:

```bash
curl -s --max-time 3 http://<public-ip>:8642/p/career-ops/health && echo "EXPOSED — fix this" || echo "not reachable, good"
```

## 5. Configure Nexus

Server-only variables (see `.env.example`). Never prefix any of them with `NEXT_PUBLIC_`.

| Variable | Required | Default | Purpose |
|---|:--:|---|---|
| `HERMES_CAREER_OPS_ENABLED` | Yes | `false` | Master switch. Anything but `true`/`1` disables the feature. |
| `HERMES_CAREER_OPS_BASE_URL` | Yes | — | Absolute `http(s)` URL of the profile prefix, e.g. `http://127.0.0.1:8642/p/career-ops`. Query strings and fragments are rejected. |
| `HERMES_CAREER_OPS_API_KEY` | Yes | — | The `career-ops` profile's `API_SERVER_KEY`. |
| `HERMES_CAREER_OPS_OWNER_USER_ID` | Yes | — | Nexus user id owning the MCP token the profile uses. Career Ops is available to this user only; unset means disabled. |
| `HERMES_CAREER_OPS_SCOPE_SECRET` | No | the API key | Keys the opaque long-term-memory scope. Set it explicitly if you want conversations to keep their memory scope across an API-key rotation. |
| `HERMES_CAREER_OPS_CONNECT_TIMEOUT_MS` | No | `10000` | Values under 1000 fall back to the default; values over 1 800 000 are clamped. |
| `HERMES_CAREER_OPS_STREAM_IDLE_TIMEOUT_MS` | No | `90000` | Same bounds. |
| `HERMES_CAREER_OPS_RUN_TIMEOUT_MS` | No | `600000` | Same bounds. |

With the URL or key missing, the status endpoint reports `not_configured` and the UI trigger is not rendered — a Nexus deploy with Career Ops unset is a no-op for users.

## 6. Local development with the mock Hermes server

`scripts/mock-hermes.mjs` implements exactly the endpoints Nexus calls, with the same framing as the real server (data-only SSE frames whose discriminator is the JSON `event` field). It runs no model and reaches no network, which makes it safe for CI and for a production-like smoke test.

```bash
node scripts/mock-hermes.mjs
# mock hermes listening on http://127.0.0.1:8642/p/career-ops
```

Then, in another shell:

```bash
export HERMES_CAREER_OPS_ENABLED=true
export HERMES_CAREER_OPS_BASE_URL="http://127.0.0.1:8642/p/career-ops"
export HERMES_CAREER_OPS_API_KEY="dev-key"
# Required. Without it the status endpoint reports `owner_not_configured`,
# the launcher never renders, and none of the scenarios below can be run.
# Use the Nexus user id that owns the API token in the Hermes profile.
export HERMES_CAREER_OPS_OWNER_USER_ID="<your-nexus-user-id>"
npm run dev
```

To find your user id locally:

```bash
psql "$DATABASE_URL" -tAc 'SELECT id, email FROM "User" ORDER BY "createdAt" LIMIT 5;'
```

The mock picks a scenario from the message text:

| Message contains | Behavior |
|---|---|
| `tool` | emits a `tool.started` / `tool.completed` pair before answering |
| `approve` | emits `approval.request` and waits for a decision |
| `slow` | streams slowly, so **Stop** can be exercised |
| `fail` | emits `run.failed` |
| anything else | streams a short canned answer |

Capability degradation can be exercised too:

```bash
MOCK_HERMES_APPROVALS=false node scripts/mock-hermes.mjs   # approvals unsupported
MOCK_HERMES_STOP=false      node scripts/mock-hermes.mjs   # stop unsupported
MOCK_HERMES_EVENTS=false    node scripts/mock-hermes.mjs   # no event stream: polling only
```

## 7. Deploy on the Hetzner/systemd host

**This is the one topology this feature is documented and verified for:** Nexus runs as the `job-tracker` systemd unit directly on the host, and Hermes runs on that same host bound to `127.0.0.1`. Everything above depends on it — the loopback base URL, the "never `0.0.0.0`" rule, and the empty `cors_origins` — because loopback is what keeps the Hermes port unreachable from anywhere but the machine itself. `deploy.sh` is written for exactly this: it builds in place and ends in `systemctl restart`.

The repository also carries a `docker-compose.yml`. Career Ops is **not** set up for it, and the difference is not cosmetic: inside a container `127.0.0.1` is the container, not the host, so `HERMES_CAREER_OPS_BASE_URL` would have to name something reachable across a network boundary — and every guarantee that rests on loopback would then rest on whatever isolates that network instead. Running it that way means re-deriving the transport security yourself. Nothing here has been verified against it.

The existing `deploy.sh` needs no changes; the migration and build are already part of it.

1. Add the `HERMES_CAREER_OPS_*` variables to `/root/job-tracker/.env.production`. Keep the file `chmod 600` and owned by root.
2. Deploy as usual:
   ```bash
   ./deploy.sh          # npm ci → prisma generate → prisma migrate deploy → build → systemctl restart
   ```
   Nine migrations belong to this feature, and every one of them is additive — two new tables, one partial unique index, five nullable columns, one column with a default, and one that makes no schema change at all:

   | Migration | Effect |
   |---|---|
   | `20260819080000_add_career_ops_session_bridge` | creates `CareerOpsThread` and `CareerOpsRun` with their indexes and foreign keys |
   | `20260819124500_add_career_ops_approval_audit` | adds the nullable approval-attribution columns |
   | `20260819170000_career_ops_active_run_invariant` | adds the partial unique index that admits one active run per conversation |
   | `20260819180000_career_ops_approval_challenge` | adds nullable `approvalChallengeId` |
   | `20260819190000_career_ops_approval_state` | adds nullable `approvalState` |
   | `20260819200000_career_ops_pending_approval_challenge` | adds nullable `pendingApprovalChallengeId` |
   | `20260820160000_career_ops_abandoned_status` | no schema change; records the `abandoned` status and asserts the active-run index still excludes it |
   | `20260821080000_career_ops_approval_gate_state` | adds nullable `approvalGateOpenedAt` |
   | `20260821090000_career_ops_request_hash` | adds `requestHash` with a `''` default, so existing rows need no backfill |

   Nothing existing is altered or dropped, so the whole set is safe to apply ahead of enabling the feature.
3. On a **Firestore** deployment (`DB_PROVIDER=firestore`), deploy the index definitions before enabling the feature:
   ```bash
   firebase deploy --only firestore:indexes
   ```
   This adds the `careerOpsThreads` and `careerOpsRuns` composite indexes. A third collection, `careerOpsThreadDeletions`, needs none: it is queried by `userId` alone, which Firestore indexes automatically. It holds one small document per deleted conversation whose run documents are still being collected, and each is removed as soon as they are — a non-empty collection at rest means a cleanup was interrupted and has not been retried yet. The relational backend has no equivalent; there the foreign key cascades.
4. Verify from the host, as a signed-in user:
   ```bash
   curl -s -b "<session-cookie>" https://<nexus-host>/api/career-ops/status
   # {"enabled":true,"available":true,"reason":null,"capabilities":{…}}
   ```
5. Open Nexus and confirm the Career Ops trigger appears, a conversation streams, and the application-scoped entry point on an opportunity shows the right company and role.

### Staged rollout

Deploy with `HERMES_CAREER_OPS_ENABLED=false` first. The routes answer with the disabled status and the UI hides the trigger, so the code path is in production and inert. Flip the flag and restart when the Hermes side has been verified.

## 8. Rollback

**Fastest, no schema change:**

```bash
# in the deployment env file
HERMES_CAREER_OPS_ENABLED=false
systemctl restart job-tracker
```

The trigger disappears, every route returns the controlled unavailable status, and no upstream request is made. Existing thread and run mappings stay in place, so re-enabling restores the conversations.

**Reverting the code:** deploy the previous commit. The two tables are inert without the feature — leaving them is safe, and no down-migration is required to roll back.

**Removing the data,** only if you deliberately want the mappings gone (this is destructive and irreversible):

```sql
DROP TABLE "CareerOpsRun";
DROP TABLE "CareerOpsThread";
```

On Firestore, delete the `careerOpsRuns`, `careerOpsThreads` and `careerOpsThreadDeletions` collections. Hermes-side sessions are not removed by this; delete them through Hermes if required.

**Rotating a leaked Hermes key:** set a new `API_SERVER_KEY` on the profile, restart Hermes, update `HERMES_CAREER_OPS_API_KEY`, restart Nexus. Unless `HERMES_CAREER_OPS_SCOPE_SECRET` is set explicitly, this also changes the derived memory scope, so conversations start a fresh long-term memory scope — set that variable first if you want to avoid it.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Trigger never appears | `HERMES_CAREER_OPS_ENABLED` is not `true`, the URL/key is missing, or `HERMES_CAREER_OPS_OWNER_USER_ID` is unset. Check `GET /api/career-ops/status`. |
| Status `owner_not_configured` | `HERMES_CAREER_OPS_OWNER_USER_ID` is not set. |
| Trigger missing for one user only | That user is not the MCP token owner. This is intended — see section 3. |
| Status `invalid_base_url` | The URL is relative, has a non-`http(s)` scheme, or carries a query string or fragment. |
| Status `unreachable` | Hermes is down, bound to a different interface, or blocked. Check `/health` from the Nexus host. |
| Status `degraded` | Hermes answered `/health` with a non-`ok` status. |
| Status `unsupported` | The connected Hermes does not advertise run submission or session resources. |
| All calls fail with 503 | Hermes rejected the Nexus bearer token. Confirm the profile key matches `HERMES_CAREER_OPS_API_KEY`. |
| No stop button | The connected Hermes does not advertise `run_stop`. This is reported honestly in the drawer. |
| Drawer shows "connection lost" | The event stream dropped. Hermes' run stream is single-consumer and cannot be resumed, so Nexus settles from run status instead — see the architecture doc. |

## Related documents

- [Architecture](../architecture/hermes-career-ops.md)
- [Threat model](../security/hermes-career-ops-threat-model.md)
- OpenSpec change: `openspec/changes/integrate-hermes-career-ops/`
