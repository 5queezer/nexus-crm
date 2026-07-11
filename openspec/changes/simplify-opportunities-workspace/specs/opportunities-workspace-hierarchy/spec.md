## ADDED Requirements

### Requirement: A single primary page action
The opportunities workspace SHALL present creation of a new opportunity as its only visually primary page-level action. The command palette MUST remain available through its existing keyboard shortcut without requiring a persistent page-heading button.

#### Scenario: User scans the page heading
- **WHEN** the opportunities workspace is rendered
- **THEN** the heading exposes one emphasized action for creating a new opportunity
- **AND** no command-palette button competes with that action

#### Scenario: User invokes the command palette
- **WHEN** the user presses Cmd+K or Ctrl+K
- **THEN** the existing command palette opens

### Requirement: Decision-oriented overview
The opportunities workspace SHALL display no more than four default summary signals: total active opportunities, active pipeline opportunities, opportunities received this week, and high-priority opportunities. The overview MUST NOT display the full status and triage distributions by default.

#### Scenario: User reviews the overview
- **WHEN** application data has loaded
- **THEN** exactly four summary values are presented
- **AND** each value describes a distinct decision-oriented signal

#### Scenario: High-priority opportunities exist
- **WHEN** one or more opportunities have triage quality four or five
- **THEN** the high-priority signal displays their combined count
- **AND** the overview does not add a separate redundant action sentence

### Requirement: Consolidated workspace utilities
The workspace SHALL keep table/Kanban view selection directly visible and SHALL place archive access, CSV export, and rule-based bulk archival in one labeled secondary-actions menu.

#### Scenario: User changes workspace view
- **WHEN** the user selects Table or Kanban
- **THEN** the corresponding view is displayed without opening an overflow menu

#### Scenario: User needs a secondary utility
- **WHEN** the user opens the workspace secondary-actions menu
- **THEN** archive access, CSV export, and applicable bulk archive options are available
- **AND** selecting an action preserves its existing behavior

### Requirement: Progressive row and card actions
Each opportunity row and mobile card SHALL provide one secondary-actions trigger instead of persistently displaying edit, archive, and delete controls. Opening the opportunity itself MUST remain a direct primary interaction.

#### Scenario: User opens opportunity details
- **WHEN** the user activates the opportunity name or card body
- **THEN** the existing opportunity details editor opens directly

#### Scenario: User opens opportunity actions
- **WHEN** the user activates the opportunity action trigger
- **THEN** edit, archive or unarchive, and delete actions are available as applicable
- **AND** destructive actions are visually distinguished

### Requirement: Responsive and accessible controls
All consolidated controls SHALL remain usable on mobile and by keyboard. Menu triggers MUST expose accessible names, menus MUST close on Escape and outside interaction, and interactive targets MUST retain appropriate touch sizing.

#### Scenario: Mobile workspace
- **WHEN** the workspace is rendered at a narrow viewport
- **THEN** the primary action, view selector, filters, and secondary-actions trigger remain usable without horizontal page overflow

#### Scenario: Keyboard dismissal
- **WHEN** a secondary-actions menu is open and the user presses Escape
- **THEN** the menu closes and no underlying mutation is triggered
