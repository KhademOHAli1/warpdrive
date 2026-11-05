# Deal report CSV downloads

The contributing-deals drawer offers a CSV to viewers with export permission when the complete report contains at most 100 deals. The download rechecks the live session, the export grant, and the selected metric, dates, pipeline, currency, owner scope and reporting zone. It uses the same records procedure as the drawer. A permission or zone change that would produce a different scope makes the download unavailable.

One read must account for every row, the recorded-value count and the exact monetary total. The CSV includes deal ID, current status, currency, exact signed nominal value, and UTC creation and close timestamps with microsecond precision. An empty amount represents a missing value. A recorded zero is `0.00`. Typed fields exclude free-text titles and linked identities. Spreadsheet import may apply its own number formatting to these exact CSV strings.

All responses are private and noncacheable. A complete empty result yields the header row. Reports above the limit ask the viewer to narrow the selection. The browser test uses synthetic deals to check row identity, amount precision, dates and exclusion of private and restricted-pipeline records.

The won-trend data table opens contributing records for a nonempty month. The drawer and its CSV use the original civil reporting range and the same local Gregorian month expression and display bound as the chart. The drawer suppresses results after scope drift. Deal links keep the dashboard and drawer open in the original tab.

The lost-reason chart can open contributing records for a configured reason, a native legacy value, or a missing reason. Empty legacy text remains distinct from an absent reason. A fixed-length sealed digest binds each legacy selection to the current viewer, effective owner membership, currency, pipeline, civil dates and reporting zone. The chart and records group exact text using a deterministic comparison. The CSV keeps the existing typed fields and omits reason labels. A stale selector closes the report drawer and refreshes the chart before the viewer chooses again.
