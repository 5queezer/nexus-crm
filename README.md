# Nexus

Nexus is a personal career operations workspace for managing applications, follow-ups, contacts, documents, submissions, interview context, and email-derived activity in one place.

**Live:** [nexus.vasudev.xyz](https://nexus.vasudev.xyz)

## Highlights

- Application pipeline with sortable table and drag-and-drop Kanban views
- Follow-up reminders, contacts, notes, documents, and submission snapshots
- Email intelligence, analytics, resume review, and resume tailoring
- Authenticated MCP server for external AI clients
- Human-in-the-loop AI operator with persistent threads and streamed responses
- Per-user OpenAI or Anthropic credentials encrypted at rest (BYOK)
- Tenant-scoped read tools and reviewable application-update proposals
- Optimistic concurrency, idempotent approval, and read-back verification
- Guarded, per-user remote Streamable HTTP MCP connector discovery
- Responsive German/English interface with light and dark themes

The AI operator is authenticated; the public repository, architecture notes, threat model, and screenshots form the showcase without exposing conversations or career records.

## Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS
- Vercel AI SDK 7 with OpenAI and Anthropic providers
- Prisma 6 and PostgreSQL
- Better Auth with Google OAuth
- TanStack Query and TanStack Table
- Vitest

## Local setup

### Prerequisites

- Node.js 22+
- npm
- PostgreSQL 15+
- Google OAuth credentials for normal sign-in

### Install and configure

```bash
git clone https://github.com/5queezer/nexus-crm.git
cd nexus-crm
npm install
cp .env.example .env
```

Set at least:

```env
DB_PROVIDER="prisma"
DATABASE_URL="postgresql://user:password@localhost:5432/nexus"
BETTER_AUTH_SECRET="replace-with-a-random-secret"
BETTER_AUTH_URL="http://localhost:3001"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
ALLOWED_EMAIL="you@example.com"
AGENT_SECRET_ENCRYPTION_KEY="64-hex-characters"
```

Generate secrets locally:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 32      # AGENT_SECRET_ENCRYPTION_KEY
```

`AGENT_SECRET_ENCRYPTION_KEY` is a server-only key used to encrypt user-owned model credentials and MCP authorization values. Keep it in a secret manager, back it up separately from the database, and never expose it through a `NEXT_PUBLIC_*` variable. Existing encrypted records cannot be decrypted if this value is replaced or lost.

### Prepare the database and run

```bash
npx prisma migrate deploy
npx prisma generate
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). The operator requires the Prisma/PostgreSQL path even when other Nexus application data is configured to use the optional Firestore adapter.

After signing in, add your own supported OpenAI or Anthropic key in the operator setup. Nexus does not provide or fall back to a shared model key.

## AI operator safety model

- Session identity supplies tenant scope; model-provided IDs never grant access.
- Provider and connector secrets remain server-side and are encrypted with purpose-bound AES-256-GCM.
- Read tools expose only pipeline summary, application search, and application detail.
- The model cannot mutate data directly. It creates a canonical, expiring proposal for the user to approve or reject.
- Approval applies the exact stored payload, checks the target version, and persists read-back verification.
- Job content, email, websites, model output, and MCP output are treated as untrusted data.
- Remote MCP targets are HTTPS-only in production, DNS/IP checked, redirect-disabled, tenant-scoped, and bounded.
- Remote MCP discovery and invocation are available; every invocation is first persisted as a reviewable proposal and sends no request until the owning user approves the exact connector, tool name, and arguments.

Read the public design notes:

- [AI operator architecture](docs/architecture/ai-operator-console.md)
- [AI operator threat model](docs/security/ai-operator-threat-model.md)

## Operator showcase

| Persistent chat and approval | Guarded connectors and BYOK |
| --- | --- |
| ![Nexus AI operator desktop chat with approval proposal](docs/screenshots/ai-operator-desktop.png) | ![Nexus AI operator provider and MCP settings](docs/screenshots/ai-operator-settings.png) |

<p align="center">
  <img src="docs/screenshots/ai-operator-mobile.png" alt="Nexus AI operator mobile approval flow" width="320" />
</p>

The screenshots use synthetic demonstration data. No provider credential, connector authorization, conversation, or real application record is included.

## Environment reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection used by Prisma and authentication |
| `BETTER_AUTH_SECRET` | Yes | Better Auth server secret |
| `BETTER_AUTH_URL` | Yes | Public application origin |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client |
| `ALLOWED_EMAIL` | Yes | Comma-separated sign-in allowlist |
| `AGENT_SECRET_ENCRYPTION_KEY` | For AI operator secrets | 32-byte master key encoded as 64 hex characters |
| `DB_PROVIDER` | No | Application data adapter; defaults to `prisma` |
| `GCS_BUCKET` | No | Google Cloud Storage bucket; local storage otherwise |
| `RR_API_URL` / `RR_API_KEY` / `RR_BASE_RESUME_ID` | No | Reactive Resume integration |

See `.env.example` for a copyable template.

## Commands

```bash
npm run dev       # development server on port 3001
npm run build     # production build
npm start         # production server on port 3001
npm run lint      # ESLint
npm test          # Vitest suite
npm run seed      # seed development data
```

## API and MCP

- Swagger UI: `/api-docs`
- OpenAPI document: `/openapi.json`
- LLM-oriented API guide: `/llm.txt`
- Authenticated Nexus MCP endpoint: `/api/mcp`

The built-in MCP server lets external clients operate against Nexus through OAuth. AI operator **remote connectors** are the inverse boundary: Nexus connects server-side to a user's configured remote MCP endpoint. The two surfaces have separate credentials and policies.

Contact imports can use `batch_create_contacts(applicationId, contacts[])` with 1–50 contacts. Each contact accepts `name` plus optional `email`, `phone`, `role`, and `linkedIn`. The tool preserves partial success and returns `{ total, succeeded, failed, results: [{ index, id, operation: "created", error? }] }`.

## Deployment

Apply Prisma migrations before starting the new build, inject secrets at runtime, terminate TLS at the application or a trusted reverse proxy, and keep PostgreSQL plus the encryption key in separately protected backups. Docker and standalone Next.js output are supported by the repository configuration.

## License

MIT
