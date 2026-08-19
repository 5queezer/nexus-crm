# Hermes Career Ops setup, deployment and rollback

Career Ops bridges Nexus to an external Hermes agent. This runbook covers configuring the Hermes side, running the feature locally against a mock, deploying it on the Hetzner/systemd host, and rolling it back.

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

## 3. Configure the Nexus MCP server for the profile

Career Ops must read and write Nexus through the Nexus MCP server rather than a duplicated store. Add it to the profile's MCP configuration:

```json
{
  "mcpServers": {
    "nexus": {
      "url": "https://<your-nexus-host>/api/mcp",
      "headers": { "Authorization": "Bearer <nexus-api-token>" }
    }
  }
}
```

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

Nexus needs `run_submission`, `run_status`, `run_events_sse`, and `session_resources`. `run_stop` and `run_approval_response` are optional — when absent, Nexus hides the stop control and states the approval limitation rather than inventing behavior.

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
npm run dev
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
```

## 7. Deploy on the Hetzner/systemd host

The existing `deploy.sh` needs no changes; the migration and build are already part of it.

1. Add the `HERMES_CAREER_OPS_*` variables to the deployment env file (`/root/job-tracker/.env.production` or the Compose service environment). Keep the file `chmod 600` and owned by root.
2. Deploy as usual:
   ```bash
   ./deploy.sh          # npm ci → prisma generate → prisma migrate deploy → build → systemctl restart
   ```
   `20260819080000_add_career_ops_session_bridge` and `20260819124500_add_career_ops_approval_audit` are additive: they create `CareerOpsThread` and `CareerOpsRun` and add two nullable approval-attribution columns, altering nothing existing, so both are safe to apply ahead of enabling the feature.
3. On a **Firestore** deployment (`DB_PROVIDER=firestore`), deploy the index definitions before enabling the feature:
   ```bash
   firebase deploy --only firestore:indexes
   ```
   This adds the `careerOpsThreads` and `careerOpsRuns` composite indexes.
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

On Firestore, delete the `careerOpsRuns` and `careerOpsThreads` collections. Hermes-side sessions are not removed by this; delete them through Hermes if required.

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
