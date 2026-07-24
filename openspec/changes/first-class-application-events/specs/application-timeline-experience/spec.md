## ADDED Requirements

### Requirement: Per-application timeline
The application detail experience SHALL display a chronological event timeline with human-readable event titles, occurrence and ingestion times, source, actor, relevant structured metadata, and links to the application, contact, document, or submission when present. Unknown legacy event types SHALL use a safe fallback label and expose their stored type.

#### Scenario: Application detail is opened
- **WHEN** an owner opens an application with events
- **THEN** the first timeline page is visible without inspecting the summary textarea
- **AND** additional pages can be loaded incrementally

#### Scenario: Timeline order changes
- **WHEN** an owner switches between newest-first and oldest-first
- **THEN** the timeline reloads in the requested deterministic order

### Requirement: Global activity experience
Nexus SHALL provide a navigable global activity page that lists events across the owner's applications and provides filters for time, type, application, source, actor, contact, and outcome. Active filters SHALL be visible and removable, and additional results SHALL load incrementally.

#### Scenario: User filters global activity
- **WHEN** an owner selects an application and event type
- **THEN** the displayed activity and subsequent pages use those filters

#### Scenario: Activity is empty
- **WHEN** no events match the selected filters
- **THEN** Nexus displays a clear empty state without implying that the application history was deleted

### Requirement: Notes are a bounded current summary
The UI SHALL label the legacy notes field as a current summary, explain that chronological activity belongs in the timeline, display the current character count against the 10,000-character limit, and warn before the limit. REST and MCP application mutations MUST reject oversized summaries with `notes_too_long` instead of truncating them.

#### Scenario: Summary approaches its limit
- **WHEN** the summary reaches the configured warning threshold
- **THEN** the UI presents a visible warning and character count

#### Scenario: Oversized summary is submitted
- **WHEN** a client submits more than 10,000 characters
- **THEN** Nexus returns `notes_too_long`
- **AND** preserves the previously stored summary unchanged

### Requirement: Legacy history is preserved
Nexus SHALL preserve existing notes and events as-is. It MUST NOT automatically parse prose into authoritative events or fabricate occurrence times, actors, contacts, or outcomes.

#### Scenario: Existing summary contains chronological prose
- **WHEN** the feature is deployed over an existing application
- **THEN** the text remains unchanged
- **AND** no inferred events are created automatically

### Requirement: Localized and accessible event surfaces
Timeline, activity, filter, summary guidance, loading, empty, and error states SHALL have English and German messages and keyboard-accessible controls with programmatic labels and live loading/error feedback.

#### Scenario: Timeline is used with assistive technology
- **WHEN** a keyboard or screen-reader user loads or filters events
- **THEN** controls have accessible names, focus remains predictable, and status changes are announced
