# Import mapping review

The preview offers a read-only review of the mapping that produced its validation counts.
Changing the mapping requires starting a new import. This resets the local wizard only;
the original uploaded batch, validated mapping, and counts remain in import history.
Leaving the wizard also leaves the batch intact. Preparation or validation already queued
may finish. Neither control cancels a background job, and neither starts a commit.

The client prevents mapping edits while a mapping request is pending and prevents duplicate
commit requests or restarting the wizard while a commit request is pending. Query failures
offer retries for reads without resubmitting a mapping or commit. Terminal counts are read
from the result endpoint rather than inferred from the commit enqueue response.

## Why the same batch cannot be remapped yet

`src/features/import/actions.ts` permits mapping changes only in `mapping_ready`.
`src/features/import/validateBatch.ts` validates pending and invalid rows; already valid rows
would retain values derived from the old mapping. Its mapping is also loaded before the
transaction that claims validation.

Commit authorization currently checks `ready` before enqueueing. The worker claims the
batch later in `src/features/import/batch.ts`. Jobs in
`src/features/import/jobRunner.ts` carry a batch ID and use that ID as their singleton key.
Resetting an existing batch to accept a mapping would allow an old queued commit to claim a
later `ready` state, or an old validation attempt to use an earlier mapping. A client Back
button cannot resolve those races.

## Separate lifecycle extension

Editable remapping needs a durable generation or revision for each mapping, carried in
validation and commit job payloads and checked by atomic claims. The extension must retain
ownership, permission, and CSRF checks, and reject a remap after a commit has been claimed.

In one transaction with consistent batch-row locking, a legal pre-commit remap must replace
the mapping, advance its generation, and reset all derived row data, including previously
valid rows, normalized values, diagnostics, and cached counts. Fresh validation must finish
before that generation can become eligible for commit. Queue singleton keys must distinguish
generations without allowing an earlier job to act on the current generation.

Before implementing that extension, real PostgreSQL tests must demonstrate owner and state
gates, complete resets, revalidation, concurrent remap and commit claims, stale validation
and commit jobs, duplicate delivery, and queue singleton behavior. The current client work
does not change server actions, worker claims, schemas, or database behavior, and its unit
fixtures do not qualify those backend races.
