## Context

The current page exposes controls in the global header, page heading, summary panel, workspace toolbar, table filter bar, and every opportunity row. The summary panel mixes pipeline status counts with triage distribution, producing nine equally weighted values. Existing behavior is valuable, but its presentation lacks progressive disclosure.

## Goals / Non-Goals

**Goals:**
- Make opportunity review the dominant visual task.
- Keep one obvious page-level primary action.
- Surface only decision-oriented summary signals.
- Consolidate infrequent utilities without removing functionality.
- Improve desktop and mobile action density and accessibility.

**Non-Goals:**
- Changing application data, API contracts, permissions, or business rules.
- Removing table, Kanban, archive, export, or bulk archival capabilities.
- Redesigning unrelated Documents, Analytics, Resume AI, or Settings pages.

## Decisions

### Use progressive disclosure for secondary actions

Archive access, CSV export, and rule-based bulk archive move into one labeled overflow menu. Row and mobile-card mutations use a single per-item menu. This preserves discoverability through labels and accessible menu semantics while reducing persistent controls.

Alternative considered: remove rarely used actions entirely. Rejected because the user asked for cleanup rather than capability loss.

### Reduce summary information to four signals

The overview displays total active opportunities, active pipeline, incoming this week, and high-priority triage count. Detailed status and triage distributions remain available through table filters and Analytics instead of competing on the main page.

Alternative considered: make the nine metrics horizontally scrollable or collapsible. Rejected because it retains unnecessary cognitive load and weakens the default hierarchy.

### Keep creation as the only primary page action

The command palette remains available through Cmd/Ctrl+K and the keyboard hint, but its dedicated page-heading button is removed. “New Opportunity” remains visibly emphasized.

### Keep filters near table content

Search and filters remain inside the table surface because they directly transform table results. Workspace-level controls stay in the workspace heading, separating view/navigation concerns from filtering concerns.

### Build a reusable accessible menu primitive

A small client-side action menu handles outside click, Escape, focusable labeled trigger, and destructive-action styling. It is shared by workspace utilities and row/card actions to keep behavior consistent without adding a dependency.

## Risks / Trade-offs

- [Secondary actions become one click deeper] → Use a clearly labeled “More” trigger at workspace level and an accessible ellipsis trigger per opportunity.
- [Users may miss the command palette] → Preserve Cmd/Ctrl+K, keyboard hint bar, and command palette behavior.
- [Reduced overview hides distribution detail] → Keep Analytics and existing filtering as detail destinations.
- [Menus can introduce keyboard/accessibility regressions] → Add interaction tests and explicit ARIA labels/roles; validate Escape and outside-click dismissal.

## Migration Plan

Ship as a presentation-only frontend change. No migration is required. Rollback consists of reverting the UI commit; persisted data and APIs are unaffected.

## Open Questions

None. The supplied annotated screenshot gives sufficient direction for hierarchy and density.
