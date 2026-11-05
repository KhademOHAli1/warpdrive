# Performance dashboard redesign

Bounded contribution to #601 (report presentation/accessibility) and #595
(metric definitions). These issues retain their complete original scope and
dependencies. This increment does not close either issue.

## Research and direction

Reviewed directly in Mobbin on 5 November 2026:

- [Plausible Analytics dashboard](https://mobbin.com/screens/550f90fc-17b6-4203-a470-57344e02f093):
  compact headline metrics, one prominent time series and supporting breakdowns.
- [Front workload dashboard](https://mobbin.com/screens/cec3ccca-064b-447b-b15e-268bc27b1dbf):
  persistent scope controls and distinct report categories with readable charts.
- [Mobbin's dashboard study](https://mobbin.com/blog/what-good-dashboard-design-looks-like):
  concise context and deliberate information hierarchy.

The implementation adapts those patterns to Warpdrive's existing brand tokens,
permissions and metrics. No Mobbin screenshots or other products' assets are
copied into the app.

## UI Skills review

Loaded through `npx ui-skills@0.2.4 start`, the visual category and the
`interface-design` and `baseline-ui` skills. The CLI runs in the task's output
directory; the application's Bun manifest, lockfile and dependencies are unchanged.

- **Human and task:** a sales lead reviewing results before deciding where to focus
  a pipeline conversation. The page must feel calm and precise.
- **Domain:** won deals, stage movement, cohorts, sales cycles, scheduled follow-ups,
  quotas and currency-separated value.
- **Existing color world:** paper-like canvas, white report surfaces, graphite
  values, indigo navigation/plot accents, green achievement and red errors.
- **Signature:** scope and time stay explicit across five surfaces: date presets,
  closed-event totals, the created-date funnel, current open-stage inventory and
  independently dated goals.
- **Rejected defaults:** repeated icon cards become one results strip; a decorative
  heading badge is removed; stacked borders/shadows become quieter report surfaces.
- **Hierarchy:** won value leads at 36px; supporting values use 24px, labels 14px,
  explanations 12px. Existing app typography and numeric preferences are retained.
- **System:** 4px spacing increments, existing Radix-backed controls, theme tokens,
  one plot/navigation accent, logical RTL spacing, 40px report-tab/preset targets,
  static loading placeholders and no new decorative animation.

## Usable outcome

- Overview: won-value headline, win rate, average won value, median cycle,
  completed activities, monthly trend, applicable goals, deal outcomes and funnel.
- Pipeline: the existing outcomes/funnel/stage-value/lost-reason reports.
- Activities: separate completed, scheduled and created counters, undated work,
  and completions by type.
- All views share owner, currency, pipeline and date filters.
- Quick civil-date presets use the server-resolved viewer date. Invalid reversed
  ranges suspend the dashboard query and hide previously rendered figures.
- The initial range is year to date, so unelapsed future months are not presented
  as an apparent fall to zero won value.
- A visible monthly data table can be expanded without losing the always-readable
  assistive-technology version. The plot retains linear segments and real zero months.
- Dashboard, goals, pipeline-option and owner-option read failures expose explicit
  retry controls; failed goals no longer masquerade as an empty collection.
- New messages are present in English, German and Farsi. Farsi presets explicitly
  name Gregorian month/quarter/year boundaries rather than imply Persian buckets.

## Metric contract

The existing server queries, permission rules and currency separation are retained.

| Measure                 | Population/basis                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Won value/count         | Deals won within the selected dates                                                      |
| Win rate                | Won count divided by won plus lost count within the period; unavailable when none closed |
| Average won value       | Won deals in the period; unavailable without observations                                |
| Median cycle            | Creation-to-win duration for eligible won deals in the period                            |
| Completed activities    | Completion event date in the period                                                      |
| Scheduled activities    | Open activities with a due date in the period                                            |
| Undated activities      | Current open activities without a due date                                               |
| Open deals/stage values | Current inventory, independent of the selected dates                                     |
| Funnel                  | Created-date cohort and actual reached-stage history, with server-resolved owner scope   |
| Goals                   | Goals applicable to the viewer with each goal's own dates and assignee scope             |

Activity counts are not presented as a completion rate: scheduled and completed
counts are different populations. Won deal value is not labeled invoiced revenue.
No unmeasured growth badges, generated business explanations or comparison data
are introduced.

## Verification and remaining acceptance

The local focused UI run passed 86 tests across 13 files, including ten new
experience cases and nine civil-date cases. Biome and the configured translation
audit passed. The unmodified privacy inventory reported no missing or invalid
declarations. Exact commands and output are retained in the task workspace.

Two explicit, finite user-authorized validation slots were used and cleaned up.
Configured whole-application type generation/TSC and changed-file type-aware ESLint
passed. Actual dashboard components were rendered with synthetic query data and
reviewed at desktop and 390px mobile sizes, including German, Farsi RTL,
RTL keyboard tab navigation, light/dark themes, monthly data expansion and
populated/empty/error/loading states. No horizontal page overflow or German metric
overflow remained at the tested width.

The final capture includes the visible trend and goal curves. Earlier browser
bridge timeouts and full-page captures that omitted unpainted offscreen SVGs are
retained separately; viewport inspection and a subsequently painted full-page
capture establish the actual chart rendering. These checks did not query real
backend records or exercise an installed database.

Final hosted CI, full application production-build/browser acceptance, human
assistive-technology acceptance, permission-safe contributing-record drill-down,
saved views/export, forecasting, release and deployment remain separate work.
