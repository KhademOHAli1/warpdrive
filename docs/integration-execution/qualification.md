# BASE qualification record

Date: 31 October 2026, Europe/Berlin. Qualified application source:
`a01ca83d09ef40dfe2421f96e024c66dbee0c3e2`. Subsequent execution documentation and register
commits do not change application/runtime source. All commands use Bun 1.4.4 from
`/tmp/warpdrive-bun144/bin`, first on PATH; global Bun remains unchanged at 1.4.2.

## Reconciliation and test-first evidence

- Planning/UI source at `2f6098b` was clean before execution.
- Auth main `8539fe8` was already an ancestor.
- Workflow source `b8f25a4` was merged as `0894630`; clean calendar `9f0e9cc` was merged as `80ba5c4`.
- Integration migration 0083 was retained. Workflow SQL moved to 0084; the generated combined
  snapshot retains both table sets and follows integration snapshot ID. Original workflow FK
  and immutable-version trigger SQL is preserved byte-for-byte.
- New real-PostgreSQL clean-install/upgrade tests failed twice with absent workflow tables
  before journal/schema reconciliation, then both passed. Existing connection rows, opaque
  credential bytes, settings, audit rows, users and independent preferences remained equal.
- First broad unit baseline: 5,820 passed, two failed across 937 files. It exposed the missing
  INTEGRATION test-domain allowance and a hardcoded icon color. Focused red/green checks fixed
  both, preserving stable IDs and current provider artwork. Fixes are in `a01ca83`.

## Current gate

| Check                                 | Result                                             | Scope                                                                                                  |
| ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Independent frozen install            | Passed                                             | Original preview and reconciled workflow lockfiles, no global updates                                  |
| Full unit suite                       | 5,822 passed across 937 files                      | All root unit-lane files, final source head                                                            |
| Relevant PostgreSQL integration suite | 116 passed across 34 files                         | Integrations, MCP, OAuth, workflows, calendar round-trip, migration, native WS and realtime router     |
| Production application build          | Passed                                             | Webpack, synthetic private build env only                                                              |
| Worker/WS/operator bundling           | Passed                                             | Build entrypoints, actual separate worker/WS started                                                   |
| Type generation and TypeScript        | Passed                                             | Full project typecheck after final build                                                               |
| i18n and full Biome/ESLint lint       | Passed, 11 existing cookie/optional-chain warnings | Includes all current feature catalogs                                                                  |
| UI registry                           | Passed                                             | 23 pristine registry primitives and registry dry-run                                                   |
| Operational profile smoke             | 10 checks passed                                   | Actual worker consumption, native-session WS/auth denials/NOTIFY, real local S3 round-trip and cleanup |
| Wrong-profile smoke                   | Refused before writes                              | Different BASE_URL, no service changes                                                                 |

The 116 integration tests run against actual PostgreSQL 16 in Testcontainers using
`DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock` and
`TESTCONTAINERS_RYUK_DISABLED=true`. The actual preview uses its separate native PostgreSQL
18 cluster. Those are distinct tested profiles. No DB mocks stand in for data behavior.

Commands, with pinned Bun on PATH:

```sh
bun install --frozen-lockfile
bun run test:unit --maxWorkers=4
DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock TESTCONTAINERS_RYUK_DISABLED=true bun run test:integration src/features/integrations src/features/oauth src/features/mcp src/features/workflows src/features/activities/calendarEventRoundTrip.integration.test.ts src/db/integrationWorkflowMigration.integration.test.ts src/server/ws src/server/trpc/routers/realtime.test.ts --maxWorkers=2
bun --env-file=/tmp/warpdrive-integration-program-private/build.env --bun node_modules/next/dist/bin/next build --webpack
bun run build:workers
bun run typecheck
bun run lint
bun run ui:check
bun --env-file=/tmp/warpdrive-integration-program-private/runtime.env scripts/integration-profile-smoke.ts
```

The full root integration lane beyond these applicable areas, all live-provider suites,
remote deployments and browser identity-provider/MFA onboarding are not claimed by this batch.
The S3 simulator is not a production MinIO qualification. Runtime fixtures use native synthetic
sessions and synthetic data; they do not establish a real user/provider authorization grant.

## Evidence retention

Private raw logs reside under `/tmp/warpdrive-integration-program-private`, alongside
private configuration. They include original failing and final passing evidence. The durable
output handoff contains sanitized logs, source-only bundle/archive and checksums. Configuration,
keys, database dumps, node_modules, dist and .next remain excluded.

See [service smoke](runtime-smoke.md), [profile instructions](local-runtime.md), and
[restart/restoration](restart.md). A documentation checkpoint may advance HEAD; compare its
application-source diff to this qualified head before reusing the results.
