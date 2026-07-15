## ADDED Requirements

### Requirement: Responsive view resolution

The workspace SHALL resolve an untouched active view to Focus below 1024px and Table at or above 1024px. An explicit user selection SHALL survive resize for the mounted session. Archived records SHALL NOT display Focus.

#### Scenario: Compact active workspace opens

- **WHEN** active opportunities render below 1024px without an explicit view selection
- **THEN** Focus is the current view

#### Scenario: Expanded workspace opens

- **WHEN** opportunities render at or above 1024px without an explicit view selection
- **THEN** Table is the current view

#### Scenario: Explicit choice survives resize and archive

- **WHEN** the user explicitly selects a view and resizes
- **THEN** the selection remains current
- **AND** an explicit Focus choice temporarily falls back to List/Table in archive
- **AND** Focus returns when active records are restored

### Requirement: Explainable Focus queue

Focus SHALL include every committed-filter result exactly once in the first matching group: overdue, high priority, due soon, new this week, or recent. Membership SHALL use local calendar boundaries and ordering SHALL be deterministic.

#### Scenario: Opportunity matches multiple groups

- **WHEN** an opportunity matches more than one group
- **THEN** it appears only in the first matching group
- **AND** its section heading and reason label explain its placement

#### Scenario: Stable ranking

- **WHEN** ranking inputs do not change
- **THEN** repeated selection returns the same order
- **AND** stable ID breaks otherwise equal recent ties

### Requirement: Shared committed filters

Focus and Table SHALL consume the same search, exact status/source, remote-only, and Triage 4–5 predicates. URL status/source seeds SHALL initialize those exact filters.

#### Scenario: User changes view with filters applied

- **WHEN** the user applies filters and switches between Focus and Table
- **THEN** both views contain the same eligible records

### Requirement: Responsive hierarchy and direct power-view access

When records exist, Focus, List/Table, and Stages/Kanban SHALL each be one direct selection away. Compact labels SHALL be List and Stages; expanded labels SHALL be Table and Kanban. Practical compact controls SHALL have at least a 48px target.

#### Scenario: Data-bearing compact workspace

- **WHEN** active records exist below 1024px
- **THEN** the three views remain directly selectable
- **AND** a single extended New opportunity FAB is the primary create action

#### Scenario: Data-bearing expanded workspace

- **WHEN** records exist at or above 1024px
- **THEN** the toolbar exposes one primary create action
- **AND** all three views and inline filters are visible

### Requirement: Distinct empty recovery

A true-empty workspace SHALL suppress redundant zero summary, filter, view, footer-count, and duplicate create controls. A filtered-empty workspace SHALL retain filter context and provide Clear filters.

#### Scenario: No opportunities exist

- **WHEN** the active collection is truly empty
- **THEN** one explanatory message and one create action are shown

#### Scenario: Filters remove all results

- **WHEN** records exist but committed filters match none
- **THEN** active filter context remains visible
- **AND** Clear filters is available

### Requirement: Capability preservation

Archive, export, rule archival, selection and bulk actions, editor fields and tools, keyboard commands, Table sorting/pagination, and expanded Kanban drag/drop with optimistic rollback SHALL remain reachable without an unlabeled gesture.

#### Scenario: User needs a secondary capability

- **WHEN** the user opens a clearly labeled overflow, sheet, editor section, or bulk bar
- **THEN** the applicable existing capability is reachable
- **AND** its API, permission, payload, and mutation behavior are unchanged

### Requirement: Compact modal navigation

Below 1024px, the header menu SHALL open a modal navigation sheet containing authenticated destinations and admin-gated Settings. Account/display utilities SHALL remain separate.

#### Scenario: Navigation sheet interaction

- **WHEN** the user opens compact navigation
- **THEN** focus is contained in the named modal sheet
- **AND** Escape, backdrop, or route change closes it
- **AND** focus returns to the trigger
- **AND** background scrolling is locked while open
