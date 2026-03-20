## Summary

The application has no visual analytics. Users track dozens of applications but have no aggregated view of pipeline health, response rates, or trends over time. An analytics dashboard at `/analytics` should surface actionable insights from existing application data.

## Severity
Enhancement

## Current Behaviour
- No charts or statistics beyond raw counts
- Users must mentally aggregate status, timing, and source data
- No way to identify which companies or sources yield the best results

## Expected Behaviour
A dedicated analytics page with six key visualisations, all computed client-side from the existing applications API:

### 1. Status Breakdown
- Horizontal bar chart with one row per pipeline stage (inbound → applied → interview → offer → rejected)
- Colour-coded bars (teal / blue / purple / green / red) normalised to the largest count
- **Interactive**: click a row to navigate to `/?status={status}` with that filter applied

### 2. Applications Over Time
- Weekly stacked column chart bucketed Monday-to-Sunday
- Two layers per bar: inbound (teal, bottom) and applied (blue, top)
- Gap-filled weeks (zero-value bars between first and last active week)
- Horizontally scrollable on small viewports

### 3. Response Rate
- Large percentage metric with progress bar
- Formula: `(interview + offer + rejected) / (applied + interview + offer + rejected) × 100`
- Breakdown showing responded / total counts and mini-stat circles for interviews and offers

### 4. Average Response Time
- Days metric with amber progress bar (30-day full-bar ceiling)
- Formula: mean of `(lastContact − appliedAt)` for applications with both dates and status ∈ {interview, offer, rejected}
- Graceful "—" fallback when no qualifying records exist

### 5. Top Companies
- Ranked list (top 8) with indigo horizontal bars
- **Interactive**: click a company to navigate to `/?search={company}`

### 6. Source Breakdown
- Ranked list (top 8) with cyan horizontal bars
- Normalises source aliases (e.g. "linkedin inmail" → "linkedin", "kaltakquise" → "cold-outreach", domain names → "website")
- **Interactive**: click a source to navigate to `/?source={source}`

## Proposed Implementation

### Component: `analytics-dashboard.tsx`
- Client component (`"use client"`) with `useQuery(["applications"])` for data fetching
- 8 `useMemo` hooks for aggregation (activeApps, statusCounts, weeklyBuckets, responseRate, avgResponseTime, topCompanies, topSources)
- Responsive grid: `grid-cols-1 lg:grid-cols-2 gap-6`

### Helper Functions
- `getWeekKey(date)` — returns Monday `YYYY-MM-DD` for weekly bucketing
- `formatWeekLabel(weekKey)` — converts to `DD.MM` display format
- `normalizeSource(source)` — handles aliases, German terms, domain extraction
- `normalizeStatus(status)` — maps legacy values ("waiting" → "applied", "ghost" → "rejected")

### Page Route: `/analytics`
- Server component with `requireAuth()` guard
- Renders `<AppHeader>` + `<AnalyticsDashboard>`

### States
- **Loading**: spinner with centered layout
- **Error**: red error message
- **Empty**: "No data available yet." when zero active (non-archived) applications

## Acceptance Criteria
- [ ] Six visualisation cards render correctly on desktop (2-column) and mobile (1-column)
- [ ] All charts exclude archived applications
- [ ] Status, company, and source rows are clickable and navigate with correct query params
- [ ] Weekly chart gap-fills missing weeks between first and last active week
- [ ] Source normalisation handles at least: linkedin variants, German terms, raw domain names
- [ ] Full i18n support (all labels under `analytics.*` namespace, DE/EN)
- [ ] Dark mode support with Tailwind `dark:` colour tokens
- [ ] Loading, error, and empty states display correctly
