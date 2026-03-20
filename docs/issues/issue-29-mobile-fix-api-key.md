## Summary

Two UX problems bundled in one fix: (1) on mobile viewports the first application card is partially hidden behind the fixed navbar, and (2) the API key management UI is located in the dashboard header instead of the Settings page where users expect configuration options.

## Severity
Bug + Enhancement

## Bug: First Card Overlapped by Navbar on Mobile

### Steps to Reproduce
1. Open the app on a mobile viewport (≤ 768 px, e.g. iPhone 14 at 390 px)
2. View the application list (mobile card view, `md:hidden`)
3. Observe: the first `MobileApplicationCard` is partially covered by the fixed header

### Root Cause
The app header uses `sticky top-0 z-10` with `h-16` (64 px). The mobile card list container (`<div className="p-3 md:hidden">`) had uniform padding on all sides — no extra top padding to account for the header height.

### Expected Behaviour
The first card should be fully visible below the navbar with clear spacing.

### Proposed Fix
Change the mobile card container padding from `p-3` to responsive top padding:
```
p-2 pt-3 sm:p-3 sm:pt-4 md:hidden
```
This ensures adequate top clearance on both small (`pt-3` = 12 px) and medium-small (`pt-4` = 16 px) screens without affecting desktop layout.

---

## Enhancement: Move API Key to Settings Page

### Current Behaviour
- An "🔑 API" button lives in the dashboard header
- Clicking it toggles an inline `<ApiToken />` panel above the application list
- Users unfamiliar with the layout have no reason to look for API keys in the dashboard header

### Expected Behaviour
The API token management component should appear on the Settings page (`/settings`) alongside other configuration options (email integration, theme, language).

### Proposed Change
1. Remove the API token button and toggle state from `dashboard.tsx`
2. Import and render `<ApiToken />` in `settings-client.tsx` within the existing settings layout:
   ```
   <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
     <EmailIntegration />
     <ScannedEmails />
     <ApiToken />          ← add here
     <AppSettingsPanel />
     {admin && <AdminUsers />}
     {admin && <AuditLog />}
   </main>
   ```
3. The `ApiToken` component (`components/api-token.tsx`) is self-contained — it fetches/mutates via `/api/token` (GET/POST/DELETE) and uses React Query, so no prop changes are needed

## Acceptance Criteria
- [ ] First mobile card is fully visible below the navbar on viewports from 320 px to 767 px
- [ ] No visual regression on desktop table view (≥ 768 px)
- [ ] API token section appears on the Settings page between Scanned Emails and App Settings
- [ ] API token button no longer appears in the dashboard header
- [ ] Token generation, copy-to-clipboard, and revoke flows work correctly from Settings
