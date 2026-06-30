# Nexus CRM Account-Isolation Security Audit

**Date:** 2026-06-30  
**Scope:** Authenticated account isolation, share/public routes, document access, MCP/API surfaces, DB scoping, and dependency scan.

## Executive summary

Two critical cross-account exposure paths were confirmed and fixed:

1. The legacy global `PUBLIC_READ_TOKEN` document download path allowed unauthenticated access to any document ID when the token was known.
2. The public share page used `listApplications(null)`, which returned applications for every user instead of the share-link owner.

The fixes remove global public-token based data access and scope share views to the `ShareLink.userId` creator.

## Critical fixes applied

### 1. Disable global public-token document downloads

**Affected route:** `app/api/documents/[id]/file/route.ts`

Before:

- Unauthenticated requests with `?token=<PUBLIC_READ_TOKEN>` set `readScopeUserId = null`.
- `loadOwnedDocument(id, null)` could resolve any user's document.

After:

- The route requires `requireAuth()` for all downloads.
- Any `token` query parameter is ignored.
- Documents are loaded with `auth.readScopeUserId`.

Regression test:

- `app/api/documents/[id]/file/__tests__/route.test.ts`
- Test name: `rejects unauthenticated public-token download attempts`

### 2. Scope public share pages to the share-link owner

**Affected routes/pages:**

- `app/s/[code]/route.ts`
- `app/share/page.tsx`
- `app/page.tsx`

Before:

- `/s/{code}` for `share_page` redirected to `/share?token=<PUBLIC_READ_TOKEN>`.
- `/share` validated the global token and then called `listApplications(null)`.
- `null` means global read scope, so a shared page could include every user's applications.

After:

- `/s/{code}` redirects to `/share?code={code}`.
- `/share` resolves the `ShareLink` by code, verifies `targetType === "share_page"`, and calls `listApplications(link.userId)`.
- `LangToggle` preserves `code`, not a global token.

Regression test:

- `app/s/[code]/__tests__/route.test.ts`
- Tests verify:
  - share redirects use `code`, not `token`
  - document share targets call `getDocument(targetId, link.userId)`
  - document owner mismatch returns 404

### 3. Scope public document share links to the link owner

**Affected route:** `app/s/[code]/route.ts`

Before:

- Document share links called `getDocument(link.targetId, null)`.

After:

- Document share links call `getDocument(link.targetId, link.userId)`.
- The returned document must also have `doc.userId === link.userId` before file bytes are returned.

### 4. Deprecate public-token config endpoint

**Affected route:** `app/api/config/public-token/route.ts`

Before:

- Any authenticated user could retrieve the global `PUBLIC_READ_TOKEN`.

After:

- Auth is still required, but the endpoint returns `410 Gone` with a message directing clients to per-link share URLs.

## Positive isolation findings

- `Application` and `Document` models include `userId` owner fields.
- Core application CRUD uses `auth.userId` for writes and `auth.readScopeUserId` for reads.
- Non-admin writes remain scoped through adapter methods:
  - `updateApplication(id, userId, ...)`
  - `deleteApplication(id, userId)`
  - `updateDocumentLinks(id, userId, ...)`
  - `deleteDocument(id, userId)`
- Contact creation verifies parent application ownership before calling the adapter.
- Document upload/linking verifies referenced application IDs belong to the user.
- Email scanned/imported data is scoped by `auth.userId`.
- Token-management endpoint rejects Bearer-token based token rotation.
- MCP application/document tools use `auth.readScopeUserId` for reads and `auth.userId` for writes.

## Remaining design/security risks

### Admin global read access

Current design sets `readScopeUserId = null` for admins. This means admin accounts can read all applications/documents via normal read endpoints and MCP tools. If admins should only manage users and not see user data, this must be changed to an explicit impersonation/audited support-access model.

### Dependency vulnerabilities

`npm audit --omit=dev --audit-level=moderate` reports vulnerable transitive/runtime dependencies, including high/critical advisories in packages such as `next`, `protobufjs`, `axios`, `hono`, `dompurify` via Swagger UI, and Google/Firebase dependencies. This should be handled in a separate dependency-upgrade PR because some fixes may require major/breaking updates.

### Rate limiting architecture

Existing notes still apply: IP-based in-memory rate limiting is not a strong distributed control if the app runs multiple instances or if `X-Forwarded-For` trust is not hardened at the proxy boundary.

## Validation evidence

Commands run after the fix:

```bash
npx vitest run 'app/api/documents/[id]/file/__tests__/route.test.ts' 'app/s/[code]/__tests__/route.test.ts'
# 2 files passed, 7 tests passed

npm run lint
# passed with existing warnings only

npm test
# 15 files passed, 116 tests passed

npm run build
# passed
```

Static runtime scan confirmed the fixed routes no longer contain:

- `listApplications(null)`
- `getDocument(link.targetId, null)`
- `readScopeUserId = null`
- `/share?token=`
- `?token=<PUBLIC_READ_TOKEN>`

## Recommendation

Merge and deploy the account-isolation fixes before onboarding additional users or relying on public share links in a multi-user setting.
