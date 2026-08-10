## ADDED Requirements

### Requirement: Machine and public reads exclude demos
MCP, internal-agent, and public-share application queries SHALL exclude demo applications and demo-owned child data for ordinary and global/admin read scopes.

#### Scenario: MCP list and filtered list
- **WHEN** MCP lists applications for a tenant or global admin scope
- **THEN** no demo application is returned and pagination totals describe only real rows

#### Scenario: MCP direct lookup
- **WHEN** MCP requests a demo application by ID or canonical URL
- **THEN** the result is indistinguishable from not found

#### Scenario: Event and package queries
- **WHEN** MCP queries activity, events, submissions, documents, or recall packages
- **THEN** demo-parent records and demo application references are excluded with correct visible cursors

#### Scenario: Public share
- **WHEN** a share page is generated for an owner with demo data
- **THEN** no demo application is disclosed or counted

### Requirement: Machine mutations cannot target demos
MCP and internal-agent read-before-write paths SHALL treat demo applications as unavailable and SHALL not update, delete, attach children to, or derive artifacts from them.

#### Scenario: Demo-targeted mutation
- **WHEN** a machine tool attempts update, deletion, event, note, contact, submission, document-link, or CV generation against a demo ID
- **THEN** the operation returns a controlled not-found/access-denied result and performs no mutation

#### Scenario: Upsert by demo canonical URL
- **WHEN** MCP upserts a real application using a canonical URL that exists only on a hidden demo
- **THEN** the demo is not updated and normal real-application conflict/create rules apply

### Requirement: Demo visibility is backend-equivalent
Prisma and Firestore SHALL apply demo visibility before pagination, limits, cursor generation, nested relation hydration, and aggregate computation.

#### Scenario: Excluded rows precede visible rows
- **WHEN** demo rows sort before real rows in a bounded query
- **THEN** the query continues until it fills the visible page or exhausts real rows and returns a cursor based only on visible data
