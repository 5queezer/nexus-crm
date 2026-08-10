## ADDED Requirements

### Requirement: Optional empty-CRM demo action
The onboarding wizard and regular true-empty state SHALL offer an optional action to create a demo workspace without replacing the existing real-application and skip actions.

#### Scenario: Onboarding creation succeeds
- **WHEN** a new user chooses the demo action
- **THEN** the UI disables duplicate submission, creates the workspace, refreshes application data, completes onboarding, and displays the demo workflow

#### Scenario: Creation fails
- **WHEN** the demo API returns an error
- **THEN** the onboarding remains available and displays a localized, retryable error

### Requirement: Clear visual separation
Every demo application displayed in the dashboard, table, Kanban, focus, and detail surfaces SHALL be visibly identified as fictional demo data, and the dashboard SHALL show a demo-workspace notice.

#### Scenario: Demo record presentation
- **WHEN** a marked demo application is displayed
- **THEN** a localized Demo badge or equivalent unambiguous label is visible

### Requirement: Demo-free regular statistics
Dashboard and analytics statistics SHALL calculate only from non-demo applications while marked demos remain browsable in CRM views.

#### Scenario: Demo-only workspace
- **WHEN** a workspace contains only demo applications
- **THEN** all regular pipeline and analytics metrics report zero real applications

#### Scenario: Mixed workspace
- **WHEN** real and demo applications coexist
- **THEN** metrics equal the values calculated from real applications alone

### Requirement: Safe removal control
An owner with a demo workspace SHALL have a localized, confirmed action that removes the workspace and refreshes all affected application and activity views.

#### Scenario: Remove demo workspace
- **WHEN** the owner confirms removal
- **THEN** the UI calls the owner-scoped delete endpoint, clears demo selections, refreshes cached data, and preserves real records
