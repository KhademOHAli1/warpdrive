# Workflow operations

This early-access implementation supports database-only manual deal follow-up flows, including exclusive text/boolean branches.
See [architecture](architecture.md), [status](status.md), and the
[user guide](../../docs-site/docs/features/automations.md) for the exact boundary.

## Install and run

Use the Bun version declared in the root package. Back up PostgreSQL and review pending
migrations before upgrading an existing installation. Migration `0083_visual_workflows.sql`
follows the merged Better Auth migrations. It creates definitions, immutable versions,
runs, and completed steps without converting existing CRM records into runs.

```sh
bun install --frozen-lockfile
bun run db:migrate
bun run build:docker
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

Terminal validation/permission failures are recorded and not blindly replayed. The UI has
no manual retry action yet. Unexpected database failures leave the cursor available for
retry/reconciliation. Persistent infrastructure failures need operator intervention.
A dead-letter/needs-review policy, quotas, retention, and alerting remain production gates.

Pausing prevents admission and leaves existing runs unchanged. Cancel those separately
when needed. Neither pausing nor cancellation reverses completed CRM effects.

## Sensitive data and simulation

Runs retain trigger references and step outputs internally. History responses expose coarse
metadata and completed-step counts. Do not expose payloads without current record-level
authorization and redaction. A retention/redaction job and broader audit/event journal
remain required for full R1.

Simulation rolls back the canonical database-only task action inside a savepoint. This does
not authorize future external-provider testing. No email, conferencing, or HTTP handler is
enabled. Such handlers need explicit simulation and ambiguous-delivery semantics.

## Validation

CI discovers workflow unit and real-PostgreSQL integration tests automatically. When Docker
is unavailable, use the optional disposable local lane in [architecture](architecture.md#testing).
Never point it at an application database. Build documentation separately in `docs-site`
using that package's own Bun declaration and lockfile.
