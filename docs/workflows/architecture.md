# Visual workflow architecture

Status: first foundation increment, 31 October 2026. Source baseline: fork main `d37518a`, before workflow changes. Runtime execution and application UI are not enabled by this increment.

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

These controls cover workflow authoring. The executor must additionally rehydrate its identity, check current CRM visibility/permissions and connection authority, and apply an approved scope on each resumed step. The current increment does not execute actions or add HTTP endpoints.

## Execution work still required

CRM events must be saved in an outbox in the same transaction as each mutation. Existing PostgreSQL NOTIFY messages support real-time UI and are not the durable event source. The planned engine persists admissions, step progress, attempts, effects, waits, and cancellation in PostgreSQL and dispatches through pg-boss workers under Bun.

Database-only actions should commit effects with progress where possible. External effects need stable effect identities, provider idempotency where supported, and explicit reconciliation for ambiguous outcomes. Existing email outbox behavior is a reusable boundary; general exactly-once external delivery is not promised.

Published definitions are only safe to expose as active automations once run admission, execution, recovery, permissions, and UI are integrated and qualified. No application route currently invokes the foundation's publication service.

## Testing

The standard unit/integration test lanes discover feature tests automatically. PostgreSQL tests use real migrations and database connections. Docker remains the default integration harness.

An optional isolated local lane is provided when Docker is unavailable:

```sh
WORKFLOW_TEST_DATABASE_URL=postgres://workflow_test@127.0.0.1:55434/postgres \
  bun --bun vitest run --config vitest.workflows.config.ts
```

Supply an already running disposable local PostgreSQL instance with a `workflow_test` role that can create databases. The lane rejects other hosts/roles, creates a uniquely named migrated template, and uses isolated cloned databases. Do not point it at an application database or a shared production cluster. Stop/remove the disposable cluster after the test campaign; ordinary CI continues to use disposable Docker containers.
