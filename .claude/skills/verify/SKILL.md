---
name: verify
description: Build, launch and drive Nexus CRM locally to verify UI/behavior changes end-to-end.
---

# Verifying Nexus CRM changes

## Setup (fresh container)

```bash
npm ci
sudo service postgresql start   # Postgres 16 is preinstalled in the CCR image
sudo -u postgres psql -c "CREATE USER nexus WITH PASSWORD 'nexus' SUPERUSER;" \
                     -c "CREATE DATABASE job_tracker OWNER nexus;"
cat > .env <<'EOF'
DB_PROVIDER="prisma"
DATABASE_URL="postgresql://nexus:nexus@localhost:5432/job_tracker"
BETTER_AUTH_SECRET="dev-secret-dev-secret-dev-secret-42"
BETTER_AUTH_URL="http://localhost:3001"
EOF
npx prisma db push
```

## Launch

```bash
npm run dev   # port 3001; NODE_ENV=development enables the auth dev bypass
```

In dev mode `requireAuth()` returns a fake admin (`dev-user`, `dev@localhost`)
when no session exists — no OAuth needed. But that user has no DB row, so
`npm run seed` fails with "No users found". Insert it directly, then either
re-run the seed or insert applications via SQL (table names are PascalCase:
`"User"`, `"Application"`):

```sql
INSERT INTO "User" (id, name, email, "emailVerified", "isAdmin", "createdAt", "updatedAt")
VALUES ('dev-user', 'Dev User', 'dev@localhost', true, true, now(), now());
```

## Drive

Playwright with the preinstalled Chromium (`executablePath:
'/opt/pw-browsers/chromium'`, install `playwright-core` in the scratchpad,
not the repo). Set `localStorage.setItem("onboarding-complete", "true")` in
an init script or the onboarding wizard replaces the dashboard when the DB
is empty.

Gotchas:
- Layout breakpoints: desktop nav + table appear at `lg`; below that it's
  the burger menu and mobile cards. Check 390 / 900 / 1100 / 1280 / 1440.
- Useful layout probe: compare `scrollWidth` vs `clientWidth` on
  `documentElement` (page) and on the table's `overflow-x-auto` wrapper.
- The black "N" circle bottom-left is the Next.js dev overlay, not the app.
