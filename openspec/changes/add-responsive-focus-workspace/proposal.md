## Why

The opportunities workspace currently renders desktop-oriented controls and dense record cards on compact screens. Users need a calm, touch-friendly way to answer “what needs attention next?” without losing Table, Kanban, editor, bulk, archive, export, or keyboard capabilities.

## What Changes

- Add an explainable Focus queue over the existing active, committed-filter result.
- Automatically resolve an untouched view to Focus below 1024px and Table at 1024px and above.
- Keep `table` and `kanban` internal values; label them List/Stages on compact screens and Table/Kanban on expanded screens.
- Share search, status, source, remote, and Triage 4–5 filters across Focus and Table.
- Distinguish true-empty and filtered-empty recovery.
- Use 48px touch targets, safe-area-aware fixed surfaces, an extended compact create FAB, and modal navigation/filter sheets.
- Preserve all existing APIs, fields, mutations, permissions, archive/export/rule/bulk/editor/keyboard capabilities and desktop Kanban drag-and-drop.

## Capabilities

### New Capabilities

- `opportunities-workspace-hierarchy`: responsive view resolution, Focus ranking, progressive disclosure, compact navigation, and capability preservation.

### Modified Capabilities

- Supersedes only the prior requirement that Table/Kanban are the sole directly visible views and the prior true-empty presentation where redundant metrics/filter/view chrome would remain visible.

## Impact

Frontend presentation and client state only. No schema, API, authentication, permission, export-shape, or React Query key changes.
