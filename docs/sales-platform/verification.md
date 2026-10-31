# R0 foundation verification

31 October 2026, Europe/Berlin. Application source is the exact committed
combined checkpoint `b8b2708d4076551b803451ce10d4928a87ce35cd`. The sales additions
are read-only inspection/ledger tooling and documentation, not a new domain
schema, workflow engine, sender, auth authority or production release.

## Rerun evidence

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
No later application source change was made. Do not report this as a second
all-green broad unit run.

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

## Actual current-shell browser baseline

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

No full production web build, dark-theme matrix, 768/1280 widths, 200/400 percent
reflow, screen-reader run, moderated usability study or contextual native-review
sign-off is claimed. These are baseline observations, not R1 UI acceptance.

## Remaining release gates

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

The full programme goal remains active. None of its 128 broad parent tasks is
closed by these foundation increments alone.
