# Nexus CRM

A lead and opportunity management suite for tracking your sales pipeline. Manage applications across a Kanban board or sortable table, store documents, track contacts, scan emails for leads, and integrate with AI agents via a built-in MCP server.

**Live:** [jobs.vasudev.xyz](https://jobs.vasudev.xyz)

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Testing](#testing)
- [API](#api)
- [MCP Server](#mcp-server)
- [Deployment](#deployment)
- [Pipeline Stages](#pipeline-stages)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **Table & Kanban Views** — sortable, filterable table powered by TanStack Table, or drag-and-drop Kanban board with optimistic updates via @dnd-kit
- **Follow-up Reminders** — set per-opportunity follow-up dates with overdue alerts
- **Contact Management** — track contacts per opportunity (name, role, email, phone, LinkedIn)
- **Document Storage** — upload PDFs and images, link to opportunities, shareable download links
- **Client Portal** — read-only public share page with short-code URLs
- **Analytics Dashboard** — interactive pipeline statistics and insights
- **Resume Review** — AI-powered resume analysis and job matching
- **Resume Tailoring** — duplicate and tailor resumes per application via Reactive Resume integration
- **Dark / Light / System Theme** — three-way toggle, persisted in localStorage, flash-free
- **DE / EN Language Switcher** — full i18n via next-intl (default: German)
- **CSV Export** — one-click export, Excel-compatible
- **Bulk Archive** — archive old or low-rated applications by age or star rating
- **Google OAuth** — secure login, multi-user with per-user admin roles
- **Email Intelligence** — Gmail integration to auto-detect and import client communications
- **MCP Server** — Model Context Protocol endpoint for AI agent integration (OAuth 2.1 + PKCE)
- **API Docs** — OpenAPI 3.1 spec with Swagger UI at `/api-docs`, LLM-friendly guide at `/llm.txt`
- **Rate Limiting** — per-IP rate limits on all API routes with standard headers
- **Security Hardened** — CSP, HSTS, X-Frame-Options, gitleaks pre-commit hooks, encrypted email tokens

---

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| **Framework** | [Next.js 16](https://nextjs.org) — App Router, React 19, standalone output |
| **Database** | [Prisma 6](https://prisma.io) + PostgreSQL (swappable adapter for Firestore) |
| **Auth** | [better-auth](https://better-auth.com) — Google OAuth, session cookies |
| **Data Fetching** | [TanStack Query v5](https://tanstack.com/query) — caching, optimistic UI |
| **Table** | [TanStack Table v8](https://tanstack.com/table) — headless sort & filter |
| **Drag & Drop** | [@dnd-kit](https://dndkit.com) — Kanban board |
| **i18n** | [next-intl](https://next-intl-docs.vercel.app) — DE / EN |
| **Styling** | [Tailwind CSS v3](https://tailwindcss.com) — class-based dark mode |
| **Validation** | [Zod 4](https://zod.dev) — runtime schema validation |
| **AI Integration** | [@modelcontextprotocol/sdk](https://modelcontextprotocol.io) — MCP server |
| **File Storage** | Google Cloud Storage or local filesystem |
| **Hosting** | [Google Cloud Run](https://cloud.google.com/run) — container hosting |
| **Database Hosting** | [Neon](https://neon.tech) — serverless PostgreSQL |
| **Testing** | [Vitest 4](https://vitest.dev) |
| **CI/CD** | GitHub Actions — lint, build, test, deploy to Cloud Run |

---

## Prerequisites

- **Node.js 22+** (matches the Docker image; 20+ works locally)
- **PostgreSQL 15+** — or a hosted provider like [Neon](https://neon.tech) (free tier available)
- **Google OAuth Client ID** — [create one here](https://console.cloud.google.com/apis/credentials)
- **npm** — used as the package manager (see `.npmrc`)

Optional:

- **Docker** — for containerized deployment
- **pre-commit** — for git hooks (`pip install pre-commit && pre-commit install`)
- **gitleaks** — for secrets scanning (used by pre-commit hook)

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/5queezer/job-tracker.git
cd job-tracker
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your values. See [Environment Variables](#environment-variables) for the full reference.

At minimum, you need:

- `DATABASE_URL` — a PostgreSQL connection string
- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
- `BETTER_AUTH_URL` — your app's public URL (use `http://localhost:3001` for local dev)
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — from Google Cloud Console
- `ALLOWED_EMAIL` — comma-separated list of emails permitted to log in

### 4. Database Setup

Push the Prisma schema to your database:

```bash
npx prisma db push
```

This creates all tables. For an existing database with prior migrations:

```bash
npx prisma migrate deploy
```

Generate the Prisma client (usually automatic after `npm install`):

```bash
npx prisma generate
```

### 5. Start Development Server

```bash
npm run dev
```

Opens at [http://localhost:3001](http://localhost:3001).

In development mode, if no Google OAuth session exists, a fake admin user (`dev@localhost`) is automatically used — no OAuth setup required to start coding.

---

## Architecture

### Directory Structure

```text
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Main dashboard (server component)
│   ├── layout.tsx                # Root layout with i18n + theme
│   ├── providers.tsx             # TanStack Query provider
│   ├── analytics/                # Analytics dashboard page
│   ├── api/                      # API routes
│   │   ├── applications/         # CRUD + contacts + documents + tailor
│   │   ├── auth/[...all]/        # better-auth catch-all handler
│   │   ├── documents/            # Document upload, download, metadata
│   │   ├── email/                # Gmail OAuth + scanning
│   │   ├── mcp/                  # MCP server + OAuth 2.1 endpoints
│   │   ├── admin/                # User management + audit logs
│   │   ├── share-links/          # Short-code share link management
│   │   └── token/                # API token generation
│   ├── api-docs/                 # Swagger UI page
│   ├── documents/                # Document management page
│   ├── resume-review/            # AI resume review page
│   ├── s/[code]/                 # Short-code share link resolver
│   ├── settings/                 # User settings page
│   └── share/                    # Public read-only portal
├── components/                   # React client components
│   ├── dashboard.tsx             # Main dashboard with table/kanban toggle
│   ├── application-table.tsx     # TanStack Table view
│   ├── kanban-view.tsx           # Drag-and-drop Kanban board
│   ├── application-modal.tsx     # Create/edit application modal
│   ├── analytics-dashboard.tsx   # Charts and pipeline stats
│   ├── documents-client.tsx      # Document manager
│   ├── email-integration.tsx     # Gmail connection UI
│   ├── scanned-emails.tsx        # Email scan results
│   ├── resume-analyzer.tsx       # Resume review component
│   ├── app-header.tsx            # Shared navigation header
│   ├── settings-client.tsx       # Settings page (admin, tokens, email)
│   └── ...                       # Theme, language, audit, API token components
├── lib/                          # Server-side utilities
│   ├── auth.ts                   # better-auth configuration
│   ├── session.ts                # Auth middleware (session + Bearer + dev bypass)
│   ├── db/                       # Database adapter layer
│   │   ├── adapter.ts            # DatabaseAdapter interface
│   │   ├── index.ts              # Factory: getDb() → Prisma or Firestore
│   │   ├── prisma-adapter.ts     # PostgreSQL implementation
│   │   ├── firestore-adapter.ts  # Firestore implementation
│   │   └── types.ts              # Shared record types
│   ├── storage.ts                # File storage (GCS or local filesystem)
│   ├── mcp-oauth.ts              # MCP OAuth 2.1 server implementation
│   ├── email/                    # Email scanning pipeline
│   │   ├── gmail.ts              # Gmail API client
│   │   ├── scanner.ts            # Email scanning orchestrator
│   │   ├── classifier.ts         # Email classification logic
│   │   └── encryption.ts         # AES-256-GCM token encryption
│   ├── rate-limit.ts             # In-memory rate limiter (LRU)
│   ├── token.ts                  # API token hashing utilities
│   ├── reactive-resume.ts        # Reactive Resume API client
│   ├── resume-analysis.ts        # AI resume analysis
│   └── logger.ts                 # Logging utility
├── prisma/
│   ├── schema.prisma             # Database schema
│   ├── seed.ts                   # Database seeder
│   └── migrations/               # SQL migration history
├── messages/
│   ├── de.json                   # German translations
│   └── en.json                   # English translations
├── i18n/
│   └── request.ts                # Locale detection (cookie-based, default: de)
├── types/
│   └── index.ts                  # Shared TypeScript types + status validation
├── public/
│   ├── openapi.json              # OpenAPI 3.1 spec
│   └── llm.txt                   # LLM-friendly API guide
├── middleware.ts                  # Rate limiting middleware
├── Dockerfile                    # Multi-stage production build
├── docker-compose.yml            # Self-hosted deployment
└── .github/workflows/
    ├── ci.yml                    # Lint + build + test
    └── deploy-gcp.yml            # Cloud Run CI/CD
```

### Database Adapter Layer

The data layer uses a factory pattern (`lib/db/index.ts`). The `DB_PROVIDER` env var selects the backend at runtime:

- **`prisma`** (default) — Prisma ORM with PostgreSQL
- **`firestore`** — Firebase Admin SDK with Firestore

All API routes call `getDb()` which returns a `DatabaseAdapter` interface. Swapping backends requires zero code changes.

### Storage Abstraction

File storage (`lib/storage.ts`) switches between:

- **Google Cloud Storage** — when `GCS_BUCKET` is set
- **Local filesystem** — default, stores in `uploads/`

### Authentication Flow

1. **Google OAuth** via better-auth → session cookie
2. **API tokens** — per-user Bearer tokens (`jt_` prefix), generated in the dashboard
3. **MCP OAuth 2.1** — full authorization code flow with PKCE for AI agent integration (`mcp_at_` prefix)
4. **Dev bypass** — in development, a fake admin user is used when no session exists

Admins bypass per-user data scoping. The first user matching `ALLOWED_EMAIL` is auto-promoted to admin.

### Request Lifecycle

```text
Request → middleware.ts (rate limiting) → API route handler
  → requireAuth() (session/Bearer/dev)
  → getDb() (database adapter)
  → Response with rate-limit headers
```

### Database Schema

```text
User ─────────────┬── Application ──┬── Contact
  │                │                 └── Document (M:N)
  ├── Session      ├── Document
  ├── Account      └── (via userId)
  ├── UserApiToken
  ├── ShareLink
  ├── EmailIntegration
  ├── ScannedEmail
  ├── McpAccessToken
  └── AdminAuditLog (actor + target)

McpOAuthClient
McpAuthCode
McpRefreshToken
Verification
```

Key relationships:

- Applications belong to a User and have many Contacts
- Documents belong to a User and link to many Applications (M:N)
- Each User has at most one EmailIntegration (encrypted Gmail refresh token)
- MCP OAuth tables handle the full authorization code + refresh token flow

---

## Environment Variables

### Required

| Variable | Description | Example |
| -------- | ----------- | ------- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/nexus` |
| `BETTER_AUTH_SECRET` | Session encryption secret | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public URL of the app | `https://jobs.vasudev.xyz` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | `GOCSPX-xxx` |
| `ALLOWED_EMAIL` | Comma-separated allowed emails | `user@example.com,other@example.com` |

### Optional

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `DB_PROVIDER` | Database backend (`prisma` or `firestore`) | `prisma` |
| `GCS_BUCKET` | Google Cloud Storage bucket name (omit for local filesystem) | — |
| `UPLOAD_DIR` | Local upload directory path | `./uploads` |
| `PUBLIC_READ_TOKEN` | Token for the read-only client portal | — |
| `RR_API_URL` | Reactive Resume API URL | — |
| `RR_API_KEY` | Reactive Resume API key | — |
| `RR_BASE_RESUME_ID` | Base resume to duplicate for tailoring | — |

### Development

```env
DB_PROVIDER="prisma"
DATABASE_URL="postgresql://localhost:5432/nexus_dev"
BETTER_AUTH_SECRET="dev-secret-change-me"
BETTER_AUTH_URL="http://localhost:3001"
GOOGLE_CLIENT_ID="your-client-id"
GOOGLE_CLIENT_SECRET="your-client-secret"
ALLOWED_EMAIL="you@example.com"
```

In development mode, OAuth is bypassed — you can use the app without configuring Google credentials.

---

## Available Scripts

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Start development server on port 3001 (with Turbopack) |
| `npm run build` | Production build (standalone output) |
| `npm start` | Start production server on port 3001 |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest test suite |
| `npm run seed` | Seed the database (`tsx prisma/seed.ts`) |
| `npx prisma studio` | Open Prisma Studio (database GUI) |
| `npx prisma db push` | Push schema changes to the database |
| `npx prisma migrate dev` | Create and apply a migration |
| `npx prisma generate` | Regenerate Prisma client |

---

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npx vitest

# Run a specific test file
npx vitest lib/__tests__/rate-limit.test.ts
```

### Test Structure

```text
lib/__tests__/
├── rate-limit.test.ts         # Rate limiter unit tests
└── token.test.ts              # Token hashing tests

lib/db/__tests__/
└── firestore-adapter.test.ts  # Firestore adapter tests

lib/email/__tests__/
├── classifier.test.ts         # Email classification tests
└── encryption.test.ts         # AES-256-GCM encryption tests

types/__tests__/
└── index.test.ts              # Type validation tests
```

Tests use Vitest with the `@` path alias configured to the project root.

---

## API

### OpenAPI Documentation

- **Swagger UI**: [/api-docs](https://jobs.vasudev.xyz/api-docs) — interactive API explorer
- **OpenAPI spec**: [/openapi.json](https://jobs.vasudev.xyz/openapi.json) — machine-readable spec
- **LLM guide**: [/llm.txt](https://jobs.vasudev.xyz/llm.txt) — plain-text API reference for AI agents

### Authentication

| Method | How | Scope |
| ------ | --- | ----- |
| Session cookie | Google OAuth login at `/login` | Full access |
| Bearer token | `Authorization: Bearer jt_<token>` | Owner's data (admin: all data) |
| MCP OAuth | `Authorization: Bearer mcp_at_<token>` | Owner's data via MCP |
| Share token | Query param on `/share` | Read-only portal |

Generate API tokens in the dashboard under Settings. Tokens are shown once and stored as SHA-256 hashes.

### Endpoints

#### Applications
| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/applications` | List all (paginated, filtered by user) |
| `POST` | `/api/applications` | Create application |
| `GET` | `/api/applications/:id` | Get single application |
| `PATCH` | `/api/applications/:id` | Update application |
| `DELETE` | `/api/applications/:id` | Delete application |

#### Contacts (nested under application)
| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/applications/:id/contacts` | List contacts |
| `POST` | `/api/applications/:id/contacts` | Add contact |
| `PATCH` | `/api/applications/:id/contacts/:cid` | Update contact |
| `DELETE` | `/api/applications/:id/contacts/:cid` | Delete contact |

#### Documents
| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/documents` | List documents |
| `POST` | `/api/documents` | Upload (multipart/form-data) |
| `PATCH` | `/api/documents/:id` | Rename or update application links |
| `DELETE` | `/api/documents/:id` | Delete document |
| `GET` | `/api/documents/:id/file` | Download file |

#### Admin (requires `isAdmin`)
| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/admin/users` | List all users |
| `PATCH` | `/api/admin/users/:id` | Update admin status |
| `GET` | `/api/admin/audit-logs` | View audit log |

#### Token Management
| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/token` | Get current token metadata |
| `POST` | `/api/token` | Generate new token |
| `DELETE` | `/api/token` | Revoke token |

### Rate Limits

Rate limits are enforced per IP via middleware:

| Route Group | Limit (req/min) |
| ----------- | --------------- |
| `/api/auth` | 10 |
| `/api/admin` | 20 |
| `/api/email` | 20 |
| `/api/applications` | 60 |
| All other `/api/*` | 30 |

Standard `X-RateLimit-*` and `Retry-After` headers are included on every response.

---

## MCP Server

Nexus CRM exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at `/api/mcp` for AI agent integration.

### Available Tools

| Tool | Description |
| ---- | ----------- |
| `list_applications` | List all applications |
| `get_application` | Get single application by ID |
| `create_application` | Create a new application |
| `update_application` | Update an existing application |
| `delete_application` | Delete an application |
| `batch_upsert_applications` | Create/update up to 50 applications |
| `batch_delete_applications` | Delete up to 50 applications |
| `list_applications_filtered` | List with filters, sorting, field selection |
| `create_contact` | Add contact to application |
| `update_contact` | Update a contact |
| `delete_contact` | Delete a contact |
| `list_documents` | List all documents |
| `get_document` | Get document by ID |
| `update_document_links` | Update document-application links |
| `delete_document` | Delete a document |

### Authentication

The MCP server supports two auth methods:

1. **CRM API token** — use your `jt_` Bearer token from the dashboard
2. **MCP OAuth 2.1** — full authorization code flow with PKCE:
   - Discovery: `GET /.well-known/oauth-authorization-server`
   - Registration: `POST /api/mcp/register`
   - Authorization: `GET /api/mcp/authorize`
   - Token exchange: `POST /api/mcp/token`

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "nexus-crm": {
      "url": "https://jobs.vasudev.xyz/api/mcp",
      "headers": {
        "Authorization": "Bearer jt_<your-token>"
      }
    }
  }
}
```

---

## Deployment

### Docker (Self-Hosted)

Build and run:

```bash
docker build -t nexus-crm .
docker run -p 3001:3001 --env-file .env -e PORT=3001 nexus-crm
```

Or use `docker-compose.yml` for a production setup:

```bash
# Edit .env.production with your values
docker compose up -d
```

The compose file mounts `./data` for the Prisma directory and `./uploads` for file storage.

### GCP Cloud Run (CI/CD)

The repo includes a GitHub Actions workflow (`.github/workflows/deploy-gcp.yml`) that on push to `main`:

1. Pushes schema updates (`prisma db push`)
2. Builds a Docker image
3. Pushes to Artifact Registry (`europe-west1`)
4. Deploys to Cloud Run with secrets from Secret Manager

Uses Workload Identity Federation — no service account keys. Requires these GitHub secrets:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

Cloud Run configuration: 512Mi memory, 1 CPU, 0–2 instances, port 8080.

### Manual / VPS

```bash
npm run build
./deploy.sh   # builds, copies standalone output, restarts systemd service
```

The standalone output (via `next.config.ts` `output: "standalone"`) produces a self-contained `server.js` in `.next/standalone/`.

---

## Pipeline Stages

| Stage | Meaning |
| ----- | ------- |
| `inbound` | New lead |
| `applied` | Contacted |
| `interview` | Negotiation |
| `offer` | Closing |
| `rejected` | Lost |

---

## Troubleshooting

### Database Connection

**Error:** `Can't reach database server`

1. Verify PostgreSQL is running: `pg_isready -h localhost`
2. Check `DATABASE_URL` format: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`
3. For Neon: ensure the connection string includes `?sslmode=require`

### Prisma Issues

**Error:** `Prisma Client not generated`

```bash
npx prisma generate
```

**Error:** `The database schema is not in sync`

```bash
npx prisma db push
```

### Auth Not Working

- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- Ensure `BETTER_AUTH_URL` matches the URL you're accessing (including protocol)
- Check that your email is in `ALLOWED_EMAIL`
- In development, OAuth is bypassed — if you see `Dev User`, auth is intentionally skipped

### Port Already in Use

The app runs on port 3001 by default. If it's taken:

```bash
npm run dev -- -p 3002
```

### Pre-commit Hooks

Install hooks:

```bash
pip install pre-commit
pre-commit install
```

The hooks run gitleaks (secrets scan), ESLint, and general file hygiene checks.

---

## License

Private project. All rights reserved.
