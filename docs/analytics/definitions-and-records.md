# Definitions and contributing deals

Bounded contribution to [SP-08.1 / #595](https://github.com/KhademOHAli1/warpdrive/issues/595), [SP-08.7 / #601](https://github.com/KhademOHAli1/warpdrive/issues/601) and [SP-08.8 / #602](https://github.com/KhademOHAli1/warpdrive/issues/602). Their full acceptance remains open. The [programme matrix](programme-matrix.json) retains all later features, including advanced models.

## Usable source increment

On Performance, select **View contributing deals** on won value, win rate,
average won deal value, or median sales cycle. The drawer retains the selected
period, pipeline, owner scope, and currency. It reads the records when opened.
Deal links open in a new tab so the original report and drawer stay in place.
See [deal report downloads](deal-report-exports.md) for chart selections and
CSV limits.

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

The server resolves the viewer's account time zone, using the request's device
zone when browser mode is active and the zone is available. Each civil midnight
is converted to an instant independently, so 23-hour and 25-hour days retain
their full range. The report shows the resolved time zone. The
`timeZoneIdentity` input updates the client query key after a preference change.
The server computes its boundaries from the resolved preferences. The client
pauses reads and hides results while the preference save is pending.

Canonical all-day activity scheduling uses `due_date` as a civil date. Timed and
legacy activities project their due instant into the reporting zone. Current
open inventory is independent of the selected period. Month, quarter, and year
presets follow the selected Gregorian or Iranian calendar. The monthly trend
uses Gregorian buckets and displays at most the most recent 60 months.

These are live current-state reports. Reopening, value/source correction, reassignment, transfer, archive/deletion and access changes can restate earlier results. Every later page is a new permission-checked read; data can change between the headline, opening the sheet and pagination. This increment does not reconstruct historical inventories or immutable outcomes. The existing funnel visibly identifies inferred lower-stage passage, current stage ordering, combined open/completed elapsed time and position-based all-pipeline aggregation. Qualified observed-stage history, separate age/duration reporting and business-specific pipeline mapping remain I2 work.

## Data and qualification

No database schema, persisted report/snapshot, event publisher, financial source, provider integration or campaign write is introduced. The additional database operation is a SELECT-only report. [Independent source review](source-review.json) pins the changed SQL/RPC paths and supporting visibility, scope and UI logic. Privacy binding maintenance covers those reviewed bytes and the new SELECT identifier only; existing lifecycle capability limits remain.

The 5 November 2026 source checkpoint recorded 17 prepared PostgreSQL cases and
a synthetic browser harness. Their scope includes record and summary
reconciliation, precision, permissions, archives, currency, reopening,
microsecond pagination, Tehran midnight, DST, and all-day activity dates.
Use the [programme status pointers](programme.md#status-pointers-13-november-2026)
to distinguish that checkpoint from later source integration and installed
acceptance.
