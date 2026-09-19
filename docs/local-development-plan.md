# Local development profile

Approved scope: local PostgreSQL, normal Better Auth email/password sessions, seeded admin and regular users, editable fictional records, one setup command and one web/worker startup command. Production Google login and existing authorization remain in place.

1. Add a shared, fail-closed local-mode guard: explicit opt-in, development runtime, loopback app/database URLs, dedicated database name, and no hosted deployment flags.
2. Add a development-only login form using the existing Better Auth handler and session cookies. Expose only a boolean capability to the browser.
3. Create a private `.env.local` once, preserving existing config and generated secrets. Start a dedicated Compose PostgreSQL volume, generate Prisma, apply committed migrations, and idempotently seed accounts and fictional records.
4. Start web and durable worker together with the same validated environment; stop both on failure or Ctrl+C. Keep uploads local and provider integrations opt-in.
5. Verify rejected unsafe configs, repeat setup without overwrites, real browser sign-in for both roles, session-only APIs, cross-user isolation and production endpoint denial. Run the repository checks and open a stacked PR against #168.
