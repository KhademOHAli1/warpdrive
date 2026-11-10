# Goals, KPI definitions and scorecards

This increment follows the proposal to separate a reusable measurement definition, an assigned target and a reusable collection of targets. Settings owns definitions and scorecards; Performance presents assigned results and their evidence. Source implementation and local checks do not establish integration, release or customer acceptance.

## Visual references

Research on 5 November 2026 inspected actual screenshots in Mobbin's public dashboard study and the authenticated Amplitude web library. The Amplitude review directly inspected its compact metric strip and configuration beside analytical output. Public article screenshots supplied the other references below; this was not an exhaustive review of every product flow.

| Reference                                                                                                                                                          | Observed pattern                                                                                                                 | Application                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Plausible Analytics on Mobbin](https://mobbin.com/apps/plausible-analytics-web-42d29d3e-4b3b-487a-8b6c-5dc7e6913071/3248634c-bbff-46b7-b2c4-c26ef6673dea/screens) | Shared date selector, a compact metric strip with restrained separators, selected metric underline and one dominant trend chart. | Shared period and scope context; compact values; detail on demand.                                  |
| [Amplitude on Mobbin](https://mobbin.com/apps/amplitude-web-b9049388-678e-4d5f-bfcc-b7aac27aee79/650988d1-067c-42dd-a69a-3ff57a2a1208/flows)                       | Configuration beside output; readable condition and evaluated count above the chart preview.                                     | Guided measurement controls with a persistent readable explanation and honest preview.              |
| [Front on Mobbin](https://mobbin.com/apps/front-web-5f504694-15aa-4bd2-ae6b-597c51a2be30/f0af1d0f-4ca0-4f5e-84b5-45e635b88a51/screens)                             | Data freshness near the title; common filter chips; key metrics alongside one trend panel.                                       | Put freshness and data availability in visible context; preserve common filters across a scorecard. |
| [Navattic on Mobbin](https://mobbin.com/apps/navattic-web-2e1f8c84-5de0-44df-84d3-c342c5af571d/5a900822-38e4-4123-af55-e4944f7762ec/screens)                       | Low-ink metric/value/comparison stacks and recognizable account records.                                                         | Lead with result and condition, then reveal trend and named contributing records.                   |
| [Notion settings example in Mobbin's article](https://mobbin.com/blog/how-to-use-mobbin-mcp)                                                                       | Persistent settings navigation, a legible content column and helper text beneath fields.                                         | Keep management within Settings and explain controls where users make decisions.                    |

The screenshot source is [Mobbin's dashboard study](https://mobbin.com/blog/what-good-dashboard-design-looks-like). These references inform design judgment; they are not evidence that the resulting Warpdrive workflow has passed usability testing. No Linear or Attio product screens were inspected in this research.

## Compact lists and custom calculation designer

The revised direction follows the user's explicit feedback: ordinary goals retain the existing CRM goal form and appear in one compact list with custom assignments. There is no hero panel, counter strip or per-goal card. Settings uses shared column headings, hairline row dividers, one search/filter toolbar and row actions. Definitions, scorecards and starting packs use the same list treatment. Performance uses compact result rows with evidence opened on demand.

The primary list reference is the actual [Frappe CRM lead list](https://docs.frappe.io/crm/lead) and [saved views](https://docs.frappe.io/crm/view). The official [list screenshot](https://docs.frappe.io/files/image7ce865.png) shows a short title/view header, one Create action, a narrow filter toolbar, shared column headings and closely spaced rows. Frappe was not found in the authenticated Mobbin app search; this reference came from Frappe itself.

The authenticated [Twenty Mobbin web library](https://mobbin.com/apps/twenty-web-b01bc961-2254-42c3-8047-7b1e956b3536/e1726ffb-ac7b-403e-a06e-1451568ade9a/flows) was inspected directly. In particular, the third screenshot of [Adding a conditional action](https://mobbin.com/flows/c9abe7c1-9de6-46ff-a1f7-5943d071b333) shows compact nodes with a muted action type and descriptive title, small circular ports, curved If/Else connections, a thin command header and a narrow inspector containing field/operator/value rules. These actual screenshots guide the custom KPI editor. The [official Twenty workflow branch reference](https://docs.twenty.com/user-guide/workflows/capabilities/workflow-branches) supplies additional context. No product assets are copied.

Custom authoring uses a separate full-screen node canvas. Data nodes select permission-filtered CRM records, filters, dates and aggregation. Compute nodes combine their values with arithmetic; comparisons produce Booleans, AND/OR/NOT combine conditions, and If/Else chooses a numeric branch. Exactly one output defines the KPI result. Nodes can be connected visually or through input selectors in the inspector. Each evaluated node exposes its output and data state during preview. Arithmetic and logic are Warpdrive KPI capabilities, not a claim that Twenty supplies these exact KPI nodes.

The editor persists an immutable typed calculation graph in the existing definition JSON. It executes a bounded deterministic graph on the server; it does not execute user code. Cycles, missing or duplicate input connections, incompatible types/units and unsupported sources are rejected. CRM inputs retain the same permission, scope, date and scan-limit rules as ordinary definitions. Division by zero, overflow and unknown conditions cannot become a successful goal. Only the chosen branch contributes its result and evidence. CRM data nodes currently support deals and activities. Manual templates remain explicit observations through their existing path; they are not disguised as connected graph sources.

The implementation continues to apply **Fortune 100 UI Style** and **Before Coding: Design Direction**: existing tokens, neutral surfaces, precise alignment and restrained accents. The ordinary creation path stays short; custom KPI engineering has its own purposeful workspace.

## Template and data contract

Six localized packs cover sales, consulting and agencies, recurring services, support and maintenance, product businesses and marketing. The numeric defaults are editable starting points, not recommended business commitments.

Trustworthy CRM templates use deals or activities directly. Won deal value is explicitly distinct from invoiced revenue, collected cash and profit. Win rate uses won deals over all closed deals; an empty denominator is unavailable. The overdue guardrail uses an at-most-zero target rather than rewarding larger counts.

Templates requiring project, time, billing, order or support data use explicit approved manual observations. Their requirements name the necessary source records and formula semantics. They do not imply those systems are connected. A manual template expects one reviewed value for its reporting period with a source note; if multiple observations are recorded, the calculation averages them equally. Sample-size guidance is visible where a denominator or response count matters.

On-time acceptance and fulfilment retain outstanding overdue work in their denominators. Utilisation accounts for leave. Satisfaction names a five-point scale and requests response count. These are requirements for the approved observation, not claims of automatic source validation.

Definitions and scorecards are reusable revisions. Assigned goals retain the particular definition and success condition used to evaluate them. Settings and Performance should expose unavailable, incomplete and stale data separately from a valid zero, and contributing records must remain subject to existing permissions.

## Measurement and history

KPI definitions and scorecards publish append-only revisions. Each assigned goal pins its exact definition revision, success condition, scope, period and pacing choice. A revised definition or scorecard does not rewrite existing assignments. Database migration `0106_kpi_scorecards` includes the generated schema snapshot, append-only revision/observation/snapshot triggers and pinned-assignment enforcement.

CRM calculations use the viewer’s record permissions and the goal’s responsible scope together. Timed event boundaries use the viewer’s timezone; all-day activity dates keep their canonical civil date. Available filters are checked against source visibility. Counts and sums distinguish real zero from missing data; ratios without a denominator are unavailable. Money is not combined across currencies. Aggregation and success comparisons retain four-place decimal precision. A bounded scan that reaches its limit remains incomplete and cannot establish target success.

Percentage populations use eligible denominator records. Ratios can use independent populations, such as two wins divided by one loss. The preview and result disclose contributing records, exclusion reasons, sample counts and evaluation time. Trend points recalculate the selected KPI from eligible observations up to each elapsed date; they do not project an even-growth assumption or future data.

CRM results use current record state and team membership. The interface states that later record changes can change historical actuals. Definition and target history remain pinned. Explicit completed-period snapshots are supported only for approved manual observations, bound to the requesting viewer and evaluated at period end; they are not asserted company-wide historical CRM totals. A manual observation more than seven days old is visibly stale.

## Independent validation and integration

Feature owners validate in their own workspace with isolated resources and may merge completed work when authorized. The repository no longer requires coordination-chat or heavy-job queue allocation. Existing exact-revision CI, issue traceability, current-main reconciliation and release/deployment boundaries remain in force.

## Local verification

The combined increment was reconciled with main `0064808` and its Billing migration. The canonical KPI migration is `0106_kpi_scorecards`, generated against the unchanged public `0105_workspace_billing` snapshot; the reviewed KPI SQL body and append-only triggers are retained. The populated upgrade test installs the complete 0105 prefix, preserves existing CRM/goal/preference records, admits 0106 and verifies a second migration run.

Pinned Bun 1.4.4 validation passed: configured whole-application type generation/TSC, scoped type-aware ESLint, 251 unit/component cases across 31 files, and 43 PostgreSQL cases across six files. Independent review found exact-decimal range validation and missing-event-date scoring defects; actual failing regressions were recorded before the fixes. The regressions subsequently passed, including the legacy-goals fallback. Known totals and unknown-date counts now share one SQL snapshot in that fallback.

The actual UI components were rendered with clearly marked synthetic data and memory-only server-action adapters for visual review. Desktop interaction covered guided creation of a zero-loss ceiling, preview evidence, pack creation, and assignment to a named team. The 390px Farsi dark-mode view had a 390px document width, with no horizontal page overflow. English and German controls, period labels, source requirements, unavailable results and contributing-record drilldown were also inspected. This visual fixture is separate from the real PostgreSQL persistence/permission tests; it is not installed-provider or customer acceptance.

Source inventory coverage has no missing or invalid declarations. KPI revisions, observations and snapshots remain explicitly unsupported by privacy export/erasure/retention adapters; this increment does not activate those lifecycle capabilities. Exact PR and resulting-main hosted CI are verified separately at integration.
