# Sales-platform checkpoint verification

31 October 2026, Europe/Berlin. Application source is frozen at
`c655b8e3aa0d9aada5ac3c533bef13688b8ec700` on the task-owned sales branch.
This checkpoint extends the preserved shell with guarded pipeline lifecycle and
recoverable saved views. It reuses existing authentication, authorization,
queries, optimistic cache/realtime machinery and integrations. The programme
and production-release acceptance remain open.

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
