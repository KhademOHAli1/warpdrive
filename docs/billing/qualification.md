# Qualification of workspace billing (#978)

The source branch began at canonical main `3d50ce207c66db1e5414d4128f55aa110fea809e` and incorporates Calendar `e77991e3` plus the later Settings/workflow consolidation through `bd3e61d2`. Billing remains disabled by default. No real Stripe account configuration, charge, payout, release or deployment has been performed.

Actual local evidence before the final source freeze:

- Final focused unit/component invocation: **135 passing cases across 25 files**, including 47 billing cases, environment/example checks, existing Settings navigation journeys, error-domain/discovery coverage and actual source-hash/privacy registry checks.
- Final native invocation: **14 passing cases across five files**, including 12 billing recovery/concurrency/migration cases and two actual migrated-PostgreSQL inventory cases. Stripe is synthetic; application persistence is real PostgreSQL.
- The canonical 0105 migration passed a populated pre-billing upgrade: existing settings and all 105 prior migration receipts were unchanged; repeat application retained exactly 106 receipts.
- A real-PostgreSQL concurrency regression passed: the public user-reactivation writer was observed waiting on the runtime authority fence while the billing provider write was held; the active-user count stayed stable until that write completed.
- The initial source candidate passed hosted whole-app type generation/TSC, translations/typed lint, browser smoke, workflow/release validation, dependency audit, delivery tooling and all three CodeQL analyses. Its full unit run correctly failed on four missing billing integration declarations (error domain, discovery coverage and two privacy registry checks); those declarations are addressed in the final integration. That initial candidate did not reach native/build CI and is not the final acceptance evidence.

- The integrated whole application passes Next type generation and TypeScript. The changed billing/API/Settings/privacy modules pass the configured typed ESLint rules, with no disabled rule. Translation checks and changed-source Biome checks pass. The final source inventory has no missing/invalid identifiers, and source review hashes pass the actual registry test.

The replacement-checkout regression produced two actual assertion failures before the guard fix passed. Subsequent UI duplicate-alert, native provider-fixture and typed lint failures were corrected and retained in local logs before the final passing runs. The initial scaffold preceded complete tests; no claim of an entirely test-first implementation is made.

Tests use pinned Bun 1.4.4, configured lanes, a single local worker, task-local cache/TMP and no private dotenv loading. Disposable PostgreSQL resources are separate from the pre-existing development database. No shared dependency installation or protected preview/database service was modified.

Final exact-head hosted checks and resulting-main verification will be recorded in the delivery evidence. Native synthetic-provider evidence does not establish real Stripe acceptance, merchant tax configuration, financial retention compliance, global paid-access/invitation enforcement or release readiness. Those activation requirements are listed in `README.md`.
