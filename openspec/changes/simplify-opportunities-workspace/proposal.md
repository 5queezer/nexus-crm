## Why

The opportunities workspace gives secondary utilities and nine summary values nearly the same visual weight as the core task of reviewing and updating opportunities. This creates button sprawl, weak hierarchy, and a dense overview that is hard to scan—especially on smaller screens.

## What Changes

- Establish one primary page action: create a new opportunity.
- Remove the visible command-palette button while preserving its keyboard shortcut.
- Reduce the overview to four decision-oriented signals: total pipeline, active pipeline, new this week, and high-priority opportunities.
- Consolidate view selection, archive access, CSV export, and bulk archival into one calm workspace toolbar with secondary actions in an overflow menu.
- Replace per-row edit/archive/delete button clusters with a single accessible row-actions menu while retaining direct row opening.
- Simplify mobile opportunity cards so their primary interaction opens details and secondary actions live in one menu.
- Preserve table, Kanban, archive, filtering, export, keyboard, and mutation behavior.
- Add responsive and interaction tests plus production screenshots for table, Kanban, details, and mobile states.

## Capabilities

### New Capabilities
- `opportunities-workspace-hierarchy`: Defines the simplified hierarchy, progressive disclosure, responsive behavior, and accessible access to existing opportunity actions.

### Modified Capabilities

None.

## Impact

- Primary UI components: `components/dashboard.tsx`, `components/application-table.tsx`, and shared action-menu presentation.
- Localization: English and German action/summary labels.
- Tests: component behavior for summary reduction and progressive action disclosure.
- No API, database, authentication, or deployment contract changes.
