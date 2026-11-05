# Simulate an unsaved workflow draft

Refs #682 / WF025.

The editor's **Simulate draft** action captures the current graph and display name when the dialog opens. It is available to a current workflow owner with both edit and run authority on an unarchived workflow, including an inactive workflow with no published version. Choose an existing visible deal and confirm the simulation. Saving and publishing are separate actions. Visible archived deals can remain readable; the canonical task service still refuses a task linked to an archived deal.

The result identifies the captured draft and selected deal label, the test time, and the visited steps. Conditions show the selected branch. A reached task failure shows a failed step without exposing raw errors or configuration values. The graph remains editable after the dialog closes; running the simulation does not clear its unsaved changes or add an entry to published run history.

## Execution boundary

The server repeats current workflow authority, selected-record visibility, current custom-field metadata and complete graph validation. It accepts only the current version-one manual trigger, record read, task creation, condition and duration-delay profiles. Graphs are bounded to 100 nodes and 200 edges, and execution to 100 distinct visited steps. Input traversal is limited to 100,000 expanded entries, depth 32 and 1,000,000 text units before recursive parsing; serialization is separately limited to 1,000,000 UTF-16 units before digest generation. The authenticated action supplies a cooperative ten-second abort signal.

The service executes the existing simulation paths in a writable transaction and always rolls that outer transaction back, including successful and contained business-failure receipts. Canonical task previews also retain their existing rolled-back savepoint with reminders disabled. No published version, workflow run, workflow step, worker nudge, notification or durable task is intentionally created. Unexpected database/program errors propagate after rollback. This is not a database read-only transaction.

Delay steps calculate an estimated resume instant from a fresh database clock for each reached step and continue immediately. Consecutive delays do not accumulate virtual elapsed time. This initial implementation supports duration delays; the separate fixed-instant delay increment must be reconciled during integration before extending this boundary.

The result includes only submitted step identifiers/types, finite statuses and branch ports, known error identifiers, optional estimated wait instants, and a digest/time/workflow context. CRM outputs, activity IDs, run IDs, configuration values and actor identities are omitted. The interface renders localized step labels and generic failure copy, and does not display identifiers or the digest. The digest fingerprints UTF-8 JSON serialization of the captured submitted definition after current validation; it is not semantic graph equivalence, authority, anonymization or proof that a future live run will behave identically.

Closing the dialog discards its local view. A request already submitted may continue within the bounded server operation and roll back; closing does not promise server cancellation. Explicit retries perform a new transient simulation against current authority and metadata.

## Validation and remaining acceptance

Focused unit, PostgreSQL and native browser results must be stated against their actual qualified source and receipts. The new browser pack is designed for English desktop success, Persian mobile success and a reached canonical task failure after archiving its own selected deal. Its isolated synthetic database observations compare the draft, publication/run history and business rowsets before and after the real server action. Hosted success artifacts are preserved for visual review.

This increment uses a selected existing CRM record. Synthetic/sample trigger-input generation, additional node profiles, human accessibility and effect-language acceptance, the rest of WF025, included-main qualification and release/deployment remain separate gates.
