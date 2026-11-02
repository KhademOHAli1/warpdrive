# Visual workflow architecture

Status: connectable manual node builder with exclusive conditions, 31 October 2026. Integration baseline: fork main `8539fe8`, including Better Auth and its current UI. The first editor and worker are implemented; the complete R1 acceptance scope remains in progress.

## Definitions

`src/features/workflows/schemas.ts` defines a language-neutral graph format. A published definition has a single entry trigger, at most 100 nodes and 200 edges, stable node IDs, registered action types/versions, and explicit output ports. Custom display names preserve Persian and German content. Optional `nameMode` distinguishes
automatic localized titles from custom names. Known generated titles in older drafts display
in the current locale without rewriting custom content. Optional bounded `layout` coordinates
persist node positions; these remain independent of language and RTL panel placement.

`registry.ts` declares configuration schemas and typed inputs/outputs for the first action vocabulary. A registry entry describes a contract; it is not evidence that an executable handler or provider integration exists. Current entries cover manual/record triggers, record reads, activity creation, conditions, delays, and notifications.

`definition.ts`, `graph.ts`, and `references.ts` reject malformed structures, unknown action versions, invalid ports, cycles, unreachable nodes, duplicate IDs, incomplete branches, unavailable predecessor references, unknown output paths, unsafe property traversal, and incompatible bindings. Exact monetary values have a distinct decimal type and cannot be implicitly used as numeric delays. R1 uses a tree-shaped graph with exclusive conditions, without arbitrary cycles or implicit joins. Parallel composition and iterators require later explicit semantics.

## Drafts and publication

Drafts accept structurally valid incomplete configuration so users can save work while editing. Publication performs full graph/configuration/reference validation. Draft updates compare the expected revision in the database; a stale save returns a conflict rather than replacing a newer draft.

Publication locks the workflow row, validates the expected revision, and creates an immutable version with its name, definition, publisher, and timestamp. A repeated publication of the same active content returns that version. Editing the draft does not change the published snapshot.

Migration `0083_visual_workflows.sql` creates the tables and adds two database guards beyond the generated table schema: a composite foreign key that keeps a published pointer on a version of the same workflow, and a trigger that rejects updates/deletes of published versions. Later migration work must retain these guards. Archive definitions rather than rewriting their history.

## Authorization

`access.ts` centralizes the six workflow capabilities: view, create, edit, publish, run, and cancel. Inactive users are denied, administrators retain the application's explicit bypass, and regular users require both ownership and the appropriate flag. Publication is classified as high risk for permission-set administration. English, Farsi, and German permission labels are included.

The manual executor rehydrates its initiating user before each step and uses current CRM visibility and activity-creation permissions. Server actions require a live application context and CSRF validation; tRPC reads check workflow ownership and view permissions. Run-history responses exclude recorded CRM values, whose visibility may change after a run.

## Initial manual execution

The enabled path is manual start, visible deal read, exclusive text/boolean conditions, and
undated task creation. `condition.ts` supports exists, strict equals/notEquals, and string
contains; numeric comparisons remain blocked. The executor follows exactly one `true` or
`false` edge according to the persisted result. Missing references fail the run instead of
silently selecting a false branch. Binding resolution accepts only own completed-output keys. Tasks are assigned to the initiating user and linked to the chosen deal. Unsupported actions and activity fields are rejected at publication and execution. Registry contracts for later capabilities do not enable those actions.

Admissions use a caller-generated request key, pin an immutable published version, and persist the cursor before enqueueing. Reusing a key with different inputs is rejected. A pg-boss worker resumes the persisted cursor; startup and minutely reconciliation recover missed enqueues. Competing workers lock the run row. CRM database effects, step completion, and cursor advancement commit in the same transaction, so failure rolls back the effect as well as progress.

Simulation invokes the same canonical CRM service inside a rolled-back savepoint. It persists run/step evidence while retaining no task mutations. This strategy is restricted to the current database-only task action; future external effects require separate simulation adapters. Runs use published versions, so the current UI requires publication before simulation.

Cancellation records who cancelled and when, and prevents subsequent steps. It does not undo already committed tasks. Pausing prevents new admission; existing runs continue unless explicitly cancelled. Permission revocation and user deactivation are checked again at every resumed step.

The initial library and editor use the existing application shell, theme tokens, Radix adapters, locale formatting, and local fonts. React Flow 12.12.0 is MIT licensed and supports the application's React peer versions. Nodes can be inserted unconnected, dragged, connected, reconnected, and removed without
implicit rewiring. `graphEditor.ts` checks ports, occupied inputs/outputs, trigger targets,
and cycles before changing the graph. `nodeLayout.ts` arranges trees and disconnected roots.
React Flow measurements are retained separately from persisted layout so selection and
language changes do not repeatedly invalidate node initialization. Substantial canvas-width
changes refit the graph; ordinary rerenders and language changes retain the camera. A shared Radix dialog
provides focused editing, Escape dismissal, and focus restoration. Per-node/edge selects
provide an alternative to drawing connections. Configuration maps only compatible ancestor
outputs. English, Farsi, and German catalogs use the existing translation checker; editor
feedback stores translation keys so live language changes update existing messages.

## Further execution work

CRM events must be saved in an outbox in the same transaction as each mutation. Existing PostgreSQL NOTIFY messages support real-time UI and are not the durable event source. The planned engine persists admissions, step progress, attempts, effects, waits, and cancellation in PostgreSQL and dispatches through pg-boss workers under Bun.

Database-only actions should commit effects with progress where possible. External effects need stable effect identities, provider idempotency where supported, and explicit reconciliation for ambiguous outcomes. Existing email outbox behavior is a reusable boundary; general exactly-once external delivery is not promised.

The current UI is an early-access manual workflow builder, not the complete R1 release. CRM triggers/outbox, grouped conditions, durable waits, notifications, email, richer CRM actions, detailed payload inspection, retention, and operational limits still require implementation and qualification.

Primary library references: [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility), and [pg-boss workers](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md).

## Testing

The standard unit/integration test lanes discover feature tests automatically. PostgreSQL tests use real migrations and database connections. Docker remains the default integration harness.

An optional isolated local lane is provided when Docker is unavailable:

```sh
WORKFLOW_TEST_DATABASE_URL=postgres://workflow_test@127.0.0.1:55434/postgres \
  bun --bun vitest run --config vitest.workflows.config.ts
```

Supply an already running disposable local PostgreSQL instance with a `workflow_test` role that can create databases. The lane rejects other hosts/roles, creates a uniquely named migrated template, and uses isolated cloned databases. Do not point it at an application database or a shared production cluster. Stop/remove the disposable cluster after the test campaign; ordinary CI continues to use disposable Docker containers.

## Builder edit history and run inspection

`useGraphHistory` stores at most 50 prior graph snapshots and clears redo when a new edit
follows undo. Save adopts normalized server content without adding an undo operation.
The server revision and saved comparison remain independent of local history. Node drag
frames use local canvas positions; only the final position becomes a graph edit. This is
session-local undo, not persisted version restoration. Text inputs retain native undo.

`drawConnection` validates the graph after removing only the edge being replaced. A fresh
drag from an occupied output moves that output; an explicit endpoint reconnection removes
only its selected edge. Failed gestures leave the original graph intact. Connected node
creation validates insertion and the new edge together. Existing-input ownership, cycle,
port, and trigger constraints remain domain rules shared by pointer and form controls.

`workflows.run` reuses workflow ownership/capability checks, restricts the run and pinned
version to the same workflow, and returns historical configuration plus safe step metadata.
Stored trigger values, outputs, and per-step CRM payloads are excluded. The read-only graph
marks completed nodes and edges on that immutable version. It does not infer compensation,
expose raw record values, or provide retries.
