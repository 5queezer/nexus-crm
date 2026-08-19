## Purpose

Lets a Nexus user see and resolve a Hermes approval gate from the browser when the connected Hermes advertises approval support, so a privileged agent action is decided by an authenticated human owner rather than by assistant text, and states the limitation honestly when the feature is not available.

## ADDED Requirements

### Requirement: Capability-gated approval surface
The system SHALL offer approval controls only when the connected Hermes advertises approval resolution, and SHALL state the limitation instead of inventing behavior when it does not.

#### Scenario: Approvals advertised
- **WHEN** the connected Hermes advertises approval resolution and a run reports an approval requirement
- **THEN** the system presents an approval prompt with explicit approve and reject controls

#### Scenario: Approvals not advertised
- **WHEN** the connected Hermes does not advertise approval resolution
- **THEN** the system shows a stated capability limitation and offers no approval control

### Requirement: Understandable, sanitized approval prompt
The system SHALL present an approval request as a non-technical summary of the operation together with the operation name and the sanitized arguments the supported event contract provides, and SHALL NOT display secrets or raw internal payloads.

#### Scenario: Approval prompt content
- **WHEN** an approval requirement is reported for a run
- **THEN** the prompt shows a plain-language summary, the operation being requested, and its sanitized details

#### Scenario: Secret-bearing details
- **WHEN** the approval details contain credential-like content
- **THEN** the displayed prompt omits that content

#### Scenario: Details cannot be recovered
- **WHEN** a run awaiting a decision is rejoined after a disconnect, so the operation and its arguments are no longer retrievable
- **THEN** the system states that the details could not be recovered
- **AND** offers only rejection, because an approval prompt that cannot show what is being approved must not authorize it

#### Scenario: Approval state is not color-only
- **WHEN** a run is waiting for approval
- **THEN** the waiting state is conveyed by text or an icon in addition to any color

### Requirement: A decision is bound to the action that was disclosed
The system SHALL bind every approval that grants permission to the specific prompt Nexus disclosed and to the choices that prompt offered, and SHALL refuse a granting decision that cannot be shown to answer such a disclosure. Ownership of a run SHALL NOT by itself authorize an action.

#### Scenario: Decision without a disclosed prompt
- **WHEN** an authenticated owner submits a granting decision that carries no proof the corresponding prompt was disclosed
- **THEN** the system refuses the decision and forwards nothing upstream

#### Scenario: Decision broader than the prompt offered
- **WHEN** a granting decision selects a permission breadth the disclosed prompt did not offer, such as a session-wide or permanent grant for a gate that offered a single use
- **THEN** the system refuses the decision and forwards nothing upstream

#### Scenario: Decision replayed
- **WHEN** a decision that was already recorded for a disclosed prompt is submitted again
- **THEN** the system refuses it rather than re-authorizing the action

#### Scenario: Decision for a different run or user
- **WHEN** proof of disclosure issued for one run or one user is presented for another
- **THEN** the system refuses the decision

#### Scenario: Rejection is always available to the owner
- **WHEN** the owner rejects a gated action, including when the prompt could not be recovered after a disconnect
- **THEN** the system forwards the rejection, because rejection grants nothing and must remain available exactly when disclosure could not be reproduced

### Requirement: An action that cannot be shown in full is not approvable
The system SHALL treat an approval prompt whose disclosed action does not fit the display bound as rejection-only, and SHALL NOT offer approval for an action the human cannot have seen in full.

#### Scenario: Action exceeds the display bound
- **WHEN** the operation, summary or detail of an approval request is longer than the surface displays
- **THEN** the prompt is marked as not fully displayable and offers only rejection

#### Scenario: Action fits
- **WHEN** the whole disclosed action fits within the display bound
- **THEN** the prompt offers the choices the gate advertised

### Requirement: Authenticated, owner-scoped approval decisions
The system SHALL route every approval decision through an authenticated Nexus endpoint that verifies thread and run ownership before forwarding it, and SHALL reject decisions for runs the caller does not own.

#### Scenario: Owner approves
- **WHEN** the owner submits an approve decision for their waiting run
- **THEN** the system forwards the decision upstream and the run resumes

#### Scenario: Owner rejects
- **WHEN** the owner submits a reject decision for their waiting run
- **THEN** the system forwards the rejection upstream and the run does not perform the gated operation

#### Scenario: Foreign run decision
- **WHEN** a user submits an approval decision for another user's run
- **THEN** the system responds `404` and forwards nothing upstream

#### Scenario: Unauthenticated decision
- **WHEN** an unauthenticated caller submits an approval decision
- **THEN** the system responds `401` and forwards nothing upstream

#### Scenario: Invalid decision value
- **WHEN** a decision value outside the supported set is submitted
- **THEN** the system responds `400` and forwards nothing upstream

#### Scenario: No approval pending
- **WHEN** a decision is submitted for a run that is not waiting for approval
- **THEN** the system returns a controlled conflict outcome and does not alter the run's recorded result

### Requirement: No implicit or self-granted approval
The system SHALL NOT approve a gated operation automatically, SHALL NOT let assistant-generated content act as an approval, and SHALL require an explicit human action for every decision.

#### Scenario: Assistant text cannot approve
- **WHEN** assistant output contains text that reads as an approval or instructs approval
- **THEN** no decision is submitted and the prompt continues to await explicit human input

#### Scenario: Timeout does not approve
- **WHEN** an approval prompt is left unanswered
- **THEN** the system submits no decision on the user's behalf

#### Scenario: Keyboard-accessible decision
- **WHEN** a user navigates the approval prompt with the keyboard
- **THEN** both the approve and the reject control are reachable and operable, and each is labelled for assistive technology

### Requirement: Minimal approval audit metadata
The system SHALL record only the minimal metadata needed to attribute an approval decision, and SHALL NOT persist approval command payloads, arguments, or assistant reasoning in Nexus.

#### Scenario: Decision recorded minimally
- **WHEN** an approval decision is forwarded
- **THEN** Nexus retains only the owning user, run, most recent decision, and its timestamp

#### Scenario: A run with several gates
- **WHEN** one run resolves more than one approval gate
- **THEN** the record reflects the most recent decision on that run
- **AND** earlier decisions on the same run are not separately retained

#### Scenario: Undelivered decision is not recorded
- **WHEN** an approval decision fails to reach the agent
- **THEN** no decision is recorded against the run

#### Scenario: Payload not persisted
- **WHEN** an approval request carries operation arguments
- **THEN** those arguments are not written to Nexus storage

### Requirement: Post-approval data freshness
The system SHALL refresh the Nexus data views that an approved Career Ops action may have changed, so the workspace does not display stale application state after the run resumes.

#### Scenario: Approved action changes application state
- **WHEN** an approved run completes
- **THEN** the application-facing queries are invalidated so the workspace reloads current Nexus data

#### Scenario: Rejected action
- **WHEN** a run's gated operation is rejected
- **THEN** the workspace's application data is left as it was
