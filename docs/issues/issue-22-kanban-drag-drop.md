## Summary

The Kanban view currently displays application cards in fixed columns by status, but users cannot drag cards between columns to change an application's pipeline stage. Drag-and-drop is the most natural interaction for a Kanban board and would eliminate the need to open an edit modal just to update status.

## Severity
Enhancement

## Current Behaviour
- Kanban columns render cards grouped by status (inbound → applied → interview → offer → rejected)
- Changing status requires opening the edit modal, selecting a new status from a dropdown, and saving
- No drag interaction is available

## Expected Behaviour
Users can grab any card and drag it into a different status column to trigger an instant status update.

### Drag Interaction
- **PointerSensor** (mouse/trackpad) — activates after 8 px of movement
- **TouchSensor** (mobile) — activates after 250 ms hold with 5 px tolerance (prevents accidental drags while scrolling)
- Cards clicked without dragging still open the edit modal

### Visual Feedback
| State | Effect |
|-------|--------|
| Dragging (source card) | Opacity drops to 30 % |
| Drag overlay (cursor) | Full card replica at 105 % scale, 1° rotation, blue border, elevated shadow |
| Target column (hover) | Light blue background (`bg-blue-50` / `dark:bg-blue-950/30`) + 2 px blue inset ring |
| Empty column | Dashed-border placeholder |

### Optimistic Update Flow
1. Card drops → React Query cache is updated immediately with new status
2. `PATCH /api/applications/{id}` fires with `{ status }` body
3. On success → cache refreshed with server response
4. On failure → cache silently reverted to original status

### Mobile Behaviour
- Drag-and-drop disabled below `md` breakpoint (768 px)
- Fallback: accordion-style sections grouped by status (only non-empty statuses shown)
- Status changes on mobile require the edit modal

### Sorting
- Four sort options persisted in `localStorage("kanban-sort")`:
  - `rating_desc` (default) — highest rating first, then most recently updated
  - `updated_desc` — most recently updated first
  - `created_desc` — newest first
  - `company_asc` — alphabetical by company name

## Proposed Implementation

### Library
- `@dnd-kit/core` (^6.3.1) — core DnD context, sensors, draggable/droppable hooks
- `@dnd-kit/utilities` — CSS transform utilities

### Components
- **`KanbanColumn`** — wraps `useDroppable()` with status as ID; renders header badge + card count; min-height 80 px, max-height `calc(100vh - 220px)` with overflow-y scroll
- **`DraggableCard`** — wraps `useDraggable()` with app ID and data; applies `CSS.Translate.toString(transform)` and opacity toggle
- **`KanbanCard`** — display component (company, role, dates, rating, follow-up indicators: overdue = red ⚠, due today = orange 🔔, future = blue 📅)

### API
- `PATCH /api/applications/{id}` — existing endpoint, accepts `{ status }` with `normalizeStatus()` validation

### Column Layout
Desktop renders 5 columns in `STATUS_ORDER`: inbound, applied, interview, offer, rejected — each with its colour theme (teal, blue, purple, green, red).

## Acceptance Criteria
- [ ] Cards can be dragged between columns on desktop (pointer sensor)
- [ ] Touch sensor works on tablet-sized screens with hold-to-drag
- [ ] Source card fades during drag; overlay card shows elevated style
- [ ] Target column highlights with blue ring on hover
- [ ] Status update is optimistic with silent rollback on API failure
- [ ] Short-circuit: dropping a card back on the same column triggers no API call
- [ ] Sort preference persists across page reloads via localStorage
- [ ] Mobile (< md) falls back to accordion sections with no DnD
- [ ] Card click (without drag) still opens the edit modal
