# Qualification of the #978 source candidate

Base: `3d50ce207c66db1e5414d4128f55aa110fea809e`, observed canonical main on 5 November 2026. This is a work-branch candidate, not an integrated or production-ready feature.

Actual local results:

- Forty focused billing unit cases pass across six files: hosted Stripe request construction, idempotency headers/server pricing, secret-safe errors, test/live/customer binding, masked payment summaries, HMAC/body/timestamp checks, capacity/quote policy, document ownership, streaming cancellation and replacement-checkout admission.
- Twenty-nine existing environment/example cases pass across seven files. Combined invocation: 69 cases, 13 files, exit 0. Pinned Bun 1.4.4, configured unit lane, one worker, no private dotenv loading, task-local cache/TMP.
- Focused billing module TypeScript check passes. Its inspected dependency closure excludes the application DB client, billing runtime and store; this is not the declared whole-app typegen/TSC check.
- The same bounded module scope passes the repository's configured typed ESLint rules using its isolated module program. Runtime/store/schema/native-test and shared-environment whole-program qualification remain open.
- Configured Biome checks pass for all changed supported source/docs and `git diff --check` passes.
- Drizzle generated the four-table private SQL proposal without a database connection. This is source generation only, not a populated upgrade or migration admission.

The replacement-checkout regression first produced two actual assertion failures (canceled and incomplete-expired subscriptions) and then passed with the corrected guard. Initial missing HTTP module and an initial Zod generic type diagnostic were retained as setup/static failures, not behavioral test evidence. The original adapter/service scaffold preceded complete test coverage; no claim of an entirely test-first implementation is made.

Seven real-PostgreSQL integration cases are authored but have not been run locally: stable checkout replay; concurrent different checkouts; ambiguous provider reply recovery; conflicting quantity replay; foreign invoice denial; duplicate/reordered events; pending-payment seat capacity. Their setup also checks that adding the private proposal leaves a pre-existing settings row unchanged. The provider is an in-process HTTP stand-in; application DB persistence is real PostgreSQL when executed.

No database/container, application build, browser acceptance campaign, dependency install, production service, real Stripe request, charge or payout was started. No main commit, canonical migration, release or deployment was performed. The existing local heavy-job/migration queue remains owned by the Settings/integration coordinator. Required native/whole-app/CI/privacy/integration checks must pass before activation. Billing UI, shared paid-access/seat enforcement and real Stripe provider acceptance remain explicit separate gates.
