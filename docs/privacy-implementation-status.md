# Privacy implementation status and evidence

Execution started 31 October 2026 on `codex/privacy-data-lifecycle`, from `a1a8f6da1ce366c35002900bf33508356dfbb995`. The integration and calendar worktrees remain independently owned. The approved [PRD](PRD-warpdrive-privacy-data-lifecycle.md), [backlog](privacy-data-lifecycle-tasks.md) and [test design](privacy-data-lifecycle-tests.md) remain the full scope.

The persistent goal is ACTIVE. Source implementation, local synthetic qualification, exact-revision CI, operator review and installed acceptance are separate gates. No task is ACCEPTED by this document.

## Task register

| Task   | Status      | Current evidence or next required work                                                                                                                                                                                                |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DPL-01 | IN_PROGRESS | Versioned registry, conservative source discovery and missing-store/writer tests; final source reconciliation and real catalog check pending.                                                                                         |
| DPL-02 | IN_PROGRESS | Explicit capability/case intersection, fresh session rechecks, generation tickets, atomic effect and privilege delegation tests. HTTP entry points and installed access review remain. See [authorization](privacy-authorization.md). |
| DPL-03 | IN_PROGRESS | Additive migrations, encrypted intake, immutable receipt/events, idempotent case commands and non-destructive discovery jobs. Full approved-action/response lifecycle and endpoint integration remain.                                |
| DPL-04 | IN_PROGRESS | Subject/recipient proof foundation being implemented; UI, external transport and abuse qualification remain.                                                                                                                          |
| DPL-05 | IN_PROGRESS | Calendar-month engine and durable policy-bound records/extensions. Local evidence is being consolidated. See [date decisions](privacy-deadline-decisions.md).                                                                         |
| DPL-06 | IN_PROGRESS | Encrypted drafts, immutable activated policy versions and global generation fencing. Installation facts and operator/legal approval remain OPEN.                                                                                      |
| DPL-07 | IN_PROGRESS | Reviewed paged subject discovery adapters.                                                                                                                                                                                            |
| DPL-08 | IN_PROGRESS | Disclosure rules and versioned export manifest.                                                                                                                                                                                       |
| DPL-09 | NOT_STARTED | Streamed private archives, checkpoints, storage and failure qualification.                                                                                                                                                            |
| DPL-10 | NOT_STARTED | Authenticated/revocable recipient delivery and real HTTP tests.                                                                                                                                                                       |
| DPL-11 | NOT_STARTED | FA/DE/EN personal and external request journeys.                                                                                                                                                                                      |
| DPL-12 | NOT_STARTED | FA/DE/EN administrative privacy workspace.                                                                                                                                                                                            |
| DPL-13 | NOT_STARTED | Reviewed closure and ownership handover integration.                                                                                                                                                                                  |
| DPL-14 | NOT_STARTED | Deterministic erasure previews, holds and expiring approvals.                                                                                                                                                                         |
| DPL-15 | NOT_STARTED | Structured erasure adapters and resumable receipts.                                                                                                                                                                                   |
| DPL-16 | NOT_STARTED | Historical/free-text/import/email erasure and uncertain-content review.                                                                                                                                                               |
| DPL-17 | NOT_STARTED | Real storage/version/object-lock lifecycle qualification.                                                                                                                                                                             |
| DPL-18 | NOT_STARTED | Concurrent writer/provider effect fences.                                                                                                                                                                                             |
| DPL-19 | NOT_STARTED | Purpose restriction and objection enforcement.                                                                                                                                                                                        |
| DPL-20 | NOT_STARTED | Corrections and downstream follow-up ledger.                                                                                                                                                                                          |
| DPL-21 | NOT_STARTED | Reviewed retention activation and impact previews.                                                                                                                                                                                    |
| DPL-22 | NOT_STARTED | Bounded retention jobs, leases and repair.                                                                                                                                                                                            |
| DPL-23 | NOT_STARTED | Artifact/proof expiry and log minimization.                                                                                                                                                                                           |
| DPL-24 | NOT_STARTED | Protected lifecycle record and restore admission.                                                                                                                                                                                     |
| DPL-25 | NOT_STARTED | Encrypted synthetic backup/restore rehearsal.                                                                                                                                                                                         |
| DPL-26 | NOT_STARTED | Minimal privacy audit viewer and access review.                                                                                                                                                                                       |
| DPL-27 | NOT_STARTED | Incident workflow and synthetic rehearsal.                                                                                                                                                                                            |
| DPL-28 | NOT_STARTED | Installation-accurate FA/DE/EN notices and help.                                                                                                                                                                                      |
| DPL-29 | NOT_STARTED | Staging domain/mail/device qualification, external inputs OPEN.                                                                                                                                                                       |
| DPL-30 | NOT_STARTED | Complete synthetic workflows with real DB/storage/SMTP.                                                                                                                                                                               |
| DPL-31 | NOT_STARTED | Actual browser/accessibility/RTL/calendar walkthroughs.                                                                                                                                                                               |
| DPL-32 | NOT_STARTED | Measured 10k-record/100-MiB resource/failure campaign.                                                                                                                                                                                |
| DPL-33 | NOT_STARTED | Candidate adversarial security review and disposition.                                                                                                                                                                                |
| DPL-34 | NOT_STARTED | Frozen install, full checks/builds and exact-revision green CI.                                                                                                                                                                       |
| DPL-35 | NOT_STARTED | Exercised operator/maintainer handoff in FA/DE/EN.                                                                                                                                                                                    |
| DPL-36 | NOT_STARTED | Required installation acceptance and explicit final sign-off.                                                                                                                                                                         |

## Test-first record

These are development observations, not exact-revision release evidence. The first tests ran with the shell's Bun 1.4.2; consolidated qualification must use the already-installed `.runtime/bin/bun` 1.4.4 matching `packageManager`. Use `PATH="$PWD/.runtime/bin:$PATH"` in this checkout. PostgreSQL tests use a disposable `postgres:16-alpine` container through the existing `colima-warpdrive` socket, never the application database.

| Test family                  | Observed RED                                                                                           | Subsequent observation                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.integration.test.ts` | Four failures: missing `privacy_cases`/`privacy_authority` relations.                                  | Four PG tests passed after migration 0083, including receipt/event mutation denial and independent case/job constraints.                                                  |
| `crypto.test.ts`             | Missing module, then missing fingerprint function for replay behavior.                                 | Encryption tests passed with randomized authenticated encryption and case/purpose binding.                                                                                |
| `states.test.ts`             | Missing transition validator.                                                                          | Three tests passed for staged verification/approval/response, partial work and refusal.                                                                                   |
| `cases.integration.test.ts`  | Missing case-command module.                                                                           | Initial three tests passed; extended rollback and hostile-input tests passed in the 12-test core PG run.                                                                  |
| `jobs.integration.test.ts`   | Missing durable job module.                                                                            | Three PG tests passed for duplicate enqueue, competing/expired leases, unchanged case state and authority withdrawal.                                                     |
| `casePersistence.test.ts`    | Programmer TypeError was incorrectly converted to a storage retry.                                     | Regression fixed to minimize operational database errors while propagating cancellation and programmer errors; final consolidated result pending.                         |
| Authorization families       | Missing capabilities/guard/management modules; operational `err` initially committed a callback write. | 29 PG tests and one capability unit test passed on pinned Bun 1.4.4 through migration 0084; atomic rollback, actual lock race, delegation and policy generation included. |
| Deadline and policy families | Missing modules/tables; submillisecond receipt truncation exposed by a test.                           | 28 pure deadline tests and initial nine real-PG policy/deadline tests passed; final pinned-runtime evidence pending.                                                      |

Commands for consolidated checks and revision-bound results are recorded below when run. Passing a family does not satisfy the unimplemented parts of its task or every mapped C-series requirement.

## Foundation checkpoint qualification

Consolidated local source checks on 31 October 2026 use Bun 1.4.4, Vitest 5.0.5 and actual migrations through 0085:

| Command                                                        | Observed result                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                | Passed, no lockfile changes.                                                                  |
| `bun run typecheck`                                            | Passed after callback Result inference and readonly deadline types were corrected.            |
| `bun run i18n:check`                                           | Passed with zero catalog or new source findings. This does not establish browser acceptance.  |
| `bun run test:unit src/features/privacy --maxWorkers=2`        | 62 tests in eight files passed.                                                               |
| `bun run test:integration src/features/privacy --maxWorkers=1` | 74 tests in 13 files passed against disposable real PostgreSQL.                               |
| `bun run lint`                                                 | Passed, including i18n, Biome and type-aware ESLint; 11 existing warnings, no checks skipped. |

The unit and PG runs above started at 16:07:51 Europe/Berlin. The source fingerprint is `322db753b742bb11b37c4a2fc55bcc8b7b4fbea5a4d671293e28c1b5431edaef`, also recorded in the [machine-readable inventory](privacy-inventory-report.json). The report classifies 93 migrated tables and 1,471 declarations, including conservative writer/effect signatures. Its counts do not establish installed physical/provider coverage.

Additional test-first review regressions reproduced and then fixed stale disclosure after return to verification, execution after case cancellation/refusal, incorrect exhausted-attempt diagnostics, code-less real pool acquisition timeout, and advancement with a timestamp but no current identity proof. The 74-test PG run includes these regressions. Returning to verification or cancelling invalidates its verification generation; discovery rechecks current case state before claim and completion. Public privacy routes and new FA/DE/EN screens are not implemented at this checkpoint.

Published foundation: [draft PR 4](https://github.com/KhademOHAli1/warpdrive/pull/4), source commit `0bb43ac303dbb0ce087fdeccfbfb4848a1996dc1`. Its [first CI run](https://github.com/KhademOHAli1/warpdrive/actions/runs/41213652448) passed types, lint, marketing and documentation checks; the full unit suite reported 5,793 passing and one failing test because the known error-domain list omitted the new PRIVACY domain. PostgreSQL and CRM/worker builds were skipped after that failure and are not qualified by that run. The same failure was reproduced locally before adding PRIVACY to the explicit domain list; the format and uniqueness assertions remain intact. Exact-revision CI is being rerun.

DPL-07 paged candidate discovery and DPL-08 disclosure/archive helpers are now in progress in separate owned files. No complete discovery, export or UI acceptance is asserted. No earlier authentication CI run is substituted for this branch's evidence. The complete project and required external acceptance remain open.

## External gates

All are OPEN, and no installed acceptance receipt is asserted:

- Controller/processor identity, jurisdiction-specific decisions, rights channel, purposes/grounds, recipients/subprocessors and transfer locations.
- Reviewed retention activation, holds/exceptions, lifecycle-record purpose/expiry and backup residual periods.
- Staging domain/HTTPS and secret-store setup; designated external mail recipients and specific send authorization.
- Physical passkey devices, fallback/recovery and FA/DE/EN installed walkthroughs.
- Provider capability/contract decisions, bucket versioning/object-lock behavior and remote acknowledgement.
- Production-profile backup/restore, accepted RPO/RTO, current lifecycle-record replay and incident contacts.

Missing external input does not stop independent source work. It must not be filled with invented facts or replaced by local mocks, and the persistent goal cannot complete while a required gate remains open.
