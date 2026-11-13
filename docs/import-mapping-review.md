# Import mapping review

Use **Review mapping** in **Preview** to inspect the mapping behind the validation
counts. To change it, start a new import. The original batch and its validated
mapping stay in import history. A queued preparation or validation can finish
after you leave the wizard. Select **Import** to submit the validated rows.

The client prevents mapping edits while a mapping request is pending and prevents duplicate
commit requests or restarting the wizard while a commit request is pending. Query failures
offer retries for reads without resubmitting a mapping or commit. Terminal counts are read
from the result endpoint rather than inferred from the commit enqueue response.

## Why the same batch cannot be remapped yet

`src/features/import/actions.ts` permits mapping changes only in `mapping_ready`.
`src/features/import/validateBatch.ts` validates pending and invalid rows; already valid rows
would retain values derived from the old mapping. Its mapping is also loaded before the
transaction that claims validation.

Commit authorization checks `ready` before enqueueing. The worker claims the batch
in `src/features/import/batch.ts`. Jobs in `src/features/import/jobRunner.ts` carry
the batch ID and use it as the singleton key. Reopening a validated batch for
mapping could let a queued commit claim a later `ready` state or a queued
validation use an older mapping.

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
