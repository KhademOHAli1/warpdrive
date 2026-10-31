# Visual workflow architecture

Status: initial manual-run implementation, 31 October 2026. Source baseline: fork main `d37518a`, before workflow changes. The first editor and worker are implemented; the complete R1 acceptance scope remains in progress.

## Definitions

`src/features/workflows/schemas.ts` defines a language-neutral graph format. A published definition has a single entry trigger, at most 100 nodes and 200 edges, stable node IDs, registered action types/versions, and explicit output ports. Display names are user-authored, so Persian and German names are preserved.

`registry.ts` declares configuration schemas and typed inputs/outputs for the first action vocabulary. A registry entry describes a contract; it is not evidence that an executable handler or provider integration exists. Current entries cover manual/record triggers, record reads, activity creation, conditions, delays, and notifications.

`definition.ts`, `graph.ts`, and `references.ts` reject malformed structures, unknown action versions, invalid ports, cycles, unreachable nodes, duplicate IDs, incomplete branches, unavailable predecessor references, unknown output paths, unsafe property traversal, and incompatible bindings. Exact monetary values have a distinct decimal type and cannot be implicitly used as numeric delays. R1 uses a tree-shaped graph with exclusive conditions, without arbitrary cycles or implicit joins. Parallel composition and iterators require later explicit semantics.

## Drafts and publication

Drafts accept structurally valid incomplete configuration so users can save work while editing. Publication performs full graph/configuration/reference validation. Draft updates compare the expected revision in the database; a stale save returns a conflict rather than replacing a newer draft.

Publication locks the workflow row, validates the expected revision, and creates an immutable version with its name, definition, publisher, and timestamp. A repeated publication of the same active content returns that version. Editing the draft does not change the published snapshot.

Migration `0078_visual_workflow_definitions.sql` creates the tables and adds two database guards beyond the generated table schema: a composite foreign key that keeps a published pointer on a version of the same workflow, and a trigger that rejects updates/deletes of published versions. Later migration work must retain these guards. Archive definitions rather than rewriting their history.

## Authorization

`access.ts` centralizes the six workflow capabilities: view, create, edit, publish, run, and cancel. Inactive users are denied, administrators retain the application's explicit bypass, and regular users require both ownership and the appropriate flag. Publication is classified as high risk for permission-set administration. English, Farsi, and German permission labels are included.

The manual executor rehydrates its initiating user before each step and uses current CRM visibility and activity-creation permissions. Server actions require a live application context and CSRF validation; tRPC reads check workflow ownership and view permissions. Run-history responses exclude recorded CRM values, whose visibility may change after a run.

## Initial manual execution

The enabled path is manual start, visible deal read, and one or more undated task creations. Tasks are assigned to the initiating user and linked to the chosen deal. Unsupported actions and activity fields are rejected at publication and execution. Registry contracts for later capabilities do not enable those actions.

Admissions use a caller-generated request key, pin an immutable published version, and persist the cursor before enqueueing. Reusing a key with different inputs is rejected. A pg-boss worker resumes the persisted cursor; startup and minutely reconciliation recover missed enqueues. Competing workers lock the run row. CRM database effects, step completion, and cursor advancement commit in the same transaction, so failure rolls back the effect as well as progress.

Simulation invokes the same canonical CRM service inside a rolled-back savepoint. It persists run/step evidence while retaining no task mutations. This strategy is restricted to the current database-only task action; future external effects require separate simulation adapters. Runs use published versions, so the current UI requires publication before simulation.

Cancellation records who cancelled and when, and prevents subsequent steps. It does not undo already committed tasks. Pausing prevents new admission; existing runs continue unless explicitly cancelled. Permission revocation and user deactivation are checked again at every resumed step.

The initial library and editor use the existing application shell, theme tokens, Radix adapters, locale formatting, and local fonts. React Flow 12.12.0 is MIT licensed and supports the application's React peer versions. Its vertical graph has an equivalent keyboard-accessible step selector; configuration supports literal task titles and mapped deal titles. English, Farsi, and German catalogs are registered with the existing translation checker.

## Further execution work

CRM events must be saved in an outbox in the same transaction as each mutation. Existing PostgreSQL NOTIFY messages support real-time UI and are not the durable event source. The planned engine persists admissions, step progress, attempts, effects, waits, and cancellation in PostgreSQL and dispatches through pg-boss workers under Bun.

Database-only actions should commit effects with progress where possible. External effects need stable effect identities, provider idempotency where supported, and explicit reconciliation for ambiguous outcomes. Existing email outbox behavior is a reusable boundary; general exactly-once external delivery is not promised.

The current UI is an early-access manual workflow builder, not the complete R1 release. CRM triggers/outbox, branches, durable waits, notifications, email, richer CRM actions, detailed payload inspection, retention, and operational limits still require implementation and qualification.

Primary library references: [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility), and [pg-boss workers](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md).

## Testing

The standard unit/integration test lanes discover feature tests automatically. PostgreSQL tests use real migrations and database connections. Docker remains the default integration harness.

An optional isolated local lane is provided when Docker is unavailable:

```sh
WORKFLOW_TEST_DATABASE_URL=postgres://workflow_test@127.0.0.1:55434/postgres \
  bun --bun vitest run --config vitest.workflows.config.ts
```

Supply an already running disposable local PostgreSQL instance with a `workflow_test` role that can create databases. The lane rejects other hosts/roles, creates a uniquely named migrated template, and uses isolated cloned databases. Do not point it at an application database or a shared production cluster. Stop/remove the disposable cluster after the test campaign; ordinary CI continues to use disposable Docker containers.
