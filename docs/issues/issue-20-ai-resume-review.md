## Summary

The resume review page (`/resume-review`) lacks AI-powered tooling to help users optimise CVs per application. Users currently submit the same generic resume everywhere, with no feedback on keyword gaps, formatting quality, or job-description fit.

## Severity
Enhancement

## Current Behaviour
- No resume analysis capability exists
- No way to generate a tailored CV per application
- Users must manually compare their resume against job descriptions

## Expected Behaviour
A dedicated page and supporting API that lets users:

1. **Analyse a resume against a job description** — client-side keyword extraction across four categories (technical, soft, qualification, other) with a 0–100 % match score, colour-coded (green ≥ 75 %, yellow ≥ 50 %, red < 50 %)
2. **See formatting tips** — automated checks for resume length (400–800 words ideal), action-verb density, quantified achievements, section headers, contact info, and bullet-point formatting
3. **Maintain a master CV profile** — a single `CvProfile` per user storing name, contact JSON, professional summary, skills by category, experience entries (with tier 1/2/3 detail levels), projects, and education
4. **Tailor a CV per application** — a `CvPatch` record per application that selects a subset of experience IDs, skill categories, and projects/education flags, plus an optional profile-override summary
5. **Generate a PDF** — render the merged (profile + patch) data via `@react-pdf/renderer` to an A4 Helvetica PDF, store it in cloud/local storage, and link it back to the application's `CvPatch.documentId`
6. **MCP tool support** — expose `upsert_cv_profile` and `generate_tailored_cv` as MCP tools for AI agent integration

## Proposed Implementation

### Components
- **`resume-analyzer.tsx`** — standalone analysis UI with two-column textarea layout (resume + job description), category filter tabs, keyword badges (green = found, red = missing), and formatting tip cards (success/warning/error)
- **`cv-viewer.tsx`** — application selector dropdown, PDF iframe preview (700 px), match-analysis side panel, generate/regenerate button, download link

### API Routes
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/cv/patch?applicationId=X` | Retrieve CV patch config |
| `POST` | `/api/cv/patch` | Create / update CV patch |
| `POST` | `/api/cv/generate` | Render tailored PDF, store, link |
| `GET` | `/api/cv/text?applicationId=X` | Plain-text merged CV for analysis |

### Library (`lib/resume-analysis.ts`)
- 100 + technical skill terms, 30 + soft skills, 30 + qualifications, 60 + action verbs
- Pure client-side processing (no server calls, privacy-first)
- Word-boundary matching for single terms, substring matching for multi-word phrases
- Stop-word removal and hyphen/space normalisation

### Database Models
- **`CvProfile`** — `userId` (unique), `name`, `contact` (JSON), `profile`, `skills` (JSON array of `{ category, items }`), `experience` (JSON array with `id`, `company`, `title`, `date`, `location`, `tier`, `bullets`), `projects`, `education`
- **`CvPatch`** — `applicationId` (unique, cascade delete), `profileOverride?`, `experienceIds` (ordered JSON), `skillCategories` (ordered JSON), `includeProjects`, `includeEducation`, `documentId?`

## Acceptance Criteria
- [ ] Resume analyzer renders match score, keyword grid with category filters, and formatting tips
- [ ] CV viewer fetches patch, displays PDF preview, and triggers generation
- [ ] `/api/cv/generate` produces a valid A4 PDF and stores it via the storage adapter
- [ ] `/api/cv/text` returns merged plain text suitable for keyword analysis
- [ ] `CvProfile` and `CvPatch` migrations run without data loss
- [ ] MCP tools `upsert_cv_profile` and `generate_tailored_cv` are functional
- [ ] Full i18n support (DE/EN) for all new UI strings
- [ ] Dark mode support for all new components
