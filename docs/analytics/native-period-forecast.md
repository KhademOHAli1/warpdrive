# Period forecast scenarios

In Performance → **Forecast**, choose target dates and select **Run scenarios**.
The report uses the current pipeline, owner, and currency filters and applies
manual assumptions to currently open deals. The target must be in the future
and span at most 366 civil days. The report can include up to 5,000 eligible
deals and requires active deal history capture.

The version 1 adapter requires the authenticated server session and actor, a single explicit currency and pipeline/owner selection, and a bounded fixed civil target. It owns a fresh read-only repeatable-read transaction. Its first data statement captures the native witness and database wall clock. It checks current session and actor authority, restricts the actor to the request ceiling, and rejects a named pipeline, user, team or owner scope it cannot authorize. It resolves the target in the actor's current timezone using normal report boundaries and accepts only an entirely future target at that cut.

The eligible roster is all currently open deals in that exact authorized scope. Native capture must be installed and healthy. Every deal and referenced stage/pipeline must have a matching current capture tip visible at the cut. Missing or conflicting capture and cap overflow withhold the entire scenario result. A fully qualified empty roster is separately available with zero members. There is no fallback to mutable deal IDs as incarnation evidence.

For each scenario, enter the chance of eventually winning and the chance of
closing in the target period given a win. Leave a probability blank when it is
unknown. The size multiplier ranges from 0 to 10 and defaults to 1 when blank.
The same assumptions apply to the entire roster. A recorded expected close
date supplies no timing probability. The result shows the assumptions, target,
cutoff, exact totals, and coverage. Read the results as conditional scenarios
under those assumptions.

The protected POST carries assumptions in the request body and checks CSRF.
Editing input clears the displayed result. The native and browser fixtures cover
capture availability, exact arithmetic, unknown factors, record visibility,
future targets, and the rendered result. See
[analytics history activation](activation-gates.md) for the installed capture
prerequisite. Saved forecast custody, actual settlement, and calibration have
separate qualification requirements.

An optional KPI picker reads existing active won-value targets through their owning Goals output. It returns only bounded authorized names and IDs. A run rereads the chosen assignment and pinned definition in the forecast snapshot, with exact owner, pipeline, currency, civil period and profile time-zone compatibility. For the current future-only report, a complete empty KPI result supplies booked zero. Scenarios with missing contributions withhold the gap calculation. An in-progress target will require an exact booked-through-cutoff measure.
