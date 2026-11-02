# UX research and design programme

**Status:** research plan with a small inspected reference set, 31 October 2026. Twenty studies below are **planned**, not completed user research. Mobbin captures are visual references; they do not establish an application's permissions, performance, provider behavior, or accessibility.

## 1. Design objective

Help a seller understand which company context they are in, which process they are managing, which records they may access, and what to do next. Preserve the current Warpdrive shell and allow advanced capabilities to appear progressively. Configuration and error recovery deserve the same design attention as a populated board.

Design starts from the actual baseline captured in SP-00.2: current sidebar/top bar, local Inter/Vazirmatn fonts, theme variables, density, shared controls, drawers/dialogs, record pages, and responsive navigation. Every prototype is shown inside that shell. A Mobbin reference is a reasoned interaction input, not permission to import another product's visual identity.

## 2. Reference register and evidence boundaries

| Ref | Exact source | Observed status | Useful pattern / limit |
| --- | --- | --- | --- |
| M-01 | [Linear: Switching workspaces](https://mobbin.com/flows/2774d352-5908-42ac-bc41-b5b41913cffd) | Flow discovered; beginning and neighboring switcher frames visually inspected in this side conversation. Four screens listed; not all independently reviewed. | Explicit workspace selection apart from team navigation. Does not prove cross-company isolation. |
| M-02 | [Linear web flow collection](https://mobbin.com/apps/linear-web-9591f534-b2b8-40aa-a91a-fdbe183d0a5f/efdb5b1e-be6d-4321-ae35-b4df6801a3eb/flows) | Flow directory inspected: Creating a view, Teams, Members, Changing team visibility, and Switching workspaces discovered. | Candidate set for memberships, navigation and saved views; full individual flows still require study. |
| M-03 | [Attio: Creating a list from a template](https://mobbin.com/flows/1095c66f-6cbe-40b0-8c9e-b5d802b6a174) | Initial gallery/template and pipeline frames inspected. Six screens listed; complete flow not qualified here. | Browse templates while retaining a blank path; separate list/view from underlying company records. |
| M-04 | [Attio: Sharing a list](https://mobbin.com/flows/9eb16b88-8777-4937-a628-a6118a71e77a) | Initial gallery and sharing-popover frames inspected. Eight screens listed; no security behavior inferred. | Workspace access summary plus individual access affordance; adapt to Warpdrive's actual authority model. |
| M-05 | [Attio web flow collection](https://mobbin.com/apps/attio-web-f8618f57-3608-4752-9643-94b510d99b43/892acdf2-7578-4df0-aea7-1ffed421dae6/flows) | Directory inspected. Creating/renaming/filtering views, switching deals views, managing access, reports, workspace access, invitations and templates discovered. | A verified starting directory for the deeper studies below; no invented direct screen IDs. |
| M-06 | [Attio: Creating a workflow](https://mobbin.com/flows/2f4ee290-153e-4f02-b331-676b6a1b64f4) | Existing WF design-reference document reports inspected frames; not independently re-reviewed in this planning task. | Reuse current WF decisions before commissioning another builder design. |
| M-07 | [Attio: Adding a filter](https://mobbin.com/flows/b70ccea5-109c-4b46-b964-9510aa9e0a91) | Existing WF reference evidence, with frame limitations recorded there. | Selected-node inspector, typed field/operator/value composition. |
| M-08 | [Attio: Workflow run detail](https://mobbin.com/flows/1ce88003-a672-4fd5-8208-cfc2aca49201) | Existing WF reference evidence; current Warpdrive has its own working manual-run UI. | Run state and historical-version inspection. |
| M-09 | [Zapier: Testing a connection](https://mobbin.com/flows/fcd35efa-2b51-4de9-8999-e1ba024d075c) | Existing WF reference evidence; not a newly completed connector study. | Distinguish connection health from successful action execution. |
| M-10 | [Attio: Updating workflow timezone](https://mobbin.com/flows/69189407-63ab-4ee4-8518-8bbf1b8defac) | Existing WF reference evidence; Iranian recurrence is not shown by this capture. | Explicit execution timezone and explanatory copy. |

Do not download/repackage a proprietary screen library for the distribution. Keep source links and short design notes. Use authorized internal screenshots only for review; ship original Warpdrive components and synthetic demonstration data. Verify terms for any external asset proposed for redistribution.

## 3. How each Mobbin study is conducted

1. State the user job and exact question before searching. Example: “Can a manager explain who can edit this pipeline after changing team membership?”
2. Search Mobbin by app and flow, using the terms below. Review the full relevant flow where available, not a single attractive populated screen. If a named product/flow is unavailable, record that and use an authorized product trial or official documentation as a different evidence type.
3. For important interactions, compare two or three genuinely relevant products. One reference can establish a useful example; a third irrelevant reference adds no value.
4. Record source URL, captured version/date shown by Mobbin, platform, individual frames inspected, and missing states. Do not fabricate version dates or assert that all account editions behave the same.
5. Annotate entry point, decisions, controls, information order, defaults, validation, loading, cancellation, persistence, permission handling, return path and recovery.
6. Decide **adopt**, **adapt**, or **reject** with a reason tied to a Warpdrive user job. Write what the capture does not establish.
7. Produce an original current-shell prototype in Farsi and German, including a failure or permission state. Explain differences from the reference.
8. Validate with tasks and revise. Store findings under the study ID and link the corresponding SP task. A reference collection without an implementation decision is not a completed study.

## 4. Twenty research studies

| ID | Question and proposed Mobbin search | Research activity | Deliverable / decision gate | Projects |
| --- | --- | --- | --- | --- |
| UX-01 | Can people distinguish workspace, customer company, team, pipeline, view, funnel and acquisition channel? Search Linear workspace switcher; Attio Workspaces/Lists. | Concept sorting, label comparison and navigation testing using M-01/02/05. | Reviewed entity vocabulary and navigation model; no participant assumes a saved view grants data access. | SP-00/01/02/14 |
| UX-02 | How should users create, find, duplicate, archive and restore pipelines? Search Attio template/list; Pipedrive pipeline if available. | Compare fast creation with guided setup; test 1, 10, 100 and 1,000-item switcher prototypes. | Searchable switcher/directory specification, sensible default/favorites behavior, and dependency-aware archive flow. | SP-02 |
| UX-03 | How can a user predict effective access? Search Attio Sharing a list, Managing access, Editing workspace access; Linear team visibility. | Study M-04 and discovered flows; test a salesperson, manager, administrator and later guest with different record ceilings. | Sharing editor, access explanation and stale-policy/revocation states with correct user predictions. | SP-02/10/14 |
| UX-04 | What belongs in a personal or shared saved view? Search Attio Creating a view, Renaming a view, Filtering companies; Linear Creating a view. | Compare board/table/filter persistence, unsaved changes, columns, sort, ownership and sharing. | Versioned view UX, reset/duplicate behavior, and correct return navigation. | SP-03 |
| UX-05 | How do users choose and adapt a process template? Search M-03 and relevant template galleries. | Test blank versus duplicate versus template, preview data, dependency warnings and upgrade conflicts. | Template selection/install/diff prototypes with no implied activation of messages or automation. | SP-04 |
| UX-06 | How should a blocked stage move or approval request be explained? Search CRM required fields, approval, validation; use comparable forms where exact flows are absent. | Test missing evidence, hidden required fields, stale validation, bulk partial success and permitted overrides. | Actionable rule messages and recovery without private-data leakage or forced screen abandonment. | SP-04/05/11 |
| UX-07 | Can sellers identify and complete the most useful next action? Search Attio Tasks/grouping, CRM activity queues, Linear My issues. | Baseline and prototype timed tasks; compare priority explanations, snooze, assignment and quick actions. | Queue information hierarchy; KR-03 baseline and follow-up measurements. | SP-03/07 |
| UX-08 | How much qualification information is useful during a real conversation? Search CRM deal details, forms, checklists and notes. | Evaluate compact panel versus focused review, unknown states, evidence sources, stale evidence and optional prompts. | Contextual framework panel; no unexplained score or excessive mandatory entry. | SP-05/06/12 |
| UX-09 | How should account relationships and buying groups be represented? Search Attio Companies, Company detail, relationships; stakeholder-map candidates. | Test several opportunities and buying groups, mixed access, aliases, roles, duplicate/merge review and missing people. | Account overview and relationship editor that remain understandable with partly hidden data. | SP-06/10 |
| UX-10 | How should sales actions connect to automation, calendar and providers? Reuse M-06–M-10 and current WF/IG specifications. | Trace trigger → actor → selected connection → recipients → schedule → effect → outcome/recovery. | Consistent preview/activation/run-history UI; unknown delivery, expired consent and cancellation are distinct. | SP-07/09/11 |
| UX-11 | Can users explain a funnel or conversion chart? Search Attio reports/filters/contributing data; CRM funnel analytics. | Test cohort versus closing-period versus current inventory; skips, reopens and permission-filtered drill-down. | Metric definitions, comparison/empty states and accessible chart/table views understood by participants. | SP-08/13 |
| UX-12 | Do users understand forecast uncertainty and movement? Search CRM forecast, waterfall, target/coverage and date-slippage interfaces. | Compare scenario displays; ask users to explain probability sources, snapshot dates, currencies and missing data. | Forecast/movement prototypes with honest unavailable states and reconciled contributing records. | SP-08 |
| UX-13 | What information is needed for a successful post-sale handover and renewal? Search customer-success onboarding, milestones, renewal and health views. | Observe seller/receiving-owner handoff; test acceptance, rejection, renewal generation and calendar boundaries. | Bowtie lifecycle map, distinct owners/statuses and no duplicated revenue semantics. | SP-09/13 |
| UX-14 | How do partners register a deal and resolve conflict? Search partner portal, deal registration, approval and invitations. | Interview partner managers; compare internal admin and external partner views with conflicting registrations. | Internal registration prototype; separately scoped portal with explicit privacy/resource boundaries. | SP-10 |
| UX-15 | How do tender teams coordinate requirements and preserve an approved submission? Search RFP, proposal, review, approval and version history. | Task walkthrough with bid lead, reviewer and contributor; compare workback planning and immutable package review. | Tender workflow specification; approval/export/submission/receipt are visibly different states. | SP-11 |
| UX-16 | What makes a product signal credible and actionable? Search activity/event feeds, lead score explanations and product-usage dashboards. | Present genuine synthetic usage histories, missing identity, outages, conflicting signals and threshold changes. | Source/evidence panel and qualification queue; users do not confuse signal with outreach permission. | SP-12 |
| UX-17 | How should acquisition, referrals and advocacy be connected? Search campaign/source attribution, lifecycle handoff and referral flows. | Compare first/last touch, unknowns, opt-in, cost availability and customer feedback with observed workflows. | Acquisition taxonomy and attribution explanation; no invented causal return on spend. | SP-13 |
| UX-18 | Do all core workflows remain usable in Farsi/German and with assistive technology? Use comparable localization/responsive patterns but test Warpdrive directly. | Native review, keyboard/screen reader, zoom, long text, RTL, mixed scripts, narrow layouts and reduced motion. | Cross-project language/accessibility sign-off with reproducible defect cases. | All projects |
| UX-19 | Can people recover from offline, stale, denied or uncertain actions? Search errors, retry, conflicting edits, connection recovery and job status. | Fault-injected prototype tasks; verify how users distinguish unsaved, queued, failed, partial and unknown outcomes. | Consistent state language, conflict recovery and a recoverable route back to work. | SP-04/07/12/15 |
| UX-20 | Can a self-hosted maintainer upgrade, enable, diagnose, disable and restore the feature? Search admin audit/configuration/history patterns. | Observe a rehearsal with version-matched runbooks; test feature availability, ownership handover and migration status. | Operations journey and evidence pack that a maintainer can execute without undocumented knowledge. | SP-00/14/15 |

Specialized partner, tender and product-signal examples are **search targets**, not claims that Mobbin currently contains a matching product or complete workflow. Their absence is a finding; adapt an adjacent pattern and validate with the actual user group.

## 5. Proposed screen architecture

| Surface | Primary job and behavior | Important boundary/state |
| --- | --- | --- |
| Existing shell | Preserve navigation, shortcuts, current context and responsive drawer. | New feature entry appears only when available and permitted; deep links fail safely. |
| Pipeline switcher/directory | Search, favorites, recent pipelines, status, create and manage affordances. | No hidden pipeline names in search; distinguish none existing from none accessible. |
| Create pipeline | Choose blank/template/duplicate, edit structure, choose access, review and create. | Keep a fast path; template dependencies and inactive automations are explicit. |
| Pipeline settings | Stages, fields, rules, qualification, sharing, lifecycle and history. | Show unsaved revision and dependencies; archive/delete cannot silently remove linked data. |
| Sharing editor | Explain workspace/team/person scopes and effective capability. | “Workspace” never means publicly accessible; current restrictions remain visible. |
| Board/list and view controls | Retain current editing and card density; save filters/columns/sort separately from process definition. | Locale switches and refresh do not reset draft edits or query context. |
| Work queue | Show next action, why it matters, due date, owner and quick actions. | Refresh/reorder is stable; keyboard alternatives exist for drag actions. |
| Deal qualification | Small evidence sections with unknown/negative/confirmed states and source links. | Hidden or stale evidence is explicit without disclosure; local draft survives errors. |
| Account overview | Permitted people, buying groups, active deals, tasks and history. | Incomplete information does not imply no activity or reveal hidden records. |
| Insights | Shared scope toolbar, definitions, charts and accessible contributing-record tables. | Created-cohort, closing-event and current-inventory bases are never conflated. |
| Lifecycle handover | Seller/receiving-owner checklist and explicit acceptance. | Won status is preserved; incomplete handover and reassignment are recoverable. |
| Tender workspace | Deadlines, requirements, contributors, review and approved package history. | Exporting an approved file is distinct from submitting it to a customer. |
| Product-signal panel | Source, period, identity, rule and evidence behind a suggested follow-up. | Unknown identity/outage/consent requires review; no automatic enrolment. |
| Future workspace switcher | Identify company and account, switch/join/create with verified membership. | Warn about local unsaved work; reset scoped caches and subscriptions on switch. |

Advanced feature controls use progressive disclosure. A seller should not configure a data model, auth provider or retry mechanism to move an ordinary deal. Operator-only diagnostics remain in settings/history or a support details affordance.

## 6. Complete-state design requirement

For every new screen/flow, specify: loading; first-use; populated; filtered-empty; genuinely no data; no access; missing capability; validation; concurrent conflict; disconnected provider; offline; saving; saved; queued; partial/unknown effect; retry eligibility; cancelled; archived; restored. Apply only relevant states, but record why a state is inapplicable.

Define primary/secondary/destructive actions, focus entry/return, keyboard order, screen-reader names, progress announcements, retry semantics, local-draft handling and persistence after reload. Never use only color or icon shape to convey status. A toast alone is insufficient for a failed long-running operation.

Suggested Farsi stage-block message: «برای انتقال این فرصت به مرحلهٔ پیشنهاد، مبلغ و تاریخ اعتبار را وارد کنید.» German: «Ergänzen Sie Betrag und Gültigkeitsdatum, bevor Sie diese Verkaufschance in die Angebotsphase verschieben.» These are proposed contextual strings to review; field requirements depend on the actual configured policy.

## 7. Farsi, German, calendar and money design

| Concept | Proposed Farsi | Proposed German | Usage rule |
| --- | --- | --- | --- |
| Workspace | فضای کاری | Arbeitsbereich | Company security context, not a customer-company record. |
| Sales pipeline | مسیر فروش | Vertriebspipeline | Working opportunity process. |
| Funnel | قیف فروش | Verkaufstrichter | Conversion analysis; do not use as a synonym for every board. |
| Sales opportunity | فرصت فروش | Verkaufschance | Align with the current sales UI; review older uses of معامله/Deal contextually. |
| Lead | سرنخ | Lead | An unqualified potential contact/opportunity, according to the agreed domain model. |
| Saved view | نمای ذخیره‌شده | Gespeicherte Ansicht | A query/presentation, never a permission grant. |
| Acquisition channel | کانال جذب | Akquisekanal | Marketing/source attribution, separate from a conversation channel. |
| Buying group | گروه تصمیم‌گیر خرید | Einkaufsentscheidungsteam | Validate wording with actual enterprise users; avoid literal technical translation. |
| Needs review | نیازمند بررسی | Prüfung erforderlich | Distinct from failed or safe-to-retry. |

Keep user-entered names and historical values exactly as authored. Generated default stages/templates should resolve through stable catalog keys with a legacy-name fallback. Do not mass-translate saved custom names when the locale changes. Persian/Arabic text, German names and mixed-language notes must coexist.

Use logical spacing/alignment. Keep email, phone, URLs, IDs and code as isolated LTR segments within RTL text. Review numeric charts, timelines, stage progression and drag direction individually rather than blindly mirror every visual. Provide a non-drag path for stage and relationship editing.

Interface language does not choose country, timezone, calendar, record currency, recipient language or display unit. Verify Persian month boundaries and leap cases, Berlin DST ambiguity, Tehran instants and civil dates separately. Changing to German must not change a selected Iranian calendar or IRR/toman unit. Preserve exact approved conversions: 1,234,560 IRR → 123,456 toman; 1 IRR → 0.1 toman; no rounding or FX.

## 8. User research and prototype acceptance

Proposed recruitment is 6–8 Farsi-dominant and 6–8 German-dominant sales/manager participants across the core rounds, plus two self-hosted maintainers for operations rehearsal. Recruit specialist tender/partner/customer-success/product-led participants only for their relevant later projects. These are proposed sessions, not contacts, invitations or approved expenditure. Reuse participants transparently; do not describe repeated sessions as independent samples.

Begin with five participants per primary language per core round when feasible, using role-appropriate tasks and synthetic data. Measure unassisted completion, consequential errors, time, confidence, terminology comprehension and recovery. Report exact denominators and qualitative findings; small samples do not prove market-wide performance.

Core script:

1. Create a new process from a template while retaining an existing pipeline.
2. Give a colleague the intended access and explain what they can and cannot see.
3. Save a shared view and predict what a more restricted colleague will see.
4. Move a deal with missing required evidence; fix the problem and return to work.
5. Find the most urgent permitted follow-up and complete or postpone it.
6. Compare a cohort funnel with a closing-period win rate and open the contributing deals.
7. Recover from a stale edit or uncertain queued message without duplicating the effect.
8. In the later tenancy study, switch workspace with an unsaved edit and explain the context after switching.

Before implementation, review flow coverage and terminology; before release, repeat the relevant tasks in the working candidate. R1 requires at least 90% unassisted completion in each primary-language round and no unresolved consequential access/data misunderstanding. A single severe disclosure or destructive-action misunderstanding blocks the affected flow regardless of average success.

Review at 390, 768, 1280 and 1440 CSS-pixel viewports, light/dark themes, 200% zoom and representative 400% reflow. Check keyboard-only operation and at least one browser/screen-reader pairing per primary platform. Long German labels, Persian text joining, bidi isolation, real font loading, reduced motion, focus indicators and error announcements are required checks.

## 9. Deliverables, cadence and handoff

Each completed study yields a short research question, evidence log, annotated flow, adopt/adapt/reject table, current-shell prototype, task results, unresolved questions and linked SP acceptance criteria. Use original synthetic records; avoid recording personal/provider secrets. Set access/retention and obtain participant consent before recording any real session.

Review designs at the end of discovery, before the first vertical slice, after a working prototype, and before enablement. Review programme scope biweekly during active work and after any baseline or provider-contract change. Cross-reference WF/IG owners when a study touches their UI; do not commission a duplicate builder or connection design.
