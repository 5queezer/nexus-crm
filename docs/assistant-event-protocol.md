# Assistant event protocol

Nexus implements a validated AG-UI-compatible event subset over Server-Sent Events. The repository does not install an AG-UI SDK package, so this is a compatibility contract rather than a claim that the application uses a particular packaged AG-UI release.

The wire contract is defined in `lib/agent/protocol.ts`. It follows the official event names and fields for run lifecycle, text messages, tool calls, state snapshots, activities, and errors. Nexus adds `CUSTOM` events named `nexus.result`, `nexus.frontend_tool`, and `nexus.bulk_command` for application-specific typed results. Frontend tool values are validated again against `lib/assistant/frontend-capabilities.ts` before dispatch.

Each event carries a server-issued `eventId`, monotonically increasing `sequence`, `runId`, `threadId`, and timestamp. Events are persisted against the authenticated run, replayed from `/api/agent/runs/:id/events`, deduplicated by event ID, and only applied across a contiguous sequence. `/api/agent/runs/:id` reconstructs the current snapshot and marks an overdue run interrupted if no terminal event was recorded.

Tool argument deltas from the model are not executable. Nexus emits tool events only after the installed AI SDK has assembled and schema-validated the complete call. MCP arguments are omitted from the event transport, secret-shaped values are rejected by canonical proposal validation, and tool event inputs and outputs are recursively redacted before persistence or streaming. Browser context is bounded and advisory; every record, proposal, command, and approval is reauthorized server-side.

Protocol references verified during implementation:

- https://docs.ag-ui.com/introduction
- https://docs.ag-ui.com/concepts/tools
- https://docs.ag-ui.com/concepts/state
- https://docs.ag-ui.com/concepts/events
