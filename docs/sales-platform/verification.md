# Sales-platform checkpoint verification

The earlier 31 October 2026 checkpoint froze application source at
`c655b8e3aa0d9aada5ac3c533bef13688b8ec700` on the task-owned sales branch.
This checkpoint extends the preserved shell with guarded pipeline lifecycle and
recoverable saved views. It reuses existing authentication, authorization,
queries, optimistic cache/realtime machinery and integrations. The programme
and production-release acceptance remain open.

## Builtin presentation and native selection checkpoint

Source `03100336a1053155d282f4f8e016e509bdb7ec31` was adopted by a normal local
merge at `7c10761647633a6d2c0f701f3a1426d58357ee96`. Both trees equal
`4924b8a4a7ad4abad9b12db18c0aa7142656a93b`. The changed source introduces no
Sales DDL, dependency change or modification of the eight approved originals.
People, Organizations and Leads now persist strict V1 builtin columns/sort,
resolve native ID-only selected views before data admission, preserve personal
baselines and block unavailable selections. The complete implemented behavior is
in [the contract](saved-view-presentation-contract.md).

| Check                           | Actual terminal result                     | Scope                                                                                                        |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Affected units                  | 425 tests/33 files passed, 17.770 seconds  | One worker, 45-second guard, minimum 14,487,355,392 free bytes                                               |
| Full route types and TypeScript | Exit 0, 12.185 seconds                     | 90-second guard, 5 GiB floor, minimum 13,215,555,584 free bytes                                              |
| Actual PostgreSQL               | 18 tests/three files passed, 5.101 seconds | PostgreSQL 16, one worker, selected synthetic 85-entry history; exact peer baseline restored                 |
| Full repository lint            | Exit 0, 39.529 seconds                     | i18n, Biome 3697 files, typed ESLint; 11 existing warnings and nine infos; minimum 12,040,028,160 free bytes |

Native cases cover six envelope round trips, nine native preference selections
and three strict-write preservation cases. They do not establish runtime browser,
shared revocation after waits or retained-installation upgrade acceptance.
The lock and journal hashes are unchanged in the source-bound evidence.

The first scoped typed lint failed with 18 diagnostics, repaired at 91cc233;
its 56-file rerun passed, followed by the three newly changed files passing on
03100336. The first full type attempt generated route types successfully, then
failed with 44 diagnostics: 42 output optional-key cascades, one address fixture
and one bare/envelope union assertion. The outer schema optional output and two
fixture repairs at 03100336 passed the final unit, type, PostgreSQL and lint checks.
No failed attempt is overwritten or presented as a pass.

Behavioral RED receipts remain separate: 38 data failures, 20 shared presentation
failures, separate layout-only and malformed-selection failures, 41 selection
failures, nine initial-route failures, and two principal-fence failures. The final
scope batch had 15 failures, of which 14 were behavioral and one was an ambiguous
implicit output-status fixture; its real status assertions stayed unchanged.
See [the sanitized receipt record](evidence/saved-view-presentation-2026-11-01.json)
for actual timing, counts, hashes and boundaries. Raw logs remain private.

The latest production build-checked application remains f006 below. Current-source
FA/DE/EN browser, accessibility, provider, current-main/retained-history and release
gates remain open. The separate unadopted Deals server sort/paging path has six
native cases whose later attempt stopped before database setup or assertions;
it provides infrastructure evidence only and is outside this 18-case batch.
All 16 projects and 128 parent tasks remain in scope with zero completed parents.

## Separate Deals runner attempts

The unadopted client selection first executed 14 cases across three files:
five passed and nine failed in 12.693 seconds. Seven failures reproduced missing
create/unarchive/realtime invalidation and have candidate fixes awaiting GREEN.
The inline-edit case returned undefined cache data from a fixture configured with
a zero cache lifetime. That lifetime was corrected without changing its assertions;
the membership oracle still needs a valid RED run. The long paging case
hit its five-second test timeout and supplies no behavioral failure oracle.

Later targeted attempts 2 through 4 stopped before RUN. Attempts 5 and 6 reached
RUN but executed zero cases; the separately granted 90-second attempt ended at
90.239 seconds with exit 143. The frozen native six-case attempt likewise reached
RUN, then stopped before database creation or any assertion. Its watchdog sent
TERM at 180 seconds; the existing kill grace produced 185.261 seconds total and
wrapper exit 137 (reported child exit -9). The overrun was acknowledged. Its
minimum free space was 12,948,320,256 bytes and Docker returned to the exact
original three-container baseline. Lock and selected 85-entry journal were unchanged.

These later attempts supply neither behavioral RED nor GREEN. The server
implementation stays held; client fixes and the new owner-metadata tests stay
unqualified. The prepared, unexecuted future native wrapper reserves ten seconds
for cleanup within its 180-second total, and needs a fresh grant. Read the
[source and receipt handoff](deal-list-runner-status.md) for classifications,
hashes and dependency-loading observations. Existing presentation proof above
and frozen source packs remain unchanged.

## Completion and stored-view preservation checkpoint

Application source `901ba96d668a29fa5d34a38a9fc0dfc7bc25014e` passed full Next route type generation and
TypeScript in 4.072 seconds and full-repository lint in
39.073 seconds, in separate finite groups with a 5 GiB disk
floor. The preceding type attempt on 2133e94 exited 2 on two test assertion
comparator types; commit 601be53 repairs those assertions without changing
production code. That failed attempt is retained in the source-bound evidence. The first full
lint stopped at the queue i18n audit; commit 3b79edc aligns the three Farsi ICU
count contracts and renames a test-only helper under the existing audit convention.
A second lint attempt passed i18n but stopped on qualification-contract.md table
formatting; 59cb7d9 changes only that document. A third lint attempt reached full typed ESLint and found two recovery-test callback
issues. The 901ba96 test-only repair awaits the actual rejected response; 23
pipeline tests/3 files and affected typed lint passed. Full types and final full
lint then passed together on `901ba96d668a29fa5d34a38a9fc0dfc7bc25014e` with unchanged production files since
3b79edc. The later affected
completion/queue selection passed 68 tests/6 files.

Real PostgreSQL reproduced two completion replay failures among six cases on
2fdef03. The minimal d4bf15a repair locks the activity row and returns the
already-desired canonical row before any UPDATE. All six cases across two files
then passed, including concurrent identical completions, permission/parent
denial and saved-definition refusal/metadata preservation for all four entities.
The test container returned to the peer baseline after both finite runs.

Completion action input is now parsed strictly after existing CSRF/actor checks
and before the native command. Its 24 boundary tests passed after an actual
17-failure RED; seven-file typed lint passed. The selected native fixture uses
the synthetic 85-entry Sales history. It does not qualify current-main upgrades,
revocation while waiting, durable command-intent receipts or native UI recovery.
Queue quick completion remains unwired. See
`evidence/activity-replay-and-view-preservation-2026-11-01.json`.

## Earlier bounded source checks

The later `db925000ec20b9b8d8a3131ae3d183553d2a080c` write-boundary repair
rejects lossy saved-definition inputs for all four entities. RED reproduced 26
failures among 49 new schema cases. The final schema/read-compatibility selection
passed 105 tests/5 files, and scoped typed ESLint passed the three changed files
in 6.595 seconds, minimum free space 19,657,760,768 bytes. Subsequent full TypeScript and actual PostgreSQL preservation results are
recorded above. No stored-data rewrite or native UI result is inferred.
See `evidence/saved-view-write-boundary-2026-11-01.json` and
`saved-view-presentation-path.md` for the later implemented three-entity path and
its remaining native-browser/Deals gates.

Source `15950b6d81083b14239b5f54539ae828af406d67`, including queue, native lead
export permission guard and the separate qualification catalog/preview, passed
full Next route type generation and TypeScript. The finite process returned
terminal 0 in 21.264 seconds, with minimum live free space 14,998,421,504 bytes
above its 5 GiB floor. The prepared untracked activity replay test was compiled
only and hash-recorded; no native replay assertion was executed.

Scoped typed ESLint for the 18 new export/qualification files passed in 6.089
seconds, minimum free space 20,424,019,968 bytes. Committed qualification plus
adjacent stage contracts passed 43 tests/6 files in 1.015 seconds. The formatted
lead export route plus adjacent permission/CSV units passed 44/5 in 1.532 seconds.
These checks establish no current full lint/build, native browser, installed
framework or migration upgrade. See
`evidence/qualification-export-static-2026-11-01.json` and
`evidence/lead-export-permission-2026-11-01.json`.

The latest full build-checked application remains f006 below. The later builder
adoption, distribution and recovery changes have narrower evidence:

- Builder workflow/auth/locale: 133 units/47 files; workflow PostgreSQL 22/8,
  on the preserved adopted workflow tree. Full combined types/build/browser
  qualification is separate.
- Distribution `0d8247f`: two effective Docker-context/notice tests, scoped Biome
  and typed ESLint passed. No Docker image or transitive notice closure observed.
- Pipeline outcome recovery `b120ab9`: intended behavioral RED followed by 23
  passing adjacent tests; the later formatted regression is included in the
  125-test run below. No backend authority or full-reload durability changed.
- Queue client/API/route/navigation plus affected existing activity-table and
  pipeline recovery regressions: 125 units/16 files passed in 12.175 seconds,
  one worker and at least 12,512,600,064 available bytes. These tests do not replace
  current full type/lint/build or native browser evidence.

The initial queue PostgreSQL collection run executed no assertions. The later
importable fail-closed baseline ran all 14 cases: 13 failed assertions and one
scaffold pass. That pass is not operational-read qualification. The preserved
proposed SQL implementation was restored afterward. Its separately granted GREEN
passed all 14 tests/4 files in 6.124 seconds, with at least 12,231,712,768 available
bytes and the original Docker baseline restored. The actual independent-reader
table-lock timeout returned safe `E_DB_004`; that proof is distinct from the
earlier scaffold pass. All seven native production files are hash-identical
through source `62466a7`. Later focused queue units passed 44/5 after typed-test
cleanup, and scoped typed ESLint passed 38 files in 7.588 seconds. The initial
23 and subsequent 14 lint diagnostics remain recorded as failed attempts.
No scaffold is presented as working functionality.
See `next-action-queue-contract.md` for exposure and remaining native write gates.

## Rename and template continuation

The later application source is `f006b5a5026449fd2bf792439b9149ba3517feb8`.
Its full root unit suite passed 6068 tests across 972 files and its affected
PostgreSQL batch passed 245 tests across 51 files. Full typecheck and full lint passed with terminal exit 0; the existing
11 warnings and 9 informational notices remain.

The first production build was deliberately stopped with terminal exit 143 during
the user-authorized shared resource-recovery window. The later explicitly granted
finite build passed with terminal exit 0 on the same source, in 60.222 seconds.
The separate process group and watchdog observed at least 12558819328 available
bytes, above the 5 GiB floor. No production service was started or deployed.
Current-source worker bundles were not rerun in that slot; prior c655 bundling
remains separately scoped. See the [source-bound check record](evidence/r1-rename/qualification.json).

See [guarded rename](pipeline-rename-contract.md),
[stage-only template contract](template-contract.md) and
[native continuation evidence](evidence/r1-rename/native-journey.json).
The template code is strict manifest validation and deterministic preview only;
installation remains unavailable pending persistence and authority qualification.
The full roadmap remains active and all broad parent packages remain open.

## Earlier c655 checkpoint evidence

| Check                                         | Actual result                                                                                                                                                      | Evidence ceiling                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full root unit suite                          | 966 files, 6020 tests passed                                                                                                                                       | Terminal successful rerun in `.runtime/sales-evidence/slice-unit-final.log`; unit evidence, not every DB/provider path                                                    |
| Affected PostgreSQL integration batch         | 50 files, 239 tests passed                                                                                                                                         | Pipelines, saved filters, deals, permissions and queue-observer integration in the finite PostgreSQL Testcontainers profile; `.runtime/sales-evidence/slice-db-final.log` |
| Type generation and full TypeScript           | Passed, terminal exit 0 confirmed                                                                                                                                  | `.runtime/sales-evidence/slice-typecheck-final.log`; route generation plus silent successful `tsc`                                                                        |
| Full lint                                     | Passed, terminal exit 0 confirmed; 11 warnings and 9 informational notes remain                                                                                    | i18n, Biome and typed ESLint in `.runtime/sales-evidence/slice-lint-final.log`; no automatic fixes applied by this final check                                            |
| Native lifecycle and unsupported-view journey | Pipeline archive/restore persisted with one audit each; unsupported Farsi view stayed blocked through hard reload; explicit clear restored 29 permitted open cards | Task-owned synthetic profile and existing native Better Auth UI only; [journey record](evidence/r1-lifecycle/native-journey.json) and captures below                      |
| Quarantined database restore                  | All 103 tables and 1885 rows matched counts and ordered row digests across `public`, `drizzle` and `pgboss`                                                        | Synthetic PostgreSQL 18.1 with frontend/import producer quiesced; [restore manifest](evidence/r1-lifecycle/restore.json), source commit `c655b8e`                         |
| Optimized production web build                | Passed, terminal exit 0 confirmed on `c655b8e`                                                                                                                     | Private synthetic build environment; `.runtime/sales-evidence/r1-web-build.log`; no production service start, deployment, provider operation or performance acceptance    |
| Worker/WS/operator bundling                   | Passed, terminal exit 0 confirmed                                                                                                                                  | `.runtime/sales-evidence/r1-workers.log`; build artifacts only, no worker/provider operation inferred                                                                     |
| UI registry source audit                      | All 23 pristine registry files verified, terminal exit 0                                                                                                           | `.runtime/sales-evidence/r1-ui-audit.log`; local hash check, not remote update or accessibility qualification                                                             |

The local restore includes the 85 applied Drizzle rows and pg-boss tables. Empty
job tables matching an empty restored queue do not establish crash recovery of
in-flight work. Database file/attachment rows matching their digests do not
establish restoration of object bytes. No object files, real external-delivery
outcomes, divergent legacy upgrades, RTO/RPO target or older-binary rollback was
qualified. The general outbound worker was not started; existing native
instrumentation's import workers and producers were quiesced for the snapshot.

## Native checkpoint journeys and limits

The native task profile used synthetic records and the existing password sign-in
and account-security re-verification flow. Expired proof was rejected. After
native password re-verification, archive and restore succeeded with one audit
for each action; no authentication policy was relaxed.

Original captures in the preserved current shell include:

- [English pipeline directory](evidence/r1-lifecycle/directory-en.png), retaining the authored Farsi/German pipeline name.
- [Farsi directory](evidence/r1-lifecycle/directory-fa.png) and [390-pixel directory](evidence/r1-lifecycle/directory-fa-mobile.png).
- [German archive confirmation](evidence/r1-lifecycle/archive-confirm-de.png), [archived state](evidence/r1-lifecycle/archived-de.png) and [restored state](evidence/r1-lifecycle/restored-de.png).
- [Fresh proof required](evidence/r1-lifecycle/fresh-proof-required-de.png), showing the existing security boundary.
- [Unavailable Farsi saved view](evidence/r1-lifecycle/unavailable-view-fa.png), with persistent recovery and suppressed cards/totals.

The unsupported synthetic definition used version 99. Selecting it retained the
selection and blocked visible cards and totals. A hard reload remained blocked
and omitted the initial card/amount payload. Explicit recovery then showed 29
permitted open cards. The raw JSONB definition was unchanged. See the
[journey record](evidence/r1-lifecycle/native-journey.json).

The original in-document RSC bootstrap had already delivered permitted data
before the view switch. This journey does not claim to retract previously
delivered bytes; the blocked hard-reload observation is separate. Browser
captures show selected local flows, not native human language review, full
accessibility, provider operation, pilot use or global R1 acceptance.

## Earlier unsuccessful slice-wide attempt

The first slice-wide run in `.runtime/sales-evidence/slice-unit-all.log` ended
with 960 passing files and 3 failing files, 6005 passing tests and 5 failing
tests, plus one unhandled render error. It was not a successful broad run.

- `Board.viewPersistence.test.tsx` exposed a real wrapper defect: spreading an
  absent RPC result created a successful-looking scope receipt without cards,
  which crashed board derivation. Reading required result data before attaching
  the receipt keeps that condition in the query-error/retry state. The original
  clear-filter assertion remained and retry behavior was added to the test.
- Three date-refetch assertions expected one RPC argument and an exact old
  cache-value shape. The required requests were already sent with the saved
  locale/calendar/timezone. Tests now also assert cancellation signals and the
  same single load-bearing cache key while allowing internal scope receipts.
- The empty-list test awaited any live status and read the new checking state
  before query completion. It now awaits the completed empty response, retains
  the assertion that an empty pipeline is not described as holding excluded
  deals, and verifies the filter request and cancellation signal.

Focused reproductions preceded those fixes. The final 966-file, 6020-test unit
run above supersedes this failed attempt for the frozen checkpoint. Historical
R0 evidence below remains separately scoped.

## Historical R0 foundation checkpoint

31 October 2026, Europe/Berlin. The R0 application source was the committed
combined checkpoint `b8b2708d4076551b803451ce10d4928a87ce35cd`. The sales additions
at that stage were read-only inspection/ledger tooling and documentation. These
results describe that earlier scope, before the lifecycle and saved-view slice.

### R0 rerun evidence

| Check                               | Actual result                                                                                                                      | Evidence ceiling                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pinned runtime and frozen install   | Bun 1.4.4, 1099 installs checked, no changes                                                                                       | Task-owned APFS clone of dependencies, independently verified frozen install; global Bun unchanged                      |
| Inherited root unit run             | 5897 tests passed across 952 passing files; one newly collected migration-tool test suite failed before its implementation existed | This was not an all-green full-suite result; the incomplete TDD suite was subsequently implemented and rerun            |
| Final sales foundation tests        | 44 passed across 2 files                                                                                                           | Unit/CLI policy, malformed paths/exports, exact lineage, package hashes, DAG and completion-evidence checks             |
| Actual PostgreSQL integration batch | 82 passed across 13 files                                                                                                          | Pipelines, permissions, saved filters and existing combined migration clean/upgrade tests, PostgreSQL 16 Testcontainers |
| Type generation and TypeScript      | Passed                                                                                                                             | Full candidate typecheck after the new tooling; the earlier in-progress test indexing errors were fixed                 |
| Full lint                           | Passed with 11 existing warnings and 9 informational cookie/optional-chain notices                                                 | i18n, Biome and type-aware ESLint; immutable approved snapshots excluded from formatting to preserve their hashes       |
| Worker/WS/operator bundling         | Passed                                                                                                                             | Bundling only; no provider/worker operation inferred                                                                    |
| UI source registry                  | All 23 pristine registry files verified                                                                                            | Local source hash audit, not remote registry update or accessibility qualification                                      |
| Native fixture database             | Actual 85-entry combined chain applied to a new PostgreSQL 18.1 database                                                           | Matching exported applied hashes in `evidence/local-disposable-ledger.json`; not a retained installation                |
| Quarantined database restore        | All 90 tables and 1862 rows matched by count and ordered row digest                                                                | New synthetic database only; no object-store or external-effect restore qualification                                   |
| Programme guard                     | 128 tasks, 16 projects, 12 journey categories, 0 completed parent packages                                                         | Register integrity, not acceptance sufficiency                                                                          |

The broad unit run began while another agent was in its required red phase.
Its failure was the missing `migrationLineage` module, not an inherited application
assertion failure. The final focused 44-test run passed after implementation.
At R0, a second all-green broad unit run was not claimed. Subsequent domain
changes and the successful frozen-checkpoint rerun are recorded above.

Commands use the task-owned `.runtime/bin/bun` (1.4.4) first on PATH:

```sh
bun install --frozen-lockfile
bun run test:unit --maxWorkers=2
DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock TESTCONTAINERS_RYUK_DISABLED=true bun run test:integration src/db/integrationWorkflowMigration.integration.test.ts src/features/pipelines src/features/permissions src/features/saved-filters --maxWorkers=1
bun run test:unit scripts/sales-platform --maxWorkers=2
bun run typecheck
bun run lint
bun run build:workers
bun run ui:audit
bun run sales:check
bun run sales:migrations:inspect --checkout candidate=. --ledger candidate=docs/sales-platform/evidence/local-disposable-ledger.json
```

Private raw runtime logs and the database dump remain in ignored `.runtime/`.
They are excluded from deliverables, as are native synthetic credentials,
session values, capture-mail state and generated keys. The shipped ledger
export contains only migration IDs, timestamps and SQL hashes.

### R0 current-shell browser baseline

A separate loopback Next development server and PostgreSQL profile were created
for synthetic data only. Native credential setup uses the existing Better Auth
password hasher/account model, then the existing `/api/auth/sign-in/email`
endpoint. It returned 200 and its native signed cookie. No session-row insertion,
legacy dev-login route, policy relaxation, peer cookie or peer database was used.

Captured original current-shell states:

- `evidence/board-en-desktop.png`, 1440 by 1000, LTR and Inter.
- `evidence/board-fa-desktop.png`, 1440 by 1000, RTL and Vazirmatn.
- `evidence/board-fa-mobile.png`, 390 by 844, existing compact mobile shell.
- `evidence/regional-fa-desktop.png`, persisted Farsi settings with UTC and
  Gregorian unchanged by the locale switch.
- `evidence/regional-de-desktop.png`, German after explicitly choosing the
  Persian calendar and Europe/Berlin; both remained selected.
- `evidence/board-de-desktop.png`, German shell with original authored pipeline,
  stage and opportunity names unchanged.

The browser used the existing regional settings controls, not direct preference
SQL, to perform these changes. Computed fonts/direction and persistent page
headings were inspected after saving. The demo deals are USD and were not
converted by locale. IRR/toman display-unit vectors still need the owning
unmerged regional capability and its combined qualification; these screenshots
do not establish those vectors.

A cold development regional navigation failed with a 66-second timeout. A later
request succeeded, then warmed regional/board flows and saves succeeded. The
read-only probe measured an indexed preferences lookup at 0.161 ms, no waiting
locks/deadlocks, and 17 cluster connections against max 100. Host load was about
52 on 11 logical CPUs, and the Next/Bun process was CPU-busy. This supports a
resource/dev-process explanation, but exact JavaScript causation is unproven.
No auth or timeout rule was weakened. Performance acceptance remains open.

That baseline did not establish a full production web build, dark-theme matrix,
768/1280 widths, 200/400 percent reflow, screen-reader run, moderated usability
study or contextual native-review sign-off. It remains baseline evidence, not
complete R1 UI acceptance.

## Remaining programme and release gates

- Actual retained-installation ledgers and supported WF-0083/MAIL-dev convergence
  and recovery; no source-file match can replace them.
- Immutable MAIL handoff and platform-owned combined metadata/allocation review.
- Existing WF automatic event/outbox/wait and IG effects must be actual exports
  with their own qualification before sales consumes them.
- Real participant/reviewer evidence for the planned twenty studies and affected
  FA/DE/EN complete-state journeys.
- Production-mode performance, object/file restore, interrupted upgrades,
  rollback compatibility, queues, unknown external outcomes and finite pilot use.
- Real-source onboarding and ownership for optional product signals, following
  the selected first-party contract; the local example remains synthetic.
- Full adversarial surface isolation before independent workspaces or external
  partner access is enabled.

The full programme goal remains active. These local increments and passing checks do not by themselves close its broad
parent tasks or establish global release acceptance.
