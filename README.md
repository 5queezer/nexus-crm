# 📋 Job Tracker

A personal job application tracker built with modern fullstack tooling. Track your applications, visualize progress in Kanban view, and never miss a follow-up.

**Live:** [jobs.vasudev.xyz](https://jobs.vasudev.xyz)

---

## ✨ Features

- **Table View** — sortable, filterable applications list with status color coding
- **Kanban View** — drag & drop cards between status columns with optimistic UI updates
- **Follow-up Dates** — set reminders per application, get overdue alerts
- **Quick Stats** — at-a-glance count by status
- **CSV Export** — one-click export, Excel-compatible
- **DE/EN Language Switcher** — full i18n via next-intl
- **Google OAuth** — secure login, single-user access

## 🛠 Tech Stack

- **[Next.js 16](https://nextjs.org)** — App Router, SSR, Standalone
- **[TanStack Table v8](https://tanstack.com/table)** — headless table with sort & filter
- **[TanStack Query v5](https://tanstack.com/query)** — data fetching & optimistic updates
- **[@dnd-kit](https://dndkit.com)** — drag & drop for Kanban
- **[Prisma 6](https://prisma.io)** + SQLite — database
- **[better-auth](https://better-auth.com)** — Google OAuth
- **[next-intl](https://next-intl-docs.vercel.app)** — i18n (DE/EN)
- **[Tailwind CSS v3](https://tailwindcss.com)** — styling

## 🚀 Self-Hosting

### Prerequisites
- Node.js 20+
- A Google OAuth Client ID ([create here](https://console.cloud.google.com/apis/credentials))

### Setup

```bash
git clone https://github.com/5queezer/job-tracker
cd job-tracker
npm install

cp .env.example .env
# Fill in your values in .env

npx prisma db push
npx prisma db seed
npm run build
```

### Environment Variables

```env
DATABASE_URL="file:./prisma/dev.db"
BETTER_AUTH_SECRET="your-random-secret"
BETTER_AUTH_URL="https://your-domain.com"
GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxx"
ALLOWED_EMAIL="your@email.com"
```

### Deploy

```bash
bash deploy.sh
```

## 📊 Application Statuses

| Status | Meaning |
|--------|---------|
| `draft` | Not yet sent |
| `applied` | Submitted |
| `waiting` | Awaiting response |
| `interview` | Interview scheduled/done |
| `offer` | Offer received |
| `rejected` | Rejected |
| `ghost` | No response |
