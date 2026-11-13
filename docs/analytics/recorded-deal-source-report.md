# Recorded deal source performance

This read uses current live deal records and the existing fixed CRM source-channel taxonomy. It shows separate deal creation, current won and current lost counts in the viewer’s civil period; a deal may contribute to creation and outcome counts. Exact known won value in the selected currency is accompanied by the value sample count. A true zero remains a known value. Win-cycle totals use exact microseconds and include only wins with a nonnegative interval from recorded creation. These are current deal outcomes and nominal deal values, not lead conversion, sourced revenue or campaign attribution.

In Performance → **Acquisition**, the protected reader uses the selected
pipeline, owner, currency, and dates. Compare the count of deals with recorded
amounts and the win-cycle sample count alongside the value and duration. The
report distinguishes unrecognized source values from deals with no recorded
source. It withholds the result above 200,000 eligible deals. Narrow the filters
to request a smaller population.

The server resolves current authority and the effective time zone in a bounded
read-only repeatable-read transaction. The response uses fixed source
categories and aggregate counts. Native fixtures cover exact money, elapsed
time, missing values, unrecognized sources, civil-date edges, restricted and
archived records, mixed currencies, and a deactivated viewer. See the
[programme status](programme.md#status-pointers-13-november-2026) for the
evidence boundary.
