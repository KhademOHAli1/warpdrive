---
sidebar_position: 8
title: Performance
description: "The Warpdrive Performance page: sales metrics, the stage funnel, quota goals with pace, and why two people can legitimately see different numbers."
---

# Performance

`/dashboard` is the Performance page. Use **Overview** for headline metrics, won
value over time, your applicable goals and a pipeline summary. **Pipeline** shows
deal outcomes, funnel conversion, current stage values and lost reasons.
**Activities** shows activity counters and the completion breakdown by type.

![The Performance page](/img/screenshots/dashboard/overview.png)

## Metrics

The scoreboard shows won deal value and count, win rate, average won deal value,
median sales cycle and completed activities. The individual reports retain added,
won, lost and open deal counts and values, and separate activity counters.

Use the pipeline, owner and currency filters to choose the report scope. Quick
ranges offer the last 30 days, this month to date, this quarter to date and the
current year to date. Custom start/end dates remain available. Presets use Gregorian
date boundaries and the viewer's server-resolved current date; the date pickers
continue to respect display preferences. A reversed range must be corrected
before the report can load. Switching report tabs retains the selected filters.

The monthly trend has a **Show monthly data** control for reading the same values
in a visible table. The table remains available to assistive technology when the
visual table is collapsed.

Each counter windows on the column that records its event: "Won" over a range means
deals **won** in that range, not deals created in it that happen to be won now, and
a completed activity counts by when it was completed, so finishing overdue backlog
moves the number. Open deals are a snapshot, not windowed. Activities with no due
date get their own count instead of vanishing, and a metric with no data renders a
dash rather than a zero.

## The funnel

The stage funnel is built from the deals' actual stage history, so it reports how
far a cohort of deals got, with median days in stage, rather than where open deals
happen to be sitting. A deal that moved forward and then back still counts as having
reached the far stage.

"All pipelines" aggregates every pipeline you can see by stage position.

## Quota goals

A goal names what is measured (for example deals won, by value or by count), who it
applies to, and an interval, and carries a target. The Performance page shows each
goal's progress for the current period as attainment plus **pace**: half the target
booked a fifth of the way through the month reads as ahead, not as 50%.

Periods anchor on the goal's start date rather than the calendar, so a quarterly
goal starting in February runs February to April.

Goals are managed on `/settings/goals`, behind the `goals.manage` permission.
Reading them needs no permission.

Goals keep their own dates and assignee scope independently of the report filters.
A failed goals request is reported separately from a successful request with no goals.

## Numbers are visibility-scoped

Figures are computed with the same visibility rule as the records behind them.
Records you cannot see do not contribute. A goal decides whose work counts toward
the target, but your own visibility still decides which deals you may see behind
the number.

:::note
Two people can legitimately see different totals for the same pipeline over the same
period. That is the visibility model working as designed, not a reporting fault.

When reconciling a disputed number, compare as the **same user**, then check
[visibility groups](../administration/visibility-groups.md).
:::

## Scope

This page summarizes the currently supported metrics. The broader analytics
roadmap tracks forecasting, saved reports and permission-safe record drill-down.
The current views do not add forecasts, previous-period comparisons or currency
conversion.

## Related

- [Pipeline](./pipeline.md)
- [Activities](./activities.md)
