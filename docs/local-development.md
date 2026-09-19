# Local development

This profile runs the real application and authorization code against a dedicated local PostgreSQL database. It enables Better Auth email/password sign-in only for this explicit development profile. Production keeps its existing Google sign-in configuration.

## First run

Requirements: Node.js 22 or newer, npm, and a running local Docker daemon with Docker Compose supporting `up --wait`.

From the repository root:

```bash
npm ci
npm run dev:setup
npm run dev:local
```

Open `http://localhost:3001/login`. Sign in using either account:

| Account | Email | Password in `.env.local` |
| --- | --- | --- |
| Admin | `dev-admin@nexus.local` | `LOCAL_DEV_ADMIN_PASSWORD` |
| Regular user | `dev-user@nexus.local` | `LOCAL_DEV_USER_PASSWORD` |

The setup command generates different random passwords, a database password, an authentication secret and a provider-credential encryption key. They are stored only in the ignored `.env.local`, with owner-only file permissions. The browser receives no passwords or secrets through the local-mode capability endpoint.

The users sign in through Better Auth's ordinary email/password API and receive normal HttpOnly session cookies. Session-only routes, ownership checks and admin permissions stay active. Google OAuth credentials and manually pasted cookies are unnecessary for this profile.

## What the commands do

- `dev:setup`: creates `.env.local` if absent, starts PostgreSQL through `compose.local.yml`, generates Prisma, applies the committed migrations, and seeds the two accounts and three editable fictional records per account.
- `dev:local`: loads and validates the local profile, starts PostgreSQL, then starts Next.js and the durable bulk worker together. Both use the same database. The web server binds to loopback.
- `dev:stop`: stops the profile's PostgreSQL container while retaining its data volume. Stop the foreground web/worker command with Ctrl+C first.

Repeat `dev:setup` safely: it reuses existing secrets and passwords, verifies the stored account credentials, and does not overwrite existing opportunity fields or duplicate fixture events. It reapplies the intended admin/regular roles to these two seed accounts. The fictional records are editable local fixtures, separate from the application's read-only demo-workspace feature.

Ctrl+C stops both web and worker. An unexpected exit of either process also stops its sibling. PostgreSQL remains available until `dev:stop`; no command automatically deletes its volume.

## Ports and configuration

Default ports are 3001 for the app and 55441 for PostgreSQL. Choose different ports on first setup if they are occupied:

```bash
LOCAL_DEV_PORT=3017 LOCAL_DEV_DB_PORT=55447 npm run dev:setup
npm run dev:local
```

The selected ports are saved in `.env.local`. Each checkout gets a separate Compose project and named volume. When editing ports later, keep `LOCAL_DEV_PORT` consistent with `BETTER_AUTH_URL`, and `LOCAL_DEV_DB_PORT` consistent with `DATABASE_URL`.

An existing `.env.local` is never replaced. If it is unrelated, incomplete, shared-readable or points to another database, setup fails with a diagnostic. Use a separate checkout for the local profile or deliberately move your existing configuration yourself. On Unix, `chmod 600 .env.local` repairs file permissions; symlinks are rejected.

Exported connection/credential variables that disagree with the profile cause an error. Unset them before running these commands. The launcher retains essential OS environment variables, takes application settings from the local profile, and prevents other dotenv files from supplying the app's known integration credentials. Docker is invoked with its local `default` context.

SQL query logging is quiet by default; add `PRISMA_LOG_QUERIES=1` to `.env.local` when debugging queries. Uploads use `.dev-local/uploads`. Model providers, remote MCP connections and email integrations need deliberate local configuration; production integration secrets are not inherited from the calling shell.

## Guardrails and limitations

Local login requires `LOCAL_DEV_AUTH=1`, `NODE_ENV=development`, Prisma, loopback app/database URLs and the exact database name `nexus_local_dev`. Database query overrides and hosted/CI environment flags are rejected. The email/password API is disabled in production even if the opt-in flag is accidentally set.

Do not commit `.env.local`, reuse these credentials in production, or change its account passwords without also changing the saved account credentials through an authenticated flow. Setup reports a mismatch instead of silently resetting a password or claiming the credentials work.

The existing `npm run dev` remains available for manually configured development, including normal Google OAuth. This profile does not add a production authentication method or replace the existing deployment Compose file.
