# Definitions and contributing deals

Bounded contribution to [SP-08.1 / #595](https://github.com/KhademOHAli1/warpdrive/issues/595), [SP-08.7 / #601](https://github.com/KhademOHAli1/warpdrive/issues/601) and [SP-08.8 / #602](https://github.com/KhademOHAli1/warpdrive/issues/602). Their full acceptance remains open. The [programme matrix](programme-matrix.json) retains all later features, including advanced models.

## Usable source increment

The first four dashboard result measures open an accessible contributing-deal sheet. The selected period, pipeline, owner/team and single currency travel with it. Reads start when the sheet opens; records link to a clearly labelled new tab so the original report, scope and page remain available. English, German and Farsi copy, RTL, keyboard focus return, missing values, recorded zeros, loading, empty and retry states use existing primitives and formatting.

`stats.records` resolves owner scope and pipeline visibility on the server, using the same resolver as `stats.dashboard`. Each page reapplies current deal/pipeline visibility and one stored currency. No linked contact or organization data is joined. The complete population's count, value sum and non-null value count are computed in the same SQL statement and snapshot as its page. Monetary values remain decimal strings, including four-place amounts. Pagination is descending `(created_at, id)` with PostgreSQL microseconds preserved in the cursor, capped at 100 rows per page.

| Population              | Eligible records and measure                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `won`                   | Currently won, with current win timestamp inside the selected period; headline count and value sum.                                               |
| `closed`                | Currently won or lost, using each outcome's timestamp; win-rate denominator, with won rows forming its numerator.                                 |
| `wonValue`              | The won population with a recorded value, including recorded zero; monetary-average denominator.                                                  |
| `wonCycle`              | The won population with win timestamp at or after creation; each row contributes one nonnegative creation-to-win duration.                        |
| `added`, `lost`, `open` | Also supported by the endpoint and dictionary; created-date population, current lost outcome, and unwindowed current open inventory respectively. |

The versioned metric dictionary describes numerator, denominator, units, eligibility, date basis, missing-data semantics, attribution and correction policy. It describes report calculations; Settings owns goal/KPI authoring. `goalReportAdapter.ts` consumes the current `goals.list` output without recalculation or application of dashboard filters. A replacement KPI/scheme contract still needs agreement with its owner; this adapter does not claim that future contract already exists.

## Time and restatement

Server boundaries use the authenticated actor's persisted account preferences, with the same profile/saved-preference precedence for SSR presets. Each civil midnight is independently converted to an instant, preserving 23/25-hour DST days. The resolved reporting zone is visible. A `timeZoneIdentity` input changes client query identity when preferences change; it never chooses server boundaries. Reads and results are suspended while an optimistic preference save is pending, including imperative retries, so a new cache key cannot receive an old-zone result during that save.

Canonical all-day activity scheduling uses `due_date` as a civil date; timed and legacy activities project their due instant into the reporting zone. Current open inventory is independent of the selected period. Monthly trend buckets remain explicitly Gregorian, with the existing 60-month cap. Actual Iranian report bucket boundaries remain included later work.

These are live current-state reports. Reopening, value/source correction, reassignment, transfer, archive/deletion and access changes can restate earlier results. Every later page is a new permission-checked read; data can change between the headline, opening the sheet and pagination. This increment does not reconstruct historical inventories or immutable outcomes. The existing funnel visibly identifies inferred lower-stage passage, current stage ordering, combined open/completed elapsed time and position-based all-pipeline aggregation. Qualified observed-stage history, separate age/duration reporting and business-specific pipeline mapping remain I2 work.

## Data and qualification

No database schema, persisted report/snapshot, event publisher, financial source, provider integration or campaign write is introduced. The additional database operation is a SELECT-only report. [Independent source review](source-review.json) pins the changed SQL/RPC paths and supporting visibility, scope and UI logic. Privacy binding maintenance covers those reviewed bytes and the new SELECT identifier only; existing lifecycle capability limits remain.

Focused calculation/schema and component checks are separate from real database and visual acceptance. Seventeen PostgreSQL cases are prepared for record/summary reconciliation, precision, permissions, archives, currency, reopening, microsecond pagination, Tehran midnight, DST and canonical all-day activity dates. The prepared synthetic browser harness renders the actual components and is only UI evidence when exercised. Whole-project type generation/TSC, configured typed lint, database execution, browser review, hosted CI, integration, installed acceptance, release and deployment require their own evidence. Local heavy validation remains queued at the user's request on 5 November 2026.
