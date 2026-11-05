# Failed-read retry

This WF-028 / #685 increment extends the existing database-only failed-task recovery
profile to a recorded failed read of the manual trigger's deal. It does not close
WF-028 or establish installation, release or deployment acceptance.

## Eligible read

The failed cursor must be `record.read` with entity `deal`, with `recordId` explicitly
referencing the manual trigger's `recordId`. Its immediate `next` successor must be
`activity.create` with a supported nonempty literal subject and an explicit deal
binding to the trigger record or that read's ID. The complete pinned definition must
satisfy the existing retry profile, and retained steps and outputs must match the
exact completed execution path. A completed cursor, malformed prefix, unrelated read,
unsupported successor or richer configuration gains no eligibility.

The run must satisfy the existing live-run recovery conditions. The original runner
must have a current native session and current workflow/run authority; current deal
visibility and task readiness are checked before admission. These checks do not infer
current authority from historical outputs.

The older retry profile also excludes every definition with a `delay.until` member,
including a valid fixed-instant wait. Published execution may support that wait, but
the qualified retry path does not reinterpret it as a duration or fall back to an
older minutes mapping.

## Preserved execution

Retry retains the original run, published version, actor and failed cursor. It neither
replays earlier completed tasks nor rewrites their effects or outputs. The existing
failure-generation receipt permits once-only consumption and same-request replay;
an old request cannot consume a newer failure. The normal advance/reconciliation
path executes the resumed cursor. No schema, queue or worker contract is added.

## Migrated failures

Canonical migration `0100_workflow_failed_step_retry.sql` backfills stored failed-run
facts as `legacy_snapshot`. The new read path requires origin `recorded`; migrated
read snapshots remain unavailable for retry. Eligible legacy task snapshots retain
their existing retry support. A snapshot is not an invented historical attempt.

## Remaining scope

Failed waits, reads without the immediate supported task, simulations and richer
profiles outside the existing retry contract remain excluded. Full rerun/effect
review, broader retry qualification and repeated-failure or stuck-work alerts remain
open WF-028 work. No mail/provider/notification effect or lifecycle adapter is enabled.

See [operations](operations.md#queue-and-recovery) for current-session checks,
reconciliation, migration deployment and retained history boundaries. Exact-revision
unit, PostgreSQL, CI and browser evidence qualify their exercised paths separately;
source support does not establish all of those gates.
