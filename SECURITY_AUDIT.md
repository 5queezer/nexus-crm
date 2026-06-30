# Security Audit Report

**Date:** 2026-03-12
**Scope:** Full codebase review of job-tracker (Next.js 16 + Prisma/Firestore)

---

## Findings Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | CRITICAL | Timing-unsafe PUBLIC_READ_TOKEN comparison | **Fixed** |
| 2 | CRITICAL | Public token grants access to ALL document files | **Fixed** |
| 3 | CRITICAL | Share page exposes all users' applications | **Fixed 2026-06-30** |
| 4 | HIGH | Incomplete rate limiting (documents, users, token, config) | **Fixed** |
| 5 | HIGH | IP-based rate limiting spoofable via X-Forwarded-For | Noted |
| 6 | HIGH | In-memory rate limiting doesn't scale across instances | Noted |
| 7 | MEDIUM | CSP allows unsafe-inline and unsafe-eval in production | Noted |
| 8 | MEDIUM | Admin bootstrap TOCTOU race condition | Noted |
| 9 | MEDIUM | PUBLIC_READ_TOKEN passed in query string (logged/leaked) | Noted |
| 10 | LOW | Docker compose binds to all interfaces | **Fixed** |
| 11 | LOW | No explicit CORS configuration | Noted |
| 12 | LOW | File extension derived from user input | **Fixed** |

---

## Detailed Findings

### 1. [CRITICAL] Timing-unsafe token comparison — FIXED

**Location:** `app/share/page.tsx:224`, `app/api/documents/[id]/file/route.ts:12`

The `PUBLIC_READ_TOKEN` was compared using JavaScript `===`, which is vulnerable
to timing side-channel attacks. An attacker can measure response time differences
to brute-force the token character by character.

**Fix:** Introduced `safeCompare()` in `lib/token.ts` using Node.js
`crypto.timingSafeEqual` and applied it in the share page.

### 2. [CRITICAL] Public token grants access to ALL document files — FIXED

**Location:** `app/api/documents/[id]/file/route.ts:10-22`

When using the `PUBLIC_READ_TOKEN` query parameter, `readScopeUserId` remained
`null`, causing `getDocument(id, null)` to return any user's document. An
attacker with the public share token could enumerate document IDs (sequential
integers) and download every uploaded file (resumes, PDFs, images).

**Fix:** `app/api/documents/[id]/file/route.ts` now rejects unauthenticated requests
regardless of any `token` query parameter. Authenticated session/Bearer requests
must resolve the document through `loadOwnedDocument(id, auth.readScopeUserId)`.
Public document sharing remains available only through per-link `/s/[code]`
routes, which verify the `ShareLink.userId` against the resolved document owner.

### 3. [CRITICAL] Share page exposes all users' applications — FIXED 2026-06-30

**Location:** `app/share/page.tsx:233`

`listApplications(null)` returns applications across ALL users. In a multi-user
deployment, anyone with the share link sees every user's job applications.

**Fix:** `app/share/page.tsx` now requires a per-user `ShareLink` code and calls
`listApplications(link.userId)` instead of `listApplications(null)`. `/s/[code]`
redirects to `/share?code=...` without embedding the global public token. This
keeps each shared portfolio scoped to the link creator.

### 4. [HIGH] Incomplete rate limiting — FIXED

**Location:** `middleware.ts:50-52`

Only `/api/auth` and `/api/applications` were rate-limited. Unprotected endpoints
included `/api/documents` (10MB file uploads!), `/api/users`, `/api/token`, and
`/api/config/public-token`.

**Fix:** Extended middleware matcher to `/api/:path*` with new `documents` and
`general` rate limit groups (30 req/min each).

### 5. [HIGH] IP-based rate limiting is spoofable — Noted

**Location:** `middleware.ts:4-10`

The middleware trusts `x-forwarded-for` directly. Without a trusted proxy
configuration, attackers can bypass rate limiting by spoofing this header.

**Recommendation:** If deployed behind Cloud Run's load balancer (which sets
the header), consider only trusting the last proxy-appended IP. Alternatively,
use Cloud Run's built-in rate limiting or Cloud Armor.

### 6. [HIGH] In-memory rate limiting doesn't scale — Noted

**Location:** `lib/rate-limit.ts`, `.github/workflows/deploy-gcp.yml:59`

Cloud Run is configured with `max-instances: 2`. The LRU cache is per-process,
so rate limits are not shared. Attackers hitting different instances get
double the allowed rate.

**Recommendation:** For multi-instance deployments, use Redis or Cloud
Memorystore for shared rate limit state.

### 7. [MEDIUM] CSP allows unsafe-inline and unsafe-eval — Noted

**Location:** `next.config.ts:15`

`script-src 'unsafe-inline' 'unsafe-eval'` effectively negates XSS protection
from CSP. The comment says it's for Next.js dev mode, but this configuration
ships to production.

**Recommendation:** Use nonce-based CSP for Next.js production builds. Next.js
16 supports `nonce` configuration in `next.config.ts`.

### 8. [MEDIUM] Admin bootstrap race condition — Noted

**Location:** `lib/session.ts:29-46`

`maybeBootstrapFirstAdmin` reads `adminCount`, then updates. Two concurrent
first-login requests can both observe zero admins and both become admin. Low
severity since this only affects initial setup.

**Recommendation:** Use a database-level unique constraint or advisory lock.

### 9. [MEDIUM] PUBLIC_READ_TOKEN in query string — Noted

**Location:** `app/share/page.tsx`, `app/api/documents/[id]/file/route.ts`

Tokens in URLs are logged by web servers, stored in browser history, and can
leak via the Referer header (mitigated by `strict-origin-when-cross-origin`
policy but not eliminated).

**Recommendation:** Consider cookie-based auth for the share page, or use
short-lived signed URLs for document downloads.

### 10. [LOW] Docker compose binds to all interfaces — FIXED

**Location:** `docker-compose.yml:6`

Port mapping `"3001:3001"` binds to `0.0.0.0`, exposing the app directly on
all network interfaces even if a reverse proxy is intended.

**Fix:** Changed to `"127.0.0.1:3001:3001"`.

### 11. [LOW] No explicit CORS configuration — Noted

While Next.js API routes default to same-origin, there are no explicit CORS
headers. This is acceptable for same-origin usage but should be documented.

### 12. [LOW] File extension derived from user input — FIXED

**Location:** `app/api/documents/route.ts:46`

`path.extname(file.name)` took the extension from the user-supplied filename.
A mismatch between MIME type and extension (e.g., `.html` with
`application/pdf`) could cause issues when files are served.

**Fix:** Extension is now derived from the validated MIME type using a safe
allowlist map.

---

## Positive Security Observations

- **Authentication is consistently enforced** across all API routes
- **Authorization (IDOR protection)** is well-implemented — all write operations
  verify `userId` ownership at the database level
- **Input validation** includes length limits via `.slice()` on all string fields
- **API tokens** are properly hashed (SHA-256) and the raw token is never stored
- **Token management** correctly rejects Bearer-based access to prevent
  token-based token operations
- **File uploads** validate MIME type against an allowlist and use random UUIDs
  for stored filenames
- **Security headers** are comprehensive (HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy)
- **Secrets management** in production uses GCP Secret Manager (not env files)
- **`.env.example`** contains only placeholder values
- **Share page** correctly sets `robots: noindex, nofollow`
