# Advanced pipeline analytics proposal

Date: **30 October 2026**. Status: **proposal for design and implementation planning**.

Add an **Insights** view beside the pipeline's Board and List views. It should explain
conversion, bottlenecks, changes in pipeline value and likely outcomes, and let users open
the deals behind every result. Preserve the current application shell, visual language,
regional preferences and record visibility rules.

This document records the proposed direction. Its wireframe uses fictional data. The advanced
views, forecasting and snapshots described below are not implemented by this documentation
change. Forecasting would expand the current shipped scope described in the README.

## Existing foundation

Source baseline: commit `d496d15`, inspected on 30 October 2026.

- The [dashboard](../src/features/stats/ui/Dashboard.tsx) already displays deal and activity
  performance, won-value trends, goals, stage totals, activity types and loss reasons.
- The active [stats router](../src/features/stats/router.ts) uses
  [stageConversion](../src/features/stats/stageConversion.ts) for a created-date cohort funnel
  with conversion relative to the first stage and median stage duration. It reads stage changes
  from the audit trail and infers passage through earlier stages from the furthest stage reached.
  This is different from proving that a deal explicitly entered every intermediate stage.
- [Deal performance](../src/features/stats/dealPerformance.ts) windows added, won and lost
  counters on their respective event dates; open deals are a current snapshot.
- [Win rate](../src/features/stats/winRate.ts) is won divided by won plus lost for the closing
  period, and is null when no deals closed.
- [Change logs](../src/db/schema/changeLogs.ts) record field changes with timestamps. Deal
  records include stage-entry, creation, closing and activity timestamps, source and owner.
- Monetary reports currently [select one currency](../src/features/currencies/reportCurrency.ts)
  before summing. Selecting a reporting currency does not perform exchange-rate conversion.

The proposal builds on these components. An existing funnel or duration measure should be
extended and checked rather than reintroduced as a separate conflicting calculation.

## Report areas

Funnel, performance, duration and progress are established CRM report families; see
[Pipedrive's report overview](https://support.pipedrive.com/en/article/insights-report-types).
The following are proposed Warpdrive capabilities, not claims about another product's UI.

| Area                  | Questions answered                                                                          | Proposed presentation and interaction                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advanced funnel       | Where do deals drop out? How did conversion change? Which deals skipped stages or reopened? | Horizontal stage bars with counts, count/value toggle, overall and consecutive-stage conversion, loss counts, sample sizes and previous-cohort comparison. Clicking a segment opens its deals. |
| Bottlenecks and aging | Which stages take longest? Which open deals are unusually old?                              | Median and upper-percentile duration, age distribution and stage-by-owner heatmap. Separate completed stage stays from the current age of open deals.                                          |
| Pipeline movement     | Why did the open pipeline grow or shrink?                                                   | Value waterfall from opening to closing inventory, separating new deals, value changes, wins, losses, reopenings, transfers and removals. Each component has a matching deal list.             |
| Forecast and coverage | What might close in the selected period? Is enough pipeline available to meet the target?   | Monthly forecast against target, conservative/base/optimistic scenarios, coverage ratio and close-date slippage. Show the assumptions and source of probabilities.                             |
| Team performance      | How do owners and teams compare on outcomes and follow-through?                             | Table with won value, win rate, median deal size, median sales cycle and overdue follow-ups, with small trends and sample counts. Segment comparisons to account for different deal mixes.     |
| Source quality        | Which acquisition channels produce valuable, successful deals?                              | Source-by-cohort comparison of deal count, conversion, won value and time to close. Acquisition cost metrics require a separate reliable cost source.                                          |
| Deal health           | Which opportunities need action now, and why?                                               | Prioritized list of overdue follow-ups, missing next activities, excessive stage age and repeated close-date changes. Explain each reason and open the deal or activity editor.                |
| Forecast accuracy     | How reliable were previous forecasts?                                                       | Saved forecast versus actual outcomes, error by period and segment, and deals that slipped into a later period. Requires forecasts preserved before their target period ends.                  |

Activity volume should be presented beside outcomes. Associations between activities and wins
must not be described as proof that an activity caused a sale. Initial health indicators should
use explicit, configurable rules; predictive scores are a later option requiring validation.

## Screen layout

Keep the existing sidebar, header, theme, typography, density settings and shared UI adapters.
The overview provides a concise summary; specialized tabs provide the deeper analyses.

Illustrative wireframe; all values are fictional and the cohort funnel is a separate measure
from the closing-period win-rate card:

```text
Sales pipeline                  Board   List   [Insights]

[Pipeline v] [Last 90 days v] [Team v] [EUR v] [Compare]

Overview   Funnel   Velocity   Forecast   Team   Sources

+----------------+---------------+-----------+--------------+
| Open now       | Won in period | Win rate  | Median cycle |
| EUR 2.4m       | EUR 310k      | 25%       | 32 days      |
+----------------+---------------+-----------+--------------+

Cohort progression                   Where deals slow down
Qualified    ############ 120         Proposal       14 days
Proposal     #######       72         Negotiation     8 days
Negotiation  #####         48         Qualification   3 days
Won          ###           30
                                     12 deals above normal age >

Pipeline value movement              Forecast versus target
[New / Changed / Won / Lost]          [Monthly chart + scenarios]

Needs attention
Deal             Owner     Reason                  Next step
Acme renewal     Sara      Proposal unchanged 21d   Open deal >
Beta expansion   Ali       No next activity         Schedule >
```

- Put pipeline, period, owner/team, source, currency and comparison controls in a shared toolbar.
  Add labels and relevant custom fields through the existing filter patterns. Product-based
  reporting depends on a future product model and must not appear as an available filter now.
- Show each report's basis: created cohort, closing-period events or inventory at a timestamp.
  Display refresh time, active filters, definitions and whether a comparison is available.
- A chart click opens a drawer with the exact contributing deals and the selected explanation.
  Preserve filters when opening a record, returning to the chart or switching tabs.
- Let users save report views and export their filtered tables. Shared views must reapply the
  recipient's permissions rather than disclose the creator's broader result set.
- Stack panels on narrow screens. Provide accessible data tables, keyboard-operable drill-down
  controls and text labels so color and hover are never the only ways to read a result.

## Metric definitions

| Metric                                | Required meaning                                                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open pipeline                         | Count and value of open deals at the stated snapshot time, within the explicit archive and visibility policy. A historical value requires a historical snapshot or reconstruction.                                |
| Won in period                         | Value and count of wins whose closing event falls inside the selected period; label any later reopenings or restatements consistently.                                                                            |
| Closed-deal win rate                  | Won / (won + lost) for the closing period. Open deals do not enter this denominator. No closed deals means unavailable, not zero percent.                                                                         |
| Cohort conversion                     | Deals in the selected created-date cohort that reached a specified stage / eligible cohort entrants. Show still-open deals and the observation date so an immature cohort is not mistaken for a completed result. |
| Consecutive-stage conversion          | Deals from the same cohort progressing from stage A to stage B / eligible entrants to A. State whether the report measures actual recorded entry or inferred passage through skipped stages.                      |
| Stage duration and age                | Duration is a completed stay's exit minus entry; age is elapsed time in the current open stay. Keep them separate and define how repeat visits contribute. Show median, upper percentile and sample count.        |
| Sales cycle                           | Creation to the defined closing event for the selected closed population. Distinguish won-only from all closed deals and define reopening behavior.                                                               |
| Weighted pipeline and period forecast | Weighted pipeline uses documented win probabilities. A forecast for a particular period additionally needs assumptions about closing within that period. Display scenarios as estimates, not guaranteed revenue.  |
| Pipeline coverage                     | Eligible open pipeline value / remaining target for the same scope, currency and period. Show unavailable when the target is missing or the denominator is non-positive.                                          |
| Forecast error                        | Compare the forecast saved at a stated cutoff with the subsequently observed outcome. State the error formula; handle zero actual value without an undefined percentage.                                          |

Always expose numerator, denominator, population and date basis in the report explanation.
Distinguish percentage-point changes from relative percentage changes. Keep unavailable values
separate from zero. Comparisons use an explicit previous period or matched observation age.

Stage-level reports should default to one pipeline. Different pipelines' stage positions are
not automatically equivalent: require an explicit mapping for a combined funnel or show separate
funnels. High-level outcome totals can still aggregate across visible pipelines.

## Historical data and correctness

Extend the existing audit trail into a reliable analytics history before promising historical
movement or forecast accuracy:

- Validate coverage for creation, stage and pipeline changes, owner changes, value and currency
  changes, closing, reopening, archival and deletion. Record events atomically with their change,
  using stable identifiers and deterministic ordering when timestamps match.
- Preserve stage definitions and ordering over time so renaming, reordering or removing a stage
  does not silently rewrite previous reports. Define owner-at-event versus current-owner reporting.
- Store periodic pipeline snapshots and forecasts with their cutoff, target period, model/version
  and assumptions. Reopening and transfer events must reconcile into the pipeline value bridge.
- Identify imports and legacy records with incomplete history. Mark inferred values and the
  reliable-history start date; do not invent past transitions, snapshots or historical forecasts.
- Calculate one currency at a time initially. Any later consolidated-currency view needs a stated
  exchange-rate source, effective date and policy, preserving original values and currencies.
- Apply deal and pipeline visibility plus the existing stats owner-scope rules on the server to
  summaries, drill-downs and exports. Cache keys must preserve those boundaries.
- Keep snapshot or aggregate totals reconcilable to their eligible records and scope. Define how
  removed records and later corrections affect historical reporting without exposing hidden data.

## Persian, German and regional behavior

- Use the current localization infrastructure for English, Persian and German, including labels,
  explanations, comparisons, empty states, tooltips and exported headings.
- Iranian Solar Hijri months, quarters and year boundaries must define the actual grouping when
  selected. Changing a date label alone is insufficient. Apply account time zones before assigning
  timestamped events to a reporting day, with explicit half-open period boundaries.
- Preserve Gregorian ISO storage and independent choices for language, calendar, time zone and
  numbering system. Label comparisons whose calendar periods have different durations.
- Support Persian RTL layout, Persian or Latin digits, and German numeric formatting. Document
  chart chronology and mirror directional controls intentionally rather than flipping every chart.
- Keep currency units explicit. An optional toman display must declare its relationship to IRR;
  it must not silently change stored amounts or mix units in a total.
- Suggested terms for language review include Persian **نرخ تبدیل** (conversion), **نرخ موفقیت**
  (win rate), **گلوگاه‌های فروش** (sales bottlenecks) and **پیش‌بینی فروش** (sales forecast), and
  German **Konversionsrate**, **Abschlussquote**, **Vertriebsengpässe** and **Umsatzprognose**.
  Reconcile them with the [existing glossary](i18n-glossary.md) before implementing translations.

## Loading and performance

Analytics must not slow down opening the pipeline board. Load Insights on demand, initially
requesting its summary and active panels. Fetch drill-down records with pagination only when a
user opens them. Keep the previous result visible during filter refreshes and cancel stale reads.

Use server-side aggregation and indexes appropriate to the measured query paths. Expensive
historical calculations can use background summaries or snapshots with visible freshness.
Invalidate affected live summaries after relevant changes; do not recompute every report on
every drag operation or download the full deal history to the browser.

Benchmark first visits and repeat visits separately after the development environment's loading
issues are resolved. Record dataset size, scope, hardware, runtime, cache state and query timings
before setting numeric performance budgets. This proposal makes no measured performance claim.

## Delivery sequence

1. **Definitions and design:** agree on metric semantics, historical coverage, the overview and
   drill-down layout; review it against the current UI in English, Persian and German.
2. **First useful release:** extend the cohort funnel with consecutive-stage conversion and
   drill-down; add bottlenecks, an explainable attention list and a pipeline value bridge for the
   period with reliable historical data. Expose data-coverage gaps explicitly.
3. **Comparisons and forecasting:** add owner/source comparisons, saved report views, targets,
   documented forecast scenarios and scheduled snapshots. Preserve forecasts for later evaluation.
4. **Advanced evaluation:** add forecast accuracy, calibrated probabilities and richer segment
   comparisons when enough reliable outcomes exist. Predictive deal scoring remains optional.

Acceptance should cover reconciliation between charts and deal lists, empty and small cohorts,
skipped/repeated stages, reopened and transferred deals, stage edits, historical coverage,
permissions, currency separation, Iranian calendar boundaries, time zones, accessibility and
measured loading behavior. Use deterministic fixtures for calculation checks; visual review and
runtime measurements remain separate evidence.
