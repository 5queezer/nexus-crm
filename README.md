# Job Tracker

A personal job application tracker built with modern fullstack tooling. Track applications, manage contacts and documents, visualize progress in Kanban view, and never miss a follow-up.

**Live:** [jobs.vasudev.xyz](https://jobs.vasudev.xyz)

---

## Features

- **Table & Kanban Views** — sortable, filterable table or drag & drop Kanban board with optimistic updates
- **Follow-up Reminders** — set dates per application, get overdue alerts
- **Contact Management** — track contacts per application (name, role, email, LinkedIn)
- **Document Storage** — upload PDFs and images, link to applications, shareable download links
- **Share Page** — read-only public view for family/AMS with token-based access
- **Dark / Light / System Theme** — three-way toggle, persisted in localStorage, no flash on load
- **DE/EN Language Switcher** — full i18n via next-intl
- **CSV Export** — one-click export, Excel-compatible
- **Quick Stats** — at-a-glance count by status
- **Google OAuth** — secure login, multi-user with per-user admin roles
- **API Docs** — OpenAPI 3.1 spec with Swagger UI at `/api-docs`

## Tech Stack

- **[Next.js 16](https://nextjs.org)** — App Router, React 19, standalone output
- **[Prisma 6](https://prisma.io)** + PostgreSQL — database (with swappable adapter layer for Firestore)
- **[better-auth](https://better-auth.com)** — Google OAuth
- **[TanStack Table v8](https://tanstack.com/table)** — headless table with sort & filter
- **[TanStack Query v5](https://tanstack.com/query)** — data fetching & cache
- **[@dnd-kit](https://dndkit.com)** — drag & drop for Kanban
- **[next-intl](https://next-intl-docs.vercel.app)** — i18n (DE/EN)
- **[Tailwind CSS v3](https://tailwindcss.com)** — styling with class-based dark mode
- **[Google Cloud Run](https://cloud.google.com/run)** — container hosting
- **[Google Cloud Storage](https://cloud.google.com/storage)** — file storage (optional, falls back to local filesystem)
- **[Neon](https://neon.tech)** — serverless PostgreSQL

## Architecture

### Database Adapter Layer

The data layer uses a factory pattern (`lib/db/index.ts`) that switches between backends at runtime via the `DB_PROVIDER` env var:

- **`prisma`** (default) — Prisma ORM with PostgreSQL
- **`firestore`** — Firebase Admin SDK with Firestore collections

All API routes call `getDb()` which returns a `DatabaseAdapter` interface, making the backend transparent to application code.

### Storage Abstraction

File storage (`lib/storage.ts`) switches between:

- **Google Cloud Storage** — when `GCS_BUCKET` is set
- **Local filesystem** — default fallback, stores in `uploads/`

## Self-Hosting

### Prerequisites
- Node.js 20+
- PostgreSQL database (or [Neon](https://neon.tech) free tier)
- Google OAuth Client ID ([create here](https://console.cloud.google.com/apis/credentials))

### Setup

```bash
git clone https://github.com/5queezer/job-tracker
cd job-tracker
npm install

cp .env.example .env
# Fill in your values in .env

npx prisma db push
npm run build
npm start
```

### Environment Variables

```env
# Database
DB_PROVIDER="prisma"                          # "prisma" or "firestore"
DATABASE_URL="postgresql://user:pass@host/db" # PostgreSQL connection string

# Auth
BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
BETTER_AUTH_URL="https://your-domain.com"
GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxx"
ALLOWED_EMAIL="your@email.com"

# Optional
GCS_BUCKET="your-bucket"                     # omit for local filesystem storage
PUBLIC_READ_TOKEN="random-token"             # token for the /share read-only page
# Note: Admin access is managed per-user in the web UI (no env var needed).
# The first user matching ALLOWED_EMAIL is auto-promoted to admin on first login.
```

### Docker

```bash
docker build -t job-tracker .
docker run -p 8080:8080 --env-file .env job-tracker
```

### GCP Cloud Run (CI/CD)

The repo includes a GitHub Actions workflow (`.github/workflows/deploy-gcp.yml`) that on push to `main`:

1. Pushes Schema updates (`prisma db push`)
2. Builds a Docker image
3. Pushes to Artifact Registry
4. Deploys to Cloud Run with secrets from Secret Manager

Uses Workload Identity Federation — no service account keys needed.

## Application Statuses

| Status | Meaning |
|--------|---------|
| `draft` | Not yet sent |
| `applied` | Submitted |
| `waiting` | Awaiting response |
| `interview` | Interview scheduled/done |
| `offer` | Offer received |
| `rejected` | Rejected |
| `ghost` | No response |
