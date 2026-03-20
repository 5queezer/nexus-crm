# Design: Per-Application Tailored CV Generation

## Summary

- Per-application tailored CV generation in Nexus, driven by MCP from Claude
- Master CV data lives in the database; per-application patches cherry-pick entries
- `@react-pdf/renderer` generates PDFs server-side (no system deps)
- PDF stored as a Document linked to the application
- Resume-review page becomes CV preview + keyword gap analysis

## Who

You, via claude.ai connected to Nexus MCP.

## Constraints

- Runs on Cloud Run — no system dependencies
- MCP calls must be fast and deterministic
- AI selects from vetted master content, doesn't generate new bullet text

## Non-Goals

- No LaTeX pipeline in Nexus
- No per-application bullet editing or deep merge
- CV repo is not integrated — pattern reference only

## Assumptions

- Single master CV profile per user
- One tailored CV per application (regenerating overwrites the previous)
- The HTML/CSS template is a new build (not ported from the LaTeX template)

---

## Data Model

### CvProfile (one per user)

| Field      | Type   | Description                                              |
|------------|--------|----------------------------------------------------------|
| id         | Int    | Primary key                                              |
| userId     | String | Owner (unique — one profile per user)                    |
| name       | String | Full name                                                |
| contact    | JSON   | `{ email, phone, linkedin, github, location }`           |
| profile    | String | Professional summary                                    |
| skills     | JSON   | `[{ category: string, items: string[] }]`                |
| experience | JSON   | `[{ id, company, title, date, location, tier, bullets }]`|
| projects   | JSON   | `[{ name, url, stack, description }]`                    |
| education  | JSON   | `[{ institution, degree, date, location, details? }]`    |
| createdAt  | DateTime |                                                        |
| updatedAt  | DateTime |                                                        |

### CvPatch (one per application)

| Field            | Type          | Description                                    |
|------------------|---------------|------------------------------------------------|
| id               | Int           | Primary key                                    |
| applicationId    | Int           | Foreign key to Application (unique)            |
| profileOverride  | String?       | Replaces master profile summary if set         |
| experienceIds    | JSON string[] | Ordered list of experience entry IDs to include|
| skillCategories  | JSON string[] | Ordered list of skill categories to include    |
| includeProjects  | Boolean       | Default: false                                 |
| includeEducation | Boolean       | Default: true                                  |
| createdAt        | DateTime      |                                                |
| updatedAt        | DateTime      |                                                |

No changes to Application or Document models. Generated PDF is a regular Document linked via existing many-to-many.

---

## MCP Tools

### `get_cv_profile` (read-only)

Returns the master CV profile for the authenticated user.

### `upsert_cv_profile` (write)

Create or update the master CV profile.

### `generate_tailored_cv` (write)

One-shot: saves CvPatch + renders PDF + stores as Document linked to application.

**Input:**

```typescript
{
  applicationId: number       // required
  profileOverride?: string    // replaces master profile summary
  experienceIds: string[]     // ordered — which entries to include
  skillCategories: string[]   // ordered — which categories to include
  includeProjects?: boolean   // default: false
  includeEducation?: boolean  // default: true
}
```

**Flow:**
1. Upsert CvPatch for the application
2. Merge CvProfile + CvPatch
3. Render PDF via `@react-pdf/renderer` `renderToBuffer`
4. Store PDF via existing storage layer (GCS or local)
5. Create/update Document record, link to application
6. Return document ID

### MCP Call Flow (2 calls)

1. Claude calls `get_cv_profile` + `get_application` (parallel, read-only)
2. Claude calls `generate_tailored_cv` (write)

---

## PDF Template

React components using `@react-pdf/renderer`:

```
CvDocument
├── Header (name, contact)
├── ProfileSection (summary)
├── SkillsSection (filtered by patch)
├── ExperienceSection (filtered + ordered by patch)
│   └── ExperienceEntry (tier-aware: 1-2 with bullets, 3 compact)
├── ProjectsSection (conditional)
└── EducationSection (conditional)
```

- A4 page, professional styling via `@react-pdf/renderer` CSS-like API
- `renderToBuffer` — no temp files, no filesystem
- Tier system: 1 = detailed with bullets, 2 = bullets, 3 = compact/no bullets

---

## Resume-Review Page Revamp

**Before:** Two textareas (paste resume + job description), manual keyword analysis.

**After:** Application-scoped CV viewer with integrated gap analysis.

```
AppHeader
├── Application selector (dropdown or ?applicationId=X)
├── Two-column layout:
│   ├── Left: PDF preview (iframe to /api/documents/[id]/file)
│   └── Right: Keyword gap analysis (auto-fed from CV data + job description)
└── Actions:
    └── "Regenerate" button (calls generate_tailored_cv via API)
```

- No manual text pasting — data comes from CvPatch + CvProfile + Application
- Existing `analyzeResume` function reused, fed programmatically
- If no tailored CV exists, prompt to generate one

---

## Decision Log

| # | Decision | Alternatives Considered | Rationale |
|---|----------|------------------------|-----------|
| 1 | Patch/override model | Full variant per app, deep merge | Fewer degrees of freedom = faster, more accurate MCP calls |
| 2 | MCP-driven from Claude | Manual editing, hybrid | Primary workflow is via claude.ai |
| 3 | PDF stored in Nexus as Document | CV repo, both | CV repo is Python/LaTeX — different stack, reference only |
| 4 | `@react-pdf/renderer` | LaTeX, Puppeteer, external service | No system deps for Cloud Run, lightweight, pure Node.js |
| 5 | Master CV in database | YAML in repo, uploaded document | Editable via MCP, queryable, fits the app's data model |
| 6 | Include/exclude patch model | Section-level overrides, field-level deep merge | Fast + accurate for AI — cherry-pick from known entries |
| 7 | Single `generate_tailored_cv` tool | Separate upsert + generate tools | Fewer round trips, immediate generation |
| 8 | Resume-review → CV viewer + gap analysis | Kill it, keep separate | Existing keyword logic useful after generation |
| 9 | Keep `resumeId` field | Remove it | Escape hatch for fallback |
