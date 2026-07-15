## Context

This is an additive client-side responsive layer over the existing opportunities workspace. Existing application fields are sufficient for deterministic prioritization.

## Decisions

### Auto view is session-local

Dashboard stores `null` for untouched mode. A hydration-safe media query resolves it to Focus below 1024px and Table otherwise. Any explicit selection survives resize. Archived records temporarily resolve Focus to Table while retaining the explicit Focus preference for return to active records.

### One committed filter model

Dashboard owns a serializable model containing search, exact status, normalized source category, remote-only, and Triage 4–5. Search commits immediately. Compact secondary filters edit a draft in a modal sheet and apply atomically. Table keeps sorting and pagination only.

### Focus is deterministic and inspectable

Each filtered active application enters the first matching group in this precedence order: overdue, high priority, due soon, new this week, or recent. “New this week” is a rolling seven-local-calendar-day window: today plus the preceding six local days, not a calendar week. Future-created records are excluded from that group.

Ordering is deterministic within every group: overdue and due-soon records use earliest follow-up first; high priority uses Triage score descending and then earliest follow-up; new-this-week uses newest creation first; and recent uses newest update first. Stable application ID breaks every remaining tie. Visible headings and reason text explain placement.

### Dataset-scoped selection

Selection is presentation-stable and filter-stable, but Active and Archive are separate datasets. Dashboard derives the actionable selected IDs from the current unfiltered dataset, while filter-hidden selected IDs remain included and are disclosed in the bulk bar. Every Active/Archive entry point uses one navigation helper that clears selection before changing datasets. Mutations that move or remove records clean those IDs from selection immediately; derived scoping prevents externally disappeared IDs from reaching counts, views, or bulk targets.

### Fixed-surface ownership

The compact create FAB is absent during selection or modal/sheet ownership. BulkActionBar owns the bottom slot during selection. Shared safe-area and z-index utilities prevent overlap.

### Capability-preservation matrix

| Existing capability                              | Post-change surface                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Create                                           | Expanded toolbar, compact FAB, or true-empty CTA (one primary action per breakpoint) |
| Direct details/edit                              | Focus/List row body, Table company, Stages/Kanban card, command palette              |
| Job URL                                          | Focus/List overflow or existing card/table link                                      |
| Status update                                    | Focus explicit status control, bulk bar, desktop Kanban drag/drop, editor            |
| Select up to 100                                 | Focus/List explicit Select and desktop Table checkbox                                |
| Bulk status/archive/delete                       | Safe-area-aware BulkActionBar                                                        |
| Archive/unarchive/delete                         | Per-record overflow                                                                  |
| Active/archive workspace                         | Workspace More menu with archive count                                               |
| CSV export                                       | Workspace More menu                                                                  |
| Age/rating archive rules                         | Workspace More menu                                                                  |
| Search/status/source/remote/triage filters       | Shared inline expanded controls or compact filter sheet/chips                        |
| Sorting/pagination                               | Table; Kanban sort remains visible                                                   |
| Table/Kanban                                     | Direct three-way selector whenever records exist                                     |
| Desktop Kanban DnD/rollback                      | Expanded Kanban unchanged, shared optimistic mutation                                |
| Overdue alert/dismiss                            | Existing dashboard alert and Focus overdue group                                     |
| Editor fields, contacts, documents, resume tools | Opportunity editor with compact disclosure                                           |
| Keyboard shortcuts                               | Existing handlers/dialog/bar plus F for Focus                                        |
| Command palette                                  | Cmd/Ctrl+K and existing palette                                                      |
| Global destinations                              | Desktop header navigation or compact modal navigation sheet                          |
| Account/share/theme/language/logout              | Existing separate account/display menu                                               |

## Accessibility

All practical compact targets are at least 48px. Sheets provide modal semantics, focus containment, Escape/backdrop close, scroll lock, and trigger-focus restoration. Focus rows avoid nested interactive controls and never use color as their only status or priority signal.

## Non-goals

No backend ranking, persistence, saved views, telemetry, new statuses, timeline, relationship map, swipe-only actions, desktop split pane, or app-wide navigation-shell replacement.
