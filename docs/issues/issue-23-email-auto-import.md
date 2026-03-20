## Summary

Manually entering every job application is the largest friction point in the tool. Users receive confirmation emails, interview invitations, rejections, and offers in their inbox — data that can be parsed and imported automatically. This feature connects Gmail (and later Outlook) via OAuth and classifies incoming emails to populate the application pipeline.

## Severity
Enhancement

## Current Behaviour
- All applications must be created manually via the "New Opportunity" modal
- No email integration exists
- Status changes (interview, rejection, offer) must also be tracked manually

## Expected Behaviour

### OAuth Connection
- "Connect Gmail" button on the Settings page starts an OAuth 2.0 flow
- Scope: `gmail.readonly` (read-only access)
- CSRF protection via state token bound to the current user (stored in httpOnly cookie, 10-minute TTL)
- Refresh token encrypted with AES-256-GCM before storage (key: `EMAIL_TOKEN_ENCRYPTION_KEY`, 64 hex chars)
- Access tokens cached in-memory with 5-minute safety margin before expiry

### Email Scanning
- **Incremental sync** — uses Gmail History API (`startHistoryId`) for delta fetches; falls back to List API if history ID expired
- **Full scan** — on first connect, scans back `scanDaysBack` days (configurable: 3 / 7 / 14 / 30, default 7)
- **Batch size** — up to 50 messages per scan
- **Deduplication** — unique constraint on `(userId, messageId)` prevents re-processing
- **Two trigger modes**:
  1. Scheduled: `POST /api/email/scan` with `x-scan-secret` header (for cron / Cloud Scheduler)
  2. Manual: "Scan now" button in Settings (user session auth)

### Classification Engine (`lib/email/classifier.ts`)
- **46 subject-line patterns** across 4 categories and 2 languages (EN / DE):
  - `applied` — "application received", "bewerbung eingegangen", etc.
  - `interview` — "interview invitation", "einladung zum gespräch", etc.
  - `rejection` — "unfortunately", "absage", "leider müssen wir", etc.
  - `offer` — "offer letter", "angebot", "zusage", etc.
- **4 body-snippet patterns** (fallback when subject doesn't match)
- **14 job-board domains** for sender detection (LinkedIn, Indeed, Greenhouse, Lever, Workday, SmartRecruiters, Ashby, iCIMS, Jobvite, Breezy, Recruitee, StepStone, XING, AMS)
- **Confidence tiers**:
  - `high` — subject pattern matched
  - `medium` — body pattern matched
  - `low` — job-board sender detected, no text pattern

### Data Extraction
- **Company** — from sender display name ("Recruiting at Company"), or capitalised email domain (excluding known job boards)
- **Role** — from subject line via patterns like "application for [role]", "bewerbung als [role]" (2–80 chars)

### Import Modes
| Mode | Behaviour |
|------|-----------|
| `off` | Scan and classify only; no import |
| `review` (default) | Emails land in "pending" queue for manual review |
| `auto` | Automatically create/update Applications for classified emails with extractable company |

### Auto-Import Logic
- Deduplicates by case-insensitive company + role match
- If existing application found:
  - Updates status only if it's a progression (applied → interview → offer)
  - Rejection is terminal — doesn't overwrite higher stages
- If new: creates Application with `source: "email"` and mapped status

### Settings
| Setting | Options | Default |
|---------|---------|---------|
| Enabled | on / off | on |
| Scan frequency | 15 / 30 / 60 min | 15 min |
| Import mode | off / review / auto | review |
| Scan window | 3 / 7 / 14 / 30 days | 7 days |

## Proposed Implementation

### Database Models
- **`EmailIntegration`** — one per user: `provider`, `encryptedToken`, `lastHistoryId`, `scanFrequency`, `autoImport`, `scanDaysBack`, `enabled`, `lastScanAt`
- **`ScannedEmail`** — per message: `messageId` (unique per user), `subject`, `sender`, `receivedAt`, `classification`, `confidence`, `extractedData` (JSON), `status` (pending/imported/dismissed), `applicationId?`

### API Routes
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/email/oauth/connect` | Start OAuth flow |
| `GET` | `/api/email/oauth/callback` | Handle OAuth callback |
| `GET` | `/api/email/settings` | Get integration config |
| `PATCH` | `/api/email/settings` | Update settings |
| `DELETE` | `/api/email/settings` | Disconnect + delete all scanned data |
| `POST` | `/api/email/scan` | Trigger scan (scheduled or manual) |
| `GET` | `/api/email/scanned` | List scanned emails (filterable by status) |
| `PATCH` | `/api/email/scanned` | Bulk import or dismiss (max 100 IDs) |

### UI Components
- **`email-integration.tsx`** — connection status, settings form (frequency, mode, scan window), "Scan now" / "Disconnect" buttons
- **`scanned-emails.tsx`** — collapsible section with pending count badge, filter tabs (Pending / Imported / Dismissed), bulk select, import/dismiss actions, classification badges colour-coded by type and confidence

## Acceptance Criteria
- [ ] Gmail OAuth connect/disconnect works with CSRF protection and token encryption
- [ ] Incremental sync via History API with automatic fallback to List API
- [ ] Classifier correctly identifies applied/interview/rejection/offer emails in both EN and DE
- [ ] Confidence levels (high/medium/low) assigned based on match source (subject/body/sender)
- [ ] Company and role extraction from sender and subject line
- [ ] Three import modes function correctly (off, review, auto)
- [ ] Auto-import deduplicates and respects status progression
- [ ] Bulk import/dismiss actions work (up to 100 emails per request)
- [ ] Settings (frequency, mode, scan window) persist and are validated
- [ ] Scanned emails UI shows classification badges, extracted data, and action buttons
- [ ] Full i18n support (DE/EN) for all new strings
- [ ] 32+ classifier unit tests pass
