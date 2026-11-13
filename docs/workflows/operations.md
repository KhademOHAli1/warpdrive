# Workflow operations

This early-access implementation supports database-only manual deal follow-up flows, including exclusive text/boolean branches.
See [architecture](architecture.md), [status](status.md), and the
[user guide](../../docs-site/docs/features/automations.md) for the exact boundary.

## Install and run

Use the Bun version declared in the root package. For an existing installation, follow the
[upgrade guide](../../docs-site/docs/operations/updating.mdx) and inspect the canonical
migration journal for the selected revision. The foundation migration is
`0086_visual_workflows.sql` in the current journal. It creates definitions, immutable
versions, runs and completed steps without converting CRM records into runs. Apply the
whole required migration chain with the dedicated migration role; do not run the
foundation SQL by itself.

```sh
bun install --frozen-lockfile
bun run db:migrate
```

The application produces jobs; the separate worker registers workflow handlers. Use the
existing Compose worker service in production. For source development, start the existing
worker entrypoint with the same environment as the app:

```sh
bun --env-file=.env src/entrypoints/worker.ts
```

Follow [authentication operations](../auth-operations.md) for onboarding and fresh
authentication. Development servers, disposable databases, and synthetic logins belong
on loopback in a separate environment.

## Queue and recovery

`workflow.run` processes a persisted cursor. `workflow.reconcile` scans the oldest 100
queued/running cursors on startup and every minute. Enqueues use a 30-second singleton
window per run. Each worker invocation advances at most 100 steps with a 45-second timeout;
graphs are also bounded to 100 nodes. The queue retry budget is three.

Reconciliation repairs a committed admission whose queue nudge failed. A step locks the
run row; database task creation and cursor/step persistence share one transaction. A crash
rolls both back. Competing workers serialize. Cancellation waits for an in-flight step
transaction and then prevents subsequent steps.

Terminal validation/permission failures retain an opaque failure generation. The original
runner can select **Retry failed step** after repairing an eligible database task failure.
A recorded failed trigger-deal read is also eligible when its immediate successor is a
supported task with a literal subject and an explicit binding to that same deal. The read
must reference the manual trigger record, and completed progress must match the pinned
execution path. See [failed-read retry contract](read-retry.md)
for the supported recovery boundary.
The server checks the live native session, current workflow permissions, active/unarchived
workflow, pinned graph, completed progress and current deal/task access. Recovery keeps the
same run, version, actor, cursor, completed steps and outputs. Completed tasks are not replayed.
A durable receipt binds the request key to that exact failure: lost responses and concurrent
clicks cannot consume a newer failure. Boot/minutely reconciliation also recovers a committed
retry whose queue nudge failed.

Migration `0100_workflow_failed_step_retry.sql` copies existing failed-run facts into
`legacy_snapshot` history without changing their runs, steps or CRM effects. The stored
update timestamp is shown as a snapshot time, not an invented historical attempt time.
Stop old application/worker writers before applying this migration and start the new
application and workers together afterward. An old worker failing after the backfill
snapshot cannot record a generation; mixed-version failure writing is unsupported.
Eligible legacy task snapshots retain their existing retry support. Legacy read snapshots
remain unavailable for retry; the new read path requires origin `recorded`.
Malformed progress, unsupported graphs/versions, simulations and failed waits remain
ineligible. In particular, an old failed wait has lost its deadline; retry never starts its
duration again. New wait failures retain their original deadline as history only.

Unexpected database failures leave the cursor available for retry/reconciliation.
Persistent infrastructure failures need operator intervention.
A dead-letter/needs-review policy, quotas, retention, and alerting remain production gates.

Pausing prevents admission and leaves existing runs unchanged. Cancel those separately
when needed. Neither pausing nor cancellation reverses completed CRM effects.

## Filtered run history

The run-history surface adds status/mode filters and 50-run older/newest pages through
an additive protected page query. The existing array API remains available. Reads
retain current server authority and the existing safe projection; pagination keys
retain PostgreSQL microseconds independently of display dates. See the
[bounded history contract](../development/workflow-run-history.md) for continuation,
acknowledgment, live-view and qualification limits.

## Sensitive data and simulation

Runs retain trigger references and step outputs internally. History responses expose coarse
metadata and completed-step counts. Do not expose payloads without current record-level
authorization and redaction. A retention/redaction job and broader audit/event journal
remain required for full R1. Failure history exposes stable error IDs, node references and
failure/retry times; retry request keys, actor/session IDs and CRM output payloads stay private.

Simulation rolls back the canonical database-only task action inside a savepoint. This does
not authorize future external-provider testing. No email, conferencing, or HTTP handler is
enabled. Such handlers need explicit simulation and ambiguous-delivery semantics.

## Validation

CI discovers workflow unit and real-PostgreSQL integration tests automatically. When Docker
is unavailable, use the optional disposable local lane in [architecture](architecture.md#testing).
Never point it at an application database. Build documentation separately in `docs-site`
using that package's own Bun declaration and lockfile.
