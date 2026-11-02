# Failed-task retry qualification — 2 November 2026

Tracking: #909 and #85 remain open. This records local technical qualification; the full production browser follow-up, hosted CI, deployment and user-journey/release acceptance remain separate gates. Exact receipt, test-report, source and canonical-metadata hashes are in the [compact record](retry-qualification-2026-11-02.json).

## Supported recovery

An eligible failed database task can resume on its original run and pinned version. Retry preserves the original actor, cursor, trigger, completed steps, effects and outputs. CSRF and current native session/verification/MFA/expiry/permissions are checked; the authentication method alone does not exclude a healthy legacy session. An opaque failure generation plus durable receipt binds concurrent clicks and lost acknowledgements to one failure. Stale replay cannot consume a newer failure.

Eligibility is derived on the server for the supported live manual deal/task profile with literal task subjects and a current visible, unarchived deal. Run history/detail show EN/DE/FA recovery feedback and bounded safe failure/retry history. CRM outputs, actor/session IDs and request keys remain private. Failed waits are ineligible; their duration is never restarted. New wait failures retain the original deadline as history.

## Actual evidence

| Cut         | Actual result                                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI baseline | One intended missing-Retry failure; two existing-history controls passed.                                                                                                                                                          |
| Static1     | 27 focused cases and Next typegen/full configured TSC passed. Typed lint failed with 16 findings; later phases did not run.                                                                                                        |
| Remaining2  | After minimal reviewed lint corrections, 14 affected profile cases and scoped TSC/lint, i18n and Biome passed. Unchanged five action and eight UI cases retain their preceding-cut witnesses.                                      |
| Native34    | Scoped TSC/lint/Biome passed. PostgreSQL: 31 passed, three failed; 16.128 s native, 29.346 s including cleanup.                                                                                                                    |
| Native9     | Three repaired cases plus existing two query, one detail and three execution regressions passed; 27 other collected cases were intentionally unselected. Scoped TSC/lint/Biome passed; 4.086 s native, 16.337 s including cleanup. |

The original 34 retry cases have passing witnesses across these actual cuts. There was **no single all-34-green run**. Original failures and receipts remain preserved.

The real projection failure came from nested Drizzle subquery selection retaining base-table columns. Flattened inner columns and explicit outer aliases now pass both history and detail checks. The two fixture failures attempted an active workflow archive and an immutable-version update. Fixtures now use legal inactive/archive state and a newly inserted unsupported historical version; database protections remain enabled.

Passing PostgreSQL coverage includes original-actor/session checks after an observed run-row wait; healthy/revoked/expired/MFA-required legacy policy controls; same/different-key concurrency; lost-response replay after a newer failure; effect/progress rollback; production pg-boss boot recovery and positively observed stale duplicate completion; schema constraints; and populated predecessor 100→101 upgrade. The upgrade keeps old runs/steps/effects and exact stored timestamp facts, backfills marked legacy snapshots, refuses a lost-deadline wait and resumes the failed task once.

## Operational boundary

Both native runs used one owned cached PostgreSQL container with `--pull=never`, no Testcontainers/Ryuk, one fork, synthetic credentials and private caches. All owned groups, container and owner labels were gone afterward; foreign container states and network/volume sets were retained, source pins held and private credentials were deleted. Resource measurements were sampled, not continuous peaks.

Stop old app/worker writers through 0100 and restart the new version together. Mixed-version failures after the backfill snapshot are unsupported. Current authority is checked at retry and worker claim boundaries; this does not establish a global fence for unenrolled revocation writers. Arbitrary cached mappings, external providers, failed-wait restart and broader retry/rerun/alert programmes remain outside this increment.
