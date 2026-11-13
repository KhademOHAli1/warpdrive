# Simulate an unsaved workflow draft

Refs #682 / WF025.

In the version 1 editor, **Simulate draft** captures the current graph and display
name when the dialog opens. It requires edit and run authority on an unarchived
workflow and works before publication. For a deal-scoped manual workflow, choose
an existing visible deal. For a global manual workflow, confirm without selecting
a record. A visible archived deal can be selected, but the task service refuses
to create a task linked to it.

Version 2 has its own **Safe test** action. See [Workflow blocks](../workflow-blocks.md)
for that editor's test behavior.

The result identifies the captured draft and selected deal label, the test time, and the visited steps. Conditions show the selected branch. A reached task failure shows a failed step without exposing raw errors or configuration values. The graph remains editable after the dialog closes; running the simulation does not clear its unsaved changes or add an entry to published run history.

## Execution boundary

The server checks current workflow authority, selected-record visibility,
custom-field metadata, and the complete graph. The supported version 1 manual
profile covers eligible record reads and changes, activity creation, email drafts,
calendar activities, condition and filter paths, iterators, and configured delays.
Scheduled and webhook starts, live HTTP requests, and human forms require a
different execution mode. The definition limit is 100 nodes and 200 edges. A
straight path visits at most 100 distinct nodes, and iterator runs use a
separate 200-step budget. Input traversal is limited to 100,000 expanded
entries, depth 32, and 1,000,000 text units. Serialization before digest generation
is separately capped at 1,000,000 UTF-16 units. The authenticated action supplies
a cooperative ten-second abort signal.

The service executes the existing simulation paths in a writable transaction and always rolls that outer transaction back, including successful and contained business-failure receipts. Canonical task previews also retain their existing rolled-back savepoint with reminders disabled. No published version, workflow run, workflow step, worker nudge, notification or durable task is intentionally created. Unexpected database/program errors propagate after rollback. This is not a database read-only transaction.

Delay steps estimate a resume instant from a fresh database clock at each step and
continue immediately. Configured duration and scheduled-date waits use the same
input resolution as the live scheduler. Consecutive waits do not accumulate
virtual elapsed time. The legacy fixed-instant `until` format remains available
only to published runs.

The result includes submitted step identifiers and types, finite statuses, branch
ports, known error identifiers, estimated wait instants where applicable, iterator
counts, a deletion preview flag, and a digest with test time and workflow context. CRM outputs, activity IDs, run IDs, configuration values and actor identities are omitted. The interface renders localized step labels and generic failure copy, and does not display identifiers or the digest. The digest fingerprints UTF-8 JSON serialization of the captured submitted definition after current validation; it is not semantic graph equivalence, authority, anonymization or proof that a future live run will behave identically.

Closing the dialog discards its local view. A request already submitted may continue within the bounded server operation and roll back; closing does not promise server cancellation. Explicit retries perform a new transient simulation against current authority and metadata.

## Validation and remaining acceptance

Focused unit, PostgreSQL and native browser results must be stated against their actual qualified source and receipts. The new browser pack is designed for English desktop success, Persian mobile success and a reached canonical task failure after archiving its own selected deal. Its isolated synthetic database observations compare the draft, publication/run history and business rowsets before and after the real server action. Hosted success artifacts are preserved for visual review.

The original WF025 qualification covered the selected-deal profile. Its recorded
results apply to that source and scope. Use exact revision evidence for the current
global and expanded block profiles, browser and accessibility acceptance, release,
and deployment.
