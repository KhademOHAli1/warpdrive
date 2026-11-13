# Current linked-organization won value

This native increment for #608 and #609 uses current CRM links to show nominal won value concentration and the count of organizations with multiple visible won deals. A won deal contributes at most once through its own current `deals.org_id`. Contacts, organization relation labels, parent/child links, domains and organization names play no role in account assignment. A relink or organization merge can change a later report. The result makes no claim about account identity at the time of a win.

The eligible population matches Performance's current won records. It uses one currency, the selected owner and pipeline scope, and the reported inclusive civil dates in the authenticated viewer's resolved time zone. The database reads the native session, account preferences, source records and effective permissions from one fresh, read-only repeatable-read cut. An independently authorized non-deleted organization must resolve the direct link. Unlinked, unavailable, deleted and dangling destinations share one unresolved count. The projection excludes names, IDs, withheld linked values, and reasons for individual records. Existing statistics still own the aggregate across all eligible wins. The report refuses an oversized population instead of returning a prefix.

The known linked subtotal sums present signed nominal amounts. Null represents the absence of a known linked amount, while recorded zero remains zero. Concentration is withheld when any eligible deal lacks an authorized direct link or any linked deal lacks a recorded nominal amount. With complete coverage, sum signed amounts once per organization. The concentration denominator is the sum of the positive organization nets. The largest positive net and sum of the five largest positive nets are the exact numerators over that denominator. Zero and negative organization nets are counted separately and contribute to the overall linked subtotal. A population with no wins is distinct from a complete population with zero or negative organization nets. No values are converted across currencies or rounded during calculation.

The multiple-wins count shows current organizations with at least two eligible deals in the selected dates, including deals with unknown value. A single deal can contain several offerings and a second won deal can be a parallel sale, correction or renewal. Labeling any of those as expansion requires stable account lineage, explicit deal or contract lineage and qualified expansion or cross-sell events. Acquisition cohorts, renewal, settled revenue, delivery costs, margin and realized profitability remain separate source requirements.

## Performance view

In Performance → **Accounts**, check the known linked subtotal and the counts
of won deals with unresolved organizations or missing amounts. Either gap
withholds concentration. If the scope exceeds 50,000 eligible deals, narrow
the filters and retry. Native fixtures compare authorized results against
canonical won totals and exact fractions. Panel fixtures cover fresh,
withheld, and permission states in English, German, and Persian. See the
[programme status](programme.md#status-pointers-13-november-2026) for the
evidence boundary.
