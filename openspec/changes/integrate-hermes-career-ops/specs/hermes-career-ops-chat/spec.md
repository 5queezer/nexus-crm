## Purpose

Gives an authenticated Nexus user a first-class browser conversation with the external Hermes Career Ops agent, including availability reporting, thread lifecycle, streamed output with visible tool progress, cancellation, and honest degraded states — without ever exposing the Hermes credential or endpoint to the browser.

## ADDED Requirements

### Requirement: Server-only Hermes credentials and endpoint
The system SHALL communicate with Hermes exclusively from the server using operator-configured settings, and SHALL NOT expose the Hermes base URL, bearer token, or any upstream authorization header to the browser, to client bundles, to API responses, to logs, or to error messages.

#### Scenario: Credential never leaves the server
- **WHEN** any Career Ops endpoint returns a success or error response
- **THEN** the response body, headers, and status text contain no Hermes bearer token and no upstream `Authorization` value

#### Scenario: Upstream error text is sanitized
- **WHEN** Hermes returns an error whose body embeds a credential, token, or internal host detail
- **THEN** the system returns a controlled error message with the secret-bearing text removed and records the redacted form only

#### Scenario: Browser never contacts Hermes directly
- **WHEN** the Career Ops UI streams a response
- **THEN** every request originates from a Nexus API route on the same origin, and no cross-origin request to the Hermes host is issued from the browser

### Requirement: Disabled-by-default configuration
The system SHALL treat Career Ops as disabled unless the required server-only configuration is present and valid, and SHALL validate the configured base URL as operator-controlled configuration rather than user input.

#### Scenario: Missing configuration
- **WHEN** the Hermes base URL or API key is absent
- **THEN** the status endpoint reports the feature as disabled with a controlled reason
- **AND** the Career Ops trigger is not rendered in the UI

#### Scenario: Invalid configured base URL
- **WHEN** the configured base URL is not an absolute `http`/`https` URL
- **THEN** the system reports the feature as disabled and refuses to issue any upstream request

#### Scenario: User-supplied endpoint rejected
- **WHEN** a request supplies a Hermes base URL, upstream path, upstream method, or additional upstream header
- **THEN** the system ignores it and uses only the operator-configured endpoint and the explicitly supported upstream operations

### Requirement: Availability and capability status
The system SHALL expose an authenticated status endpoint reporting whether Career Ops is enabled, whether the connected Hermes instance is reachable, and which optional Hermes features (streamed run events, stop, approval resolution) are advertised, and SHALL derive optional-feature support from the Hermes capability endpoint rather than assuming it.

#### Scenario: Enabled and healthy
- **WHEN** Hermes reports healthy and advertises run submission, run events, stop, and approval features
- **THEN** the status endpoint reports enabled, available, and each advertised capability as supported

#### Scenario: Configured but unreachable
- **WHEN** Hermes is configured but its health or capability probe fails or times out
- **THEN** the status endpoint reports enabled but unavailable with a controlled reason and no upstream detail

#### Scenario: Partial capability support
- **WHEN** the connected Hermes does not advertise approval resolution
- **THEN** the status endpoint reports approvals as unsupported
- **AND** the UI presents the limitation honestly instead of offering an approval control

#### Scenario: Unauthenticated status request
- **WHEN** an unauthenticated caller requests Career Ops status
- **THEN** the system responds `401` and performs no upstream request

### Requirement: Bounded conversation input
The system SHALL bound the size of every Career Ops request body and message, and SHALL reject malformed or oversized input with controlled status codes before contacting Hermes.

#### Scenario: Oversized message
- **WHEN** a message exceeds the configured maximum length
- **THEN** the system responds with a client error and does not create a Hermes run

#### Scenario: Malformed JSON
- **WHEN** a request body is not valid JSON
- **THEN** the system responds `400` without contacting Hermes

#### Scenario: Empty message
- **WHEN** a submitted message is empty or whitespace only
- **THEN** the system responds `400` and creates no run

### Requirement: Streaming assistant output and tool progress
The system SHALL stream assistant output to the browser incrementally as Hermes produces it, SHALL surface tool and run lifecycle progress, and SHALL NOT buffer a full answer before first display.

#### Scenario: Incremental assistant output
- **WHEN** Hermes emits successive assistant deltas for a run
- **THEN** the UI appends each delta to the in-progress assistant message as it arrives

#### Scenario: Tool lifecycle visibility
- **WHEN** Hermes reports that a tool started and later completed
- **THEN** the UI shows the tool as running and then as finished, including a failure indication when the tool reported an error
- **AND** the raw internal tool payload is not rendered

#### Scenario: Unknown event type
- **WHEN** the stream contains an event type the system does not recognize
- **THEN** the system ignores that event and continues processing subsequent events

#### Scenario: Malformed stream frame
- **WHEN** a stream frame is not parseable
- **THEN** the system discards that frame without terminating the run or surfacing a raw parse error

### Requirement: Terminal run states settle the interface
The system SHALL settle the interface deterministically for completed, failed, cancelled, and approval-required runs, and SHALL expose streaming status through an assistive-technology announcement that reports state transitions rather than every output token.

#### Scenario: Completed run
- **WHEN** a run reports completion
- **THEN** the assistant message is finalized, the composer is re-enabled, and the stop control is removed

#### Scenario: Failed run
- **WHEN** a run reports failure
- **THEN** the UI shows a controlled error state with a retry affordance and re-enables the composer

#### Scenario: Cancelled run
- **WHEN** a run reports cancellation
- **THEN** the UI marks the response as stopped, retains the partial output already shown, and re-enables the composer

#### Scenario: Status announced without token spam
- **WHEN** the assistant is streaming output
- **THEN** a polite live region announces the run's state changes
- **AND** individual output tokens are not announced

### Requirement: Reconnection and status recovery
The system SHALL allow a client that lost its event stream to recover the run's outcome by polling authenticated run status, and SHALL present a reconnecting state rather than silently discarding an in-flight run.

#### Scenario: Stream interrupted mid-run
- **WHEN** the event stream ends before a terminal event while the run is still active
- **THEN** the UI shows a reconnecting state and resolves the final state from authenticated run status

#### Scenario: Navigating back to a running thread
- **WHEN** the user reopens a thread whose last run is still running
- **THEN** the system reports that run's current status and settles the UI when it reaches a terminal state

#### Scenario: Hermes serves no event stream
- **WHEN** the connected Hermes does not advertise streamed run events
- **THEN** the system still reports the feature available, resolves each run from authenticated run status, and opens no event stream

#### Scenario: The stream reports that it cannot deliver the outcome
- **WHEN** a run's event stream reports that an approval could not be presented, or that a terminal status could not be recorded
- **THEN** the client stops reading that stream and resolves the run from authenticated run status, rather than waiting on a connection that carries nothing further

#### Scenario: A run settles between the transcript and the run-state read
- **WHEN** a conversation's transcript is read, its last run then reaches a terminal state, and the run state is read afterwards
- **THEN** the system re-reads the transcript, so the reply that landed in between is shown rather than leaving the conversation displaying a message with no answer
- **AND** both instants compared come from the server, so the outcome does not depend on the viewer's clock

#### Scenario: The availability read fails
- **WHEN** the status request fails transiently
- **THEN** the feature reports enabled but unavailable, so the entry point and its retry action stay reachable without reloading the page
- **AND** a status response missing its capabilities is treated as advertising none, rather than failing to render

#### Scenario: A transcript that could not be loaded
- **WHEN** a conversation's transcript fails to load
- **THEN** submission is refused, because a reply would answer history the user cannot see
- **AND** a retry is offered in place of the missing transcript, so the conversation is not stranded

#### Scenario: A conversation that could not be inspected
- **WHEN** reading a conversation's run state fails
- **THEN** the system states that the run state is unknown and refuses submission, rather than presenting the conversation as idle
- **AND** selecting or creating another conversation clears that state, which described the one being left

#### Scenario: Hermes has forgotten a run
- **WHEN** authenticated run status finds that the upstream run no longer exists
- **THEN** the system reconciles its own record to a terminal state before reporting the run gone, so a conversation is never left holding an active run the client has already settled

### Requirement: Cancellation
The system SHALL offer a stop control while a run is active when the connected Hermes advertises stop support, and SHALL route cancellation through an authenticated, ownership-checked Nexus endpoint.

#### Scenario: User stops a running run
- **WHEN** the user activates stop for an active owned run
- **THEN** the system requests cancellation upstream and settles the run as stopped

#### Scenario: Stop unsupported
- **WHEN** the connected Hermes does not advertise stop support
- **THEN** the stop control is not offered

#### Scenario: Stop after completion
- **WHEN** stop is requested for a run that already reached a terminal state
- **THEN** the system responds with a controlled non-error outcome and does not change the recorded result

### Requirement: Duplicate submission protection
The system SHALL prevent a retried or double-submitted message from starting more than one Hermes run, and SHALL disable duplicate submission while a message is being started.

#### Scenario: Retried submission with the same client request identifier
- **WHEN** two run-creation requests for the same thread carry the same client request identifier
- **THEN** the system starts exactly one Hermes run and returns the same run for both requests

#### Scenario: Composer locked while starting
- **WHEN** a message submission is in flight
- **THEN** the send control is disabled until the run is started or the attempt fails

### Requirement: Upstream failure mapping
The system SHALL map upstream Hermes failures to controlled Nexus status codes without leaking upstream response bodies, and SHALL bound how long it waits for connection, stream, and total run activity.

#### Scenario: Upstream rejects the Nexus credential
- **WHEN** Hermes responds `401` or `403`
- **THEN** the system responds with a controlled unavailable status and does not echo the upstream body

#### Scenario: Upstream rate limited
- **WHEN** Hermes responds `429`
- **THEN** the system responds `429` with a controlled message

#### Scenario: Upstream server error
- **WHEN** Hermes responds `5xx`
- **THEN** the system responds with a controlled upstream-failure status

#### Scenario: Upstream timeout
- **WHEN** an upstream request exceeds its configured timeout
- **THEN** the system aborts the upstream request and returns a controlled timeout outcome

### Requirement: Responsive, accessible Career Ops surface
The system SHALL present Career Ops as a drawer that leaves the pipeline workspace usable on desktop and occupies a full-height sheet on narrow viewports, with keyboard and assistive-technology support and without color-only status encoding.

#### Scenario: Desktop drawer
- **WHEN** an authenticated user opens Career Ops at desktop width
- **THEN** a side drawer opens alongside the workspace and closing it restores the workspace unchanged

#### Scenario: Mobile sheet
- **WHEN** an authenticated user opens Career Ops on a narrow viewport
- **THEN** a full-height sheet opens with a visible close control and no horizontal page overflow

#### Scenario: Focus management
- **WHEN** the drawer opens and is later closed
- **THEN** focus moves into the drawer while open and returns to the trigger on close

#### Scenario: Escape closes safely
- **WHEN** the user presses Escape while a nested panel is open
- **THEN** the nested panel closes first and a further Escape closes the drawer

#### Scenario: Status is not color-only
- **WHEN** a run, tool, or connection state is displayed
- **THEN** the state is conveyed by text or an icon in addition to any color

### Requirement: Localized Career Ops interface
The system SHALL render every user-visible Career Ops string from the shared translation catalogs in English and German, with no hardcoded user-visible text.

#### Scenario: German locale
- **WHEN** a user views Career Ops with the German locale active
- **THEN** all labels, states, and errors render from the German catalog

#### Scenario: Catalog parity
- **WHEN** the English and German catalogs are compared
- **THEN** both define the same Career Ops keys
