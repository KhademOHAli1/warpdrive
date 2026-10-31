# Privacy implementation status and evidence

Execution started 31 October 2026 on `codex/privacy-data-lifecycle`, from `a1a8f6da1ce366c35002900bf33508356dfbb995`. The integration and calendar worktrees remain independently owned. The approved [PRD](PRD-warpdrive-privacy-data-lifecycle.md), [backlog](privacy-data-lifecycle-tasks.md) and [test design](privacy-data-lifecycle-tests.md) remain the full scope.

The persistent goal is ACTIVE. Source implementation, local synthetic qualification, exact-revision CI, operator review and installed acceptance are separate gates. No task is ACCEPTED by this document.

## Task register

| Task   | Status      | Current evidence or next required work                                                                                                                                                                                                                   |
| ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DPL-01 | IN_PROGRESS | Current source/catalog reconciliation covers 93 application tables with zero missing/invalid declarations. Physical objects/providers/backups remain separately unqualified; inventory grants no lifecycle capability.                                   |
| DPL-02 | IN_PROGRESS | Explicit capability/case intersection, current fresh/MFA proof and generation fences, including future-proof denial. HTTP endpoints and installed access review remain. See [authorization](privacy-authorization.md).                                   |
| DPL-03 | IN_PROGRESS | Additive encrypted cases, immutable minimal events and idempotent commands/non-destructive discovery jobs. Durable approved scopes, action/response lifecycle, worker/endpoint integration and UI remain.                                                |
| DPL-04 | IN_PROGRESS | Encrypted subject/recipient proof, self verification, operator review and recipient-change invalidation are implemented. External delivery, complete UI/abuse journeys and installed proof remain. See [verification](privacy-identity-verification.md). |
| DPL-05 | IN_PROGRESS | Calendar-month engine and durable policy-bound deadline/extension records, including rejection of future notice records. Actual notice delivery and installation-specific decisions remain. See [date decisions](privacy-deadline-decisions.md).         |
| DPL-06 | IN_PROGRESS | Encrypted drafts, immutable activated policy versions and generation fencing. Actual controller/purpose/recipient facts and operator/legal approval remain OPEN.                                                                                         |
| DPL-07 | IN_PROGRESS | listPrivacyDiscoveryPage returns bounded candidate IDs/provenance for 18 adapters with 75 explicit table dispositions. It always remains incomplete and review-required; durable approved scope and remaining adapters are absent.                       |
| DPL-08 | IN_PROGRESS | Pure buildDisclosureManifest/projectDisclosureRecord and archive-path/CSV contracts exist. Actual server-sealed review, source-record/attachment integration, complete safe projections and delivery remain.                                             |
| DPL-09 | IN_PROGRESS | writePrivacyExportArchive streams TAR/gzip with serial sources and size/SHA checks. Codec receipt only: private storage, durable jobs/leases/checkpoints, quotas, publication, repair and scale qualification remain.                                    |
| DPL-10 | NOT_STARTED | Authenticated/revocable recipient delivery and real HTTP tests.                                                                                                                                                                                          |
| DPL-11 | NOT_STARTED | FA/DE/EN personal and external request journeys.                                                                                                                                                                                                         |
| DPL-12 | NOT_STARTED | FA/DE/EN administrative privacy workspace.                                                                                                                                                                                                               |
| DPL-13 | NOT_STARTED | Reviewed closure and ownership handover integration.                                                                                                                                                                                                     |
| DPL-14 | NOT_STARTED | Deterministic erasure previews, holds and expiring approvals.                                                                                                                                                                                            |
| DPL-15 | NOT_STARTED | Structured erasure adapters and resumable receipts.                                                                                                                                                                                                      |
| DPL-16 | NOT_STARTED | Historical/free-text/import/email erasure and uncertain-content review.                                                                                                                                                                                  |
| DPL-17 | NOT_STARTED | Real storage/version/object-lock lifecycle qualification.                                                                                                                                                                                                |
| DPL-18 | NOT_STARTED | Concurrent writer/provider effect fences.                                                                                                                                                                                                                |
| DPL-19 | NOT_STARTED | Purpose restriction and objection enforcement.                                                                                                                                                                                                           |
| DPL-20 | NOT_STARTED | Corrections and downstream follow-up ledger.                                                                                                                                                                                                             |
| DPL-21 | NOT_STARTED | Reviewed retention activation and impact previews.                                                                                                                                                                                                       |
| DPL-22 | NOT_STARTED | Bounded retention jobs, leases and repair.                                                                                                                                                                                                               |
| DPL-23 | NOT_STARTED | Artifact/proof expiry and log minimization.                                                                                                                                                                                                              |
| DPL-24 | NOT_STARTED | Protected lifecycle record and restore admission.                                                                                                                                                                                                        |
| DPL-25 | NOT_STARTED | Encrypted synthetic backup/restore rehearsal.                                                                                                                                                                                                            |
| DPL-26 | NOT_STARTED | Minimal privacy audit viewer and access review.                                                                                                                                                                                                          |
| DPL-27 | NOT_STARTED | Incident workflow and synthetic rehearsal.                                                                                                                                                                                                               |
| DPL-28 | NOT_STARTED | Installation-accurate FA/DE/EN notices and help.                                                                                                                                                                                                         |
| DPL-29 | IN_PROGRESS | Staging preparation CLI and explicit anonymous HTTPS observation exist; default report has 12 OPEN gates and never accepts. Actual domain/revision, mail/device inputs, delivery and installed acceptance remain OPEN.                                   |
| DPL-30 | NOT_STARTED | Complete synthetic workflows with real DB/storage/SMTP.                                                                                                                                                                                                  |
| DPL-31 | NOT_STARTED | Actual browser/accessibility/RTL/calendar walkthroughs.                                                                                                                                                                                                  |
| DPL-32 | NOT_STARTED | Measured 10k-record/100-MiB resource/failure campaign.                                                                                                                                                                                                   |
| DPL-33 | NOT_STARTED | Candidate adversarial security review and disposition.                                                                                                                                                                                                   |
| DPL-34 | NOT_STARTED | Frozen install, full checks/builds and exact-revision green CI.                                                                                                                                                                                          |
| DPL-35 | NOT_STARTED | Exercised operator/maintainer handoff in FA/DE/EN.                                                                                                                                                                                                       |
| DPL-36 | NOT_STARTED | Required installation acceptance and explicit final sign-off.                                                                                                                                                                                            |

## Test-first record

These are development observations, not exact-revision release evidence. The first tests ran with the shell's Bun 1.4.2; consolidated qualification must use the already-installed `.runtime/bin/bun` 1.4.4 matching `packageManager`. Use `PATH="$PWD/.runtime/bin:$PATH"` in this checkout. PostgreSQL tests use a disposable `postgres:16-alpine` container through the existing `colima-warpdrive` socket, never the application database.

| Test family                  | Observed RED                                                                                           | Subsequent observation                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.integration.test.ts` | Four failures: missing `privacy_cases`/`privacy_authority` relations.                                  | Four PG tests passed after migration 0083, including receipt/event mutation denial and independent case/job constraints.                                                  |
| `crypto.test.ts`             | Missing module, then missing fingerprint function for replay behavior.                                 | Encryption tests passed with randomized authenticated encryption and case/purpose binding.                                                                                |
| `states.test.ts`             | Missing transition validator.                                                                          | Three tests passed for staged verification/approval/response, partial work and refusal.                                                                                   |
| `cases.integration.test.ts`  | Missing case-command module.                                                                           | Initial three tests passed; extended rollback and hostile-input tests passed in the 12-test core PG run.                                                                  |
| `jobs.integration.test.ts`   | Missing durable job module.                                                                            | Three PG tests passed for duplicate enqueue, competing/expired leases, unchanged case state and authority withdrawal.                                                     |
| `casePersistence.test.ts`    | Programmer TypeError was incorrectly converted to a storage retry.                                     | Regression fixed to minimize operational database errors while propagating cancellation and programmer errors; covered by the current combined qualification below.       |
| Authorization families       | Missing capabilities/guard/management modules; operational `err` initially committed a callback write. | 29 PG tests and one capability unit test passed on pinned Bun 1.4.4 through migration 0084; atomic rollback, actual lock race, delegation and policy generation included. |
| Deadline and policy families | Missing modules/tables; submillisecond receipt truncation exposed by a test.                           | 28 pure deadline tests and initial nine real-PG policy/deadline tests passed; current combined pinned-runtime qualification recorded below.                               |

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

The foundation unit and PG runs above started at 16:07:51 Europe/Berlin. That historical source fingerprint was `322db753b742bb11b37c4a2fc55bcc8b7b4fbea5a4d671293e28c1b5431edaef`, with 93 migrated tables and 1,471 declarations. The current machine-readable report is described in the newer checkpoint below. Neither source inventory establishes installed physical/provider coverage.

Additional test-first review regressions reproduced and then fixed stale disclosure after return to verification, execution after case cancellation/refusal, incorrect exhausted-attempt diagnostics, code-less real pool acquisition timeout, and advancement with a timestamp but no current identity proof. The 74-test PG run includes these regressions. Returning to verification or cancelling invalidates its verification generation; discovery rechecks current case state before claim and completion. Public privacy routes and new FA/DE/EN screens are not implemented at this checkpoint.

Published foundation: [draft PR 4](https://github.com/KhademOHAli1/warpdrive/pull/4), exact published HEAD `86ea68f6f8680ea67206148c96205a3e90830f99`. Its [green push CI](https://github.com/KhademOHAli1/warpdrive/actions/runs/41214643227) and [green PR CI](https://github.com/KhademOHAli1/warpdrive/actions/runs/41214648075) passed 5,794 unit tests, 2,128 real-PostgreSQL tests, types, i18n/lint and the CRM, worker, marketing-site and documentation builds. Those runs qualify that foundation revision, not the newer uncommitted M2 checkpoint or an installation.

The earlier `0bb43ac303dbb0ce087fdeccfbfb4848a1996dc1` [first CI run](https://github.com/KhademOHAli1/warpdrive/actions/runs/41213652448) found the missing PRIVACY entry in the explicit error-domain test list. The failure was reproduced locally before fixing the list; format/uniqueness assertions remain. The green `86ea68f6f8680ea67206148c96205a3e90830f99` runs above supersede that failed run.

## Current local M2 checkpoint

The source inventory fingerprint is `b25ccb7aca0f967c875bca53e3d4573516d4af5e9315f1419da91192709a4850`, recorded in the [current inventory report](privacy-inventory-report.json). It covers 1,837 scanned sources, 93 application tables and 1,539 classified declarations, with zero missing/invalid items. Conservative writer, source-review and manual callback declarations are not a count of independent stores. Generic lifecycle capabilities remain unsupported. See the [reviewed boundaries](privacy-data-inventory.md).

| Command                                                        | Observed current-checkpoint result                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                | Passed on pinned Bun 1.4.4, exit zero. The only promoted direct dependencies are tar-stream 3.2.0 and its types 3.1.5. |
| `bun run typecheck`                                            | Full check passed, exit zero; source unchanged after that run.                                                         |
| `bun run test:unit src/features/privacy --maxWorkers=2`        | 196 tests in 20 files passed, 5.27 seconds.                                                                            |
| `bun run test:integration src/features/privacy --maxWorkers=1` | 84 tests in 17 files passed on disposable real PostgreSQL, 10.74 seconds.                                              |
| `bun run lint`                                                 | Exit zero: i18n had zero errors, Biome checked 3,439 files with 11 existing warnings, and type-aware ESLint passed.    |
| `git diff --check`                                             | Passed.                                                                                                                |

The combined unit/PG runs both started at 17:40:12 Europe/Berlin on 31 October 2026, using Bun 1.4.4 and Vitest 5.0.5. Their execution logs are retained outside the checkout in the chat workspace under `work/checkpoint-validation/unit.log` and `pg.log`. These are local working-tree results; full-repository CI for the next published commit is still required. No earlier authentication/foundation CI is substituted for that candidate.

### Implemented narrow contracts and remaining work

- `listPrivacyDiscoveryPage` requires current verified case authority and returns pages of at most 100 candidate IDs/provenance. Eighteen candidate readers and 75 explicit per-table blockers/dispositions cover the catalog; additional queue/object/provider/backup and reviewed-scope blockers remain. `complete` stays false and every candidate needs review. No stable, durably approved whole-subject scope is sealed.
- `buildDisclosureManifest` and `projectDisclosureRecord` are pure validation/projection contracts. They distinguish access and portability, preserve server-review decisions, exclude security material and account for unsupported categories. Archive-path and CSV helpers address unsafe paths/formulas. They do not authenticate callers, obtain approval, query all data, verify stored bytes or deliver an archive.
- `writePrivacyExportArchive` snapshots manifest expectations and streams caller-provided readable sources through regular TAR/gzip entries into a supplied writable, checking entry sizes/hashes and producing a compressed-output receipt. Late/unused-stream cleanup races were fixed test-first. The codec does not establish sink privacy, source authority, durable execution, storage completion, publication or full DPL-09 acceptance. Real PostgreSQL/object-storage export jobs, leases/checkpoints, cancellation/repair, quotas and the declared scale profile remain.
- `prepareAuthStagingRun`/`runAuthStagingCli` provide bounded preparation reports; explicit `probeAuthStagingHttps` observes anonymous EN/FA/DE login HTTPS only when configured authorization matches the origin/revision. Certificate/hostname verification and response/time bounds remain enabled, and redirects are not followed. The report always retains `accepted:false` and the probe `revisionVerified:false`. Loopback TLS tests are synthetic transport evidence, not proof of deployed revision, authenticated cookies, SMTP, external delivery or physical passkeys. See [staging qualification](privacy-auth-staging.md).

The pure category context does not yet bind projection field decisions, source record fingerprints and exact file/object descriptors into one sealed review. A future durable server scope sealer/loader must derive and couple those descriptors and hash expectations. The codec checks caller-supplied hashes faithfully; that receipt alone does not establish approved source provenance. These helpers currently have no HTTP/job integration and make no complete disclosure claim.

Additional adversarial regressions were observed failing before fixes: future fresh/MFA timestamps could authorize effects, and a future recorded notice could extend a case. Current authority/deadline validation denies these inputs. They added no store, migration or external effect. The combined runs above include these regressions; actual delivery/notice evidence remains separately required.

No public privacy routes, new FA/DE/EN personal/admin screens, durable reviewed-scope UI or complete user journeys are implemented at this checkpoint. Current UI remains unchanged. DPL-07/08/09/29 stay IN_PROGRESS; no complete discovery, export, storage, UI or installed acceptance is asserted. The full 36-task project and persistent goal remain open.

## Migration allocator and integration gate

The privacy branch has exercised its local migrations through 0085. These local numbers do not reserve a shared allocation or establish a mapping for integration with the independently owned calendar/integration worktrees.

| Local privacy migration         | Shared allocator mapping/reservation |
| ------------------------------- | ------------------------------------ |
| `0083_privacy_foundations`      | NOT_RESERVED; mapping pending.       |
| `0084_privacy_policy_deadlines` | NOT_RESERVED; mapping pending.       |
| `0085_privacy_identity`         | NOT_RESERVED; mapping pending.       |

Before combining branches, obtain and record the authoritative allocator reservation/mapping, reconcile the actual migration journal/snapshots without overwriting peer work, and rerun real upgrades plus exact-revision CI on the combined candidate. No range or cross-branch mapping is claimed as booked here.

## External gates

All are OPEN, and no installed acceptance receipt is asserted:

- Controller/processor identity, jurisdiction-specific decisions, rights channel, purposes/grounds, recipients/subprocessors and transfer locations.
- Reviewed retention activation, holds/exceptions, lifecycle-record purpose/expiry and backup residual periods.
- Staging domain/HTTPS and secret-store setup; designated external mail recipients and specific send authorization.
- Physical passkey devices, fallback/recovery and FA/DE/EN installed walkthroughs.
- Provider capability/contract decisions, bucket versioning/object-lock behavior and remote acknowledgement.
- Production-profile backup/restore, accepted RPO/RTO, current lifecycle-record replay and incident contacts.

Missing external input does not stop independent source work. It must not be filled with invented facts or replaced by local mocks, and the persistent goal cannot complete while a required gate remains open.
