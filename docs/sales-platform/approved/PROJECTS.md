# Project roadmap and delivery tasks

**Status:** proposed, 31 October 2026. All tasks are **Planned**. Existing implemented work is reused through dependencies and is not claimed as newly delivered here. Read the [product brief](PRD-Warpdrive-Sales-Process-Platform.md), [research programme](UX-RESEARCH.md), and [preservation plan](INTEGRATION-SAFETY.md) together.

Priority is relative to this programme: P0 blocks its first release; P1 expands core value; P2 requires specific adoption/source evidence. Sizes are rough maintainer effort, including design/review/qualification: M = 2–4 person-weeks, L = 4–8, XL = 8–12, XXL = 12+ and must be decomposed before commitment. These are assumptions with substantial uncertainty, not durations or a staffed delivery promise. Do not sum parallel projects into a calendar deadline.

## Programme map

| Project | Priority | Horizon | Size | Outcome |
| --- | --- | --- | --- | --- |
| SP-00 | P0 | R0 | M | Preserve the actual product and reconcile integration/migration lineage. |
| SP-01 | P0 | R0–R1 | L | Research-backed interaction and language specifications in the current shell. |
| SP-02 | P0 | R1 | L | Clear pipeline lifecycle and sharing without changed legacy authority. |
| SP-03 | P0 | R1 | L | Saved views and next-action queues without duplicated CRM data. |
| SP-04 | P0 | R1–R2 | L | Versioned process templates and safely activated stage policies. |
| SP-05 | P1 | R2 | M | Optional qualification frameworks and contextual selling guidance. |
| SP-06 | P1 | R2 | L | Account teams, buying groups, and coordinated opportunities. |
| SP-07 | P1 | R2+ | XL | Follow-up through the existing qualified workflow and communication engines. |
| SP-08 | P1 | R3 | XL | Explainable funnel, aging, movement, and forecast analytics. |
| SP-09 | P1 | R4 | L | Linked onboarding, renewal, and expansion after a sale. |
| SP-10 | P2 | R4+ | L | Internal partner sales; external portal separately gated. |
| SP-11 | P1 | R4 | L | Tender and RFP response ownership, evidence, and submission tracking. |
| SP-12 | P2 | R4+ | XL | Product-led signals and explainable qualification from actual permitted sources. |
| SP-13 | P2 | R4+ | L | Marketing funnel, attribution, referral, and advocacy measurement. |
| SP-14 | P2 | Research R0; delivery R5 | XXL | Independent company workspaces with qualified isolation and migration. |
| SP-15 | P0 | Every release | XL | Security, regional, accessibility, performance, recovery, and OSS release evidence. |

SP-00 → SP-01 → SP-02/03/04 form the first-release path. SP-05/06/07 precede R2; SP-08 precedes R3. SP-09/10/11/12/13 are separately selectable branches. SP-14 can be researched early but cannot impose a rushed tenant migration on R1. SP-15 starts immediately and gates each delivered slice.

## SP-00 — Preserve, inventory, and converge

**Owner role:** Engineering lead. **Outcome:** a named baseline can be upgraded without losing current UI or pending integration work. **Approach:** inventory every active head and ownership boundary, reconcile migration lineages in an isolated integration branch, and rehearse before new schema work. **Integration boundary:** preserve existing WF/IG tasks and their qualification ceilings; never merge or reset a peer branch just because it is listed here. **Research:** UX-01, UX-20.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-00.1 | Inventory checkouts, heads, dirty files, owners, previews, services, and existing plans in a signed baseline manifest. | Exact source and runtime locations are known; no peer work is silently adopted or overwritten. | — |
| SP-00.2 | Capture current navigation, tokens, components, density, record pages, FA/DE states, and persisted UI preferences. | A dated reference set identifies the current design to preserve and known defects to improve. | SP-00.1 |
| SP-00.3 | Compare migration files, journal tags/checksums, snapshots, and applied ledgers for workflow and integration lineages. | The conflicting 0083 histories have a reviewed upgrade strategy for each supported installation shape. | SP-00.1 |
| SP-00.4 | Map critical existing journeys and data invariants; separate reported evidence from rerun checks. | Every protected journey has an owner, fixture, permission context, and evidence requirement. | SP-00.1 |
| SP-00.5 | Agree domain commands, event identifiers, feature ownership, and compatibility boundaries across SP/WF/IG. | No duplicate auth, sender, workflow, calendar, or currency authority is planned. | SP-00.3; SP-00.4 |
| SP-00.6 | Prepare the isolated combined candidate and rehearse upgrades from both known branch lineages and the supported main baseline. | Rows, IDs, permissions, inboxes, workflows, and UI preferences reconcile after upgrade and recovery. | SP-00.2; SP-00.3; SP-00.5 |
| SP-00.7 | Record Bun/lockfile/dependency ownership, licenses, notices, and exact build/worker compatibility on the candidate. | Frozen install and required candidate checks use declared managers; unrelated upgrades remain separate. | SP-00.6 |
| SP-00.8 | Publish the R0 evidence pack, remaining risks, baseline commit, and approved first-slice boundaries. | Product, design, engineering, and release reviewers can assess a concrete candidate and recovery plan. | SP-00.4; SP-00.6; SP-00.7; SP-01.8; SP-15.1 |

## SP-01 — Research, information architecture, and design contract

**Owner role:** Design/research lead. **Outcome:** users understand what to create, where to work, and who can access it. **Approach:** study Mobbin patterns, test the vocabulary and complete workflows, then prototype within the actual current shell. **Integration boundary:** references inform interactions; they do not authorize a wholesale visual replacement. **Research:** UX-01–UX-20; initial focus UX-01–UX-07.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-01.1 | Audit current-shell patterns and establish the screen/state inventory and design-token contract. | Screens use existing components and name the exact exceptions requiring a new reusable component. | SP-00.2 |
| SP-01.2 | Interview salespeople, managers, maintainers, tender/partner users; measure baseline task time and errors. | Research findings distinguish observed needs from requested features and assumptions. | SP-00.4 |
| SP-01.3 | Complete prioritized Mobbin studies with exact flows, frame notes, limitations, and adopt/adapt/reject decisions. | Every proposed interaction has an evidence trail or a clearly marked new-design hypothesis. | SP-01.1 |
| SP-01.4 | Test the workspace/team/pipeline/view/funnel/channel vocabulary using concept sorting and navigation tasks. | Users distinguish entities; Farsi/German terms and information architecture are reviewed. | SP-01.2 |
| SP-01.5 | Prototype create/share/template/view/stage-rule journeys plus empty, error, denied, conflict, and recovery states. | Reviewers can complete each flow from entry to persistence and return navigation. | SP-01.3; SP-01.4 |
| SP-01.6 | Review Farsi first, German second, then English; cover mixed direction, calendar, money, keyboard, and narrow layouts. | Contextual copy and component behavior pass the language/state checklist with no user-data rewriting. | SP-01.5 |
| SP-01.7 | Run moderated task-based testing, revise the prototype, and retest consequential misunderstandings. | Completion/error/time results meet KR-01 or identified issues are resolved and retested. | SP-01.6 |
| SP-01.8 | Publish the interaction specification, reusable patterns, content glossary, recordings/notes policy, and design decisions. | Engineering has complete state behavior and acceptance examples without inferring from screenshots. | SP-01.7 |

## SP-02 — Pipeline lifecycle and understandable sharing

**Owner role:** CRM engineering lead. **Outcome:** authorized users can create and manage several processes and explain who can see or change them. **Approach:** extend existing pipeline services, preserve legacy visibility, and introduce a reviewed scope representation with explicit server checks. **Integration boundary:** current record visibility and capability ceilings remain effective; shared views do not grant membership. **Research:** UX-01, UX-02, UX-03, UX-18.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-02.1 | Specify pipeline metadata, ownership, ordering, status, search, and directory/switcher behavior. | Existing pipeline IDs, URLs, order, and open-board behavior remain valid. | SP-00.8; SP-01.4 |
| SP-02.2 | Define pipeline access truth tables, effective-access explanations, delegated management, and legacy mapping. | All capabilities have allow/deny examples; no role silently exceeds existing record authority. | SP-02.1; SP-15.2 |
| SP-02.3 | Extend creation, rename, duplicate-structure, and edit services through existing mutations and CSRF/freshness rules. | Creation is atomic; duplicate copies configuration only; retries cannot create accidental duplicates. | SP-02.2 |
| SP-02.4 | Add scope selection, people/team access editor, and effective-access preview with permission revalidation. | Users see who gains/loses access; stale edits conflict safely; revocation reaches every read/write surface. | SP-02.3 |
| SP-02.5 | Implement archive, restore, owner handover, and protected removal with dependency previews. | History remains available under policy; linked rules/views are explained; no silent data purge occurs. | SP-02.3 |
| SP-02.6 | Qualify deal transfer, stage mapping, bulk-operation preview, and partial-failure reporting. | Each transferred deal has one valid destination stage and exact provenance; no hidden workflow effects. | SP-02.3; SP-00.5 |
| SP-02.7 | Audit lifecycle/access changes and expose a permission-safe history and recovery explanation. | Actor, time, scope revision, and affected resources are traceable without exposing restricted names. | SP-02.4; SP-02.5; SP-02.6 |
| SP-02.8 | Qualify creation, access change, downgrade, archive/restore, concurrent edits, and transfer journeys in FA/DE/EN. | Existing restricted pipelines preserve access; all required API, worker, export, search and UI cases pass. | SP-02.7; SP-15.3 |

## SP-03 — Saved views, work queues, and collaboration

**Owner role:** CRM experience engineering. **Outcome:** people organize the same permitted records differently without copying them into artificial funnels. **Approach:** version and extend the existing saved-filter model; reuse activity lists and board/list adapters. **Integration boundary:** sharing a definition never shares query results or the creator's authority. **Research:** UX-04, UX-07, UX-18.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-03.1 | Inventory historic filter definitions and specify a versioned view contract with compatible decoding. | Existing saved filters round-trip and unknown operators fail with useful recovery guidance. | SP-00.8 |
| SP-03.2 | Implement scoped query composition for pipeline, owner/team, source, date, status, labels and permitted custom fields. | SQL and UI apply the same filter meaning and intersect the current user's visibility. | SP-03.1; SP-02.4 |
| SP-03.3 | Add personal/shared views, favorites, view-specific columns/sort, duplicate, rename and reset behavior. | Preferences persist per intended scope; board/list switches preserve filters and return context. | SP-03.2 |
| SP-03.4 | Build a next-action queue from existing activities and deals with explicit priority reasons and quick actions. | Overdue, unassigned and missing-next-step work is actionable without fabricated task records. | SP-03.3 |
| SP-03.5 | Add team presets and an aggregate permitted list; reserve cross-pipeline boards for compatible stage semantics. | Different processes are not forced into one misleading column order; managers see permitted totals only. | SP-03.3 |
| SP-03.6 | Reuse record comments, mentions and followers; define accessible notification and unread behavior. | A notification cannot disclose or reopen a record after access loss; duplicates are controlled. | SP-03.3 |
| SP-03.7 | Export a scoped view with explicit fields, currency/unit/date meaning, safe CSV text, and asynchronous progress. | Export matches the authorized query at execution and download; sharing does not broaden it. | SP-03.2; SP-15.2 |
| SP-03.8 | Qualify old-filter compatibility, hidden fields, stale views, mobile queues, and shared-view revocation. | Permission removal changes results consistently across cache, export, search and browser navigation. | SP-03.4; SP-03.5; SP-03.6; SP-03.7 |

## SP-04 — Process templates, stage rules, and safe evolution

**Owner role:** CRM configuration engineering. **Outcome:** teams can begin from a suitable process and evolve it without overwriting their custom work. **Approach:** immutable template versions plus explicit install/upgrade plans; keep current stage IDs stable. **Integration boundary:** templates reference reviewed fields/actions, never contain executable code or activate outbound messages on install. **Research:** UX-05, UX-06, UX-19.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-04.1 | Specify versioned template manifests, stable keys, field references, locale labels, provenance, and supported capabilities. | Manifests validate deterministically and cannot contain scripts, secrets or arbitrary provider commands. | SP-00.5; SP-01.8 |
| SP-04.2 | Build atomic, idempotent template installation with dry-run planning and explicit ID mapping. | Repeated installation requests do not duplicate stages/fields and historic records are untouched. | SP-04.1; SP-02.3 |
| SP-04.3 | Design template browse/compare/customize/preview with a clear blank-pipeline and duplicate-existing path. | Users understand what is created, reused, unavailable, and left inactive before applying. | SP-04.2 |
| SP-04.4 | Implement template upgrade diff, local overrides, conflict resolution, and version provenance. | Local stage names/IDs survive; additions/removals require a reviewed mapping; no automatic overwrite. | SP-04.3; SP-02.7 |
| SP-04.5 | Add typed stage-entry requirements, advisory checklists, required fields, and capability-aware exceptions. | Rules name evidence and missing fields without exposing restricted information; existing pipelines default to current behavior. | SP-04.1; SP-02.2 |
| SP-04.6 | Enforce activated rules through every mutation path, including bulk, import, workflow and MCP, with audited overrides. | UI bypass cannot evade rules; retries, concurrent moves and administrative recovery are deterministic. | SP-04.4; SP-04.5 |
| SP-04.7 | Author standard B2B, enterprise, tender, partner and renewal template manifests in FA/DE/EN. | Only qualified capabilities are selectable; advanced templates explain unmet prerequisites and remain optional. | SP-04.4; SP-04.6 |
| SP-04.8 | Rehearse install, upgrade, override, rollback-compatible disablement and live-deal stage evolution. | Historic stage meaning and analytics provenance survive; existing saved views and workflows remain valid. | SP-04.7 |

## SP-05 — Qualification frameworks and selling guidance

**Owner role:** Product and CRM configuration engineering. **Outcome:** sellers collect useful evidence without being forced into a branded methodology. **Approach:** reusable typed field/checklist definitions with stage-contextual guidance and evidence links. **Integration boundary:** no second scoring authority or copied training library; existing custom-field types and permissions apply. **Research:** UX-06, UX-08.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-05.1 | Define framework scope, authoring rights, attribution, terminology, and opt-in selection per pipeline. | BANT, MEDDPICC, SPICED, SPIN, Challenger and Sandler each have a lawful, original-content implementation boundary. | SP-04.1; SP-01.8 |
| SP-05.2 | Model evidence, confidence/unknown states, source links, reviewer, freshness and field visibility. | Missing information is distinct from a negative answer; access to evidence is checked independently. | SP-05.1; SP-02.2 |
| SP-05.3 | Implement compact deal panels and a focused review screen using existing sidebars and field editors. | Sellers can update evidence, navigate back, and retain unsaved text in FA/DE without layout regressions. | SP-05.2 |
| SP-05.4 | Add versioned, explainable completeness/risk rules with an explicit unsupported/unknown result. | A displayed score can be traced to its evidence and rule version; it is not called a win probability. | SP-05.2 |
| SP-05.5 | Attach optional stage-specific prompts and call-preparation notes to existing activity/record workflows. | Guidance helps a task without creating mandatory duplicate data or exposing confidential notes. | SP-05.3 |
| SP-05.6 | Provide manager review, requested clarification, controlled override, and review history. | Changes preserve original evidence and identify the reviewer; authority is rechecked on submit. | SP-05.3; SP-05.4 |
| SP-05.7 | Map qualification fields to saved views, exports and activated stage policies. | Stable keys preserve meaning across template upgrades; hidden fields cannot be inferred through filters/scores. | SP-05.4; SP-03.2; SP-04.6 |
| SP-05.8 | Test framework switching, historical versions, regional copy, evidence revocation and low-information deals. | Switching frameworks neither erases evidence nor silently reinterprets historic scores. | SP-05.5; SP-05.6; SP-05.7 |

## SP-06 — Account-based selling and buying groups

**Owner role:** Customer-data engineering. **Outcome:** multiple sellers coordinate stakeholders and opportunities around one customer company. **Approach:** extend the existing customer-company/contact relationships with buying groups and scoped roles. **Integration boundary:** a customer organization remains CRM data; it never becomes an authentication workspace. **Research:** UX-08, UX-09.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-06.1 | Specify account, buying group, stakeholder role, relationship source, and opportunity associations. | One customer can have several buying groups and opportunities without duplicate identities. | SP-00.5; SP-01.8 |
| SP-06.2 | Add stable many-to-many associations and migration adapters around existing company/contact IDs. | Existing deals and contact history retain their links; merges have a defined survivor and audit path. | SP-06.1 |
| SP-06.3 | Design account overview with permitted opportunities, activities, relationship roles, and explicit incomplete-data states. | The page remains useful when some stakeholders or deals are hidden from the viewer. | SP-06.2; SP-02.2 |
| SP-06.4 | Add account-team responsibilities and relationship planning without new implicit record grants. | Assigning a role cannot accidentally reveal private opportunities or communications. | SP-06.3 |
| SP-06.5 | Link economic buyer, champion and decision-process evidence to qualification with independent visibility checks. | Removed/hidden contacts produce safe unresolved references and do not break deal editing. | SP-06.2; SP-05.2 |
| SP-06.6 | Reuse deduplication/merge/import workflows for account aliases, related companies and stakeholder updates. | Iranian/German names, raw phones and external identifiers survive without silent cross-account merging. | SP-06.2; SP-00.5 |
| SP-06.7 | Add target-account views and explainable activity/coverage summaries with permission-aware drill-down. | Every summary opens its contributing permitted records and discloses missing data. | SP-06.4; SP-03.3 |
| SP-06.8 | Qualify shared-account/private-deal cases, transfers, merges, removals, concurrent edits and regional presentation. | No new relationship path bypasses pipeline or mailbox visibility. | SP-06.5; SP-06.6; SP-06.7 |

## SP-07 — Activities, communications, and automation integration

**Owner role:** Existing WF/IG maintainers with CRM command owners. **Outcome:** sales actions and reminders run through one explainable system with reliable recovery. **Approach:** typed commands and committed domain events feed the existing WF engine; communication effects use qualified IG adapters. **External prerequisites:** WF automatic event/effect/wait milestones, IG mailbox/SMS/PBX/connection capabilities, and separate calendar parity work remain owned by their existing plans. **Research:** UX-07, UX-10, UX-19.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-07.1 | Map sales use cases to the current WF/IG capability registry and list missing handlers and prerequisites. | Product UI advertises only implemented and qualified effects; ownership is agreed with existing project maintainers. | SP-00.5; SP-04.1 |
| SP-07.2 | Reuse/complete the WF committed event outbox contract for stage changes, assignments and lifecycle transitions. | Rolled-back transactions emit no effects; event IDs, ordering, origin and replay semantics are deterministic. | SP-07.1; SP-00.6 |
| SP-07.3 | Route every sales mutation through shared commands that validate scope, stage policy and idempotency. | UI, bulk, imports, workers, APIs and MCP agree on rule enforcement and event emission. | SP-07.2; SP-04.6 |
| SP-07.4 | Add contextual automation suggestions, template preview and explicit activation without replacing the current builder. | Users can inspect trigger, actor, records, recipients, connection and effects before activation. | SP-07.3; SP-01.8 |
| SP-07.5 | Integrate due dates, business calendars, timezone/calendar intent, postponement and durable waits through qualified WF capabilities. | Restart, DST changes and access loss cannot duplicate or silently shift promised actions. | SP-07.1; SP-15.3 |
| SP-07.6 | Consume qualified email/SMS/call/task actions with sender, recipient, suppression and delivery-state controls. | Uncertain delivery remains reviewable; no blind resend or simulated external write occurs. | SP-07.3; SP-07.5 |
| SP-07.7 | Link action history, run history, cancellation, audit and recovery from the deal/account UI. | Historic versions and external outcomes remain distinguishable; revocation prevents new effects. | SP-07.4; SP-07.6 |
| SP-07.8 | Qualify event replay, duplicate callbacks, stale authority, unknown outcomes, provider unavailability and worker recovery. | Every effect has the correct evidence ceiling; missing real-provider qualification remains an explicit gate. | SP-07.7 |

## SP-08 — Event history, analytics, and forecasting

**Owner role:** Analytics engineering. **Outcome:** users can explain conversions, delays, pipeline changes and forecasts from the actual permitted records. **Approach:** extend `docs/pipeline-analytics-proposal.md`, existing SQL and change logs; introduce versioned exact events and snapshots where needed. **Integration boundary:** current inferred funnel remains labeled and available until explicitly migrated; money never mixes currencies or introduces unapproved FX. **Research:** UX-11, UX-12.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-08.1 | Define the metric dictionary, denominators, cohort/event/inventory bases, currency, timezone and stage-version semantics. | Each chart has a formula, examples, unavailable-data rules and contributing-record definition. | SP-00.5; SP-01.8 |
| SP-08.2 | Capture exact stage entries/exits, skips, returns, transfers and outcomes through the shared event contract. | Event IDs preserve ordering/provenance; duplicate delivery cannot inflate history. | SP-08.1; SP-07.2 |
| SP-08.3 | Build honest legacy adapters and optional backfill from evidence without inventing missing transitions. | Reports disclose inferred, exact and incomplete periods; stage reorder cannot rewrite history. | SP-08.2; SP-04.4 |
| SP-08.4 | Deliver funnel, aging, open-stage age and completed-duration views with sample sizes and permission-safe drill-down. | Skips/reopens and right-censored open stays are handled according to the documented measure. | SP-08.3; SP-03.2 |
| SP-08.5 | Reconcile pipeline movement by additions, wins/losses, transfers, value changes, removals and reopenings. | Opening inventory plus movements equals closing inventory under the same scope and currency. | SP-08.2; SP-08.4 |
| SP-08.6 | Add forecast scenarios, probability sources, coverage, close-date slippage and pinned forecast snapshots. | Assumptions are visible; later edits cannot rewrite previous forecasts; no false precision or mixed-currency total. | SP-08.1; SP-08.5 |
| SP-08.7 | Reuse saved views/export and add accessible chart tables, empty/sample warnings and report definitions. | Every total reconciles to its permitted records; hidden records cannot leak through caches or exports. | SP-08.4; SP-08.6; SP-03.7 |
| SP-08.8 | Qualify analytic edge cases, permission changes, stage evolution, exact money and representative workloads. | Hand-calculated fixtures reconcile and declared performance budgets pass on the exact candidate. | SP-08.7; SP-15.4 |

## SP-09 — Bowtie, onboarding, renewals, and expansion

**Owner role:** Revenue-lifecycle engineering. **Outcome:** a sale can hand over to a new owner and generate recurring opportunities without changing the original sales result. **Approach:** link lifecycle records and contract-period intent; keep post-sale work separate from the acquisition pipeline. **Integration boundary:** no full ERP, project-management replacement, subscription billing, tax calculation, or automatic financial posting. **Research:** UX-13, UX-10.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-09.1 | Specify customer lifecycle, handover, relationship to won deals, renewal intent and expansion opportunity semantics. | Onboarding/adoption states do not overwrite acquisition won/lost or count revenue twice. | SP-06.1; SP-08.1 |
| SP-09.2 | Add linked lifecycle records and minimal contract/period metadata with exact money and explicit date intent. | Records link to the existing account/deal and preserve calendar, timezone and currency meaning. | SP-09.1; SP-15.3 |
| SP-09.3 | Build a handover checklist, owner acceptance, missing-information review and account timeline. | Receiving teams can accept/reject handover; original evidence and access remain intact. | SP-09.2; SP-03.4 |
| SP-09.4 | Create onboarding/adoption templates using the existing task/workflow engines. | Disabled automation creates no work; retries and owner changes cannot duplicate milestones. | SP-09.3; SP-07.3 |
| SP-09.5 | Add renewal planning, notice dates, upcoming-renewal views, reminders and explicit renewal-deal creation. | Recurrence intent is preserved; leap/DST/calendar cases are previewed and creation is idempotent. | SP-09.2; SP-07.5 |
| SP-09.6 | Link expansion opportunities and explainable customer-health signals with user-managed evidence. | Health is not presented as proven churn prediction; hidden data remains hidden. | SP-09.2; SP-06.7 |
| SP-09.7 | Add retention/renewal/expansion reporting with agreed denominators and contract-source qualification. | ARR/MRR or churn is unavailable when reliable contract/billing evidence is absent. | SP-09.5; SP-09.6; SP-08.7 |
| SP-09.8 | Rehearse handover rejection, renewal cancellation, ownership change, duplicate events and restore scenarios. | Acquisition and post-sale histories reconcile independently with no unintended messages or financial writes. | SP-09.4; SP-09.7 |

## SP-10 — Partner and channel sales

**Owner role:** Partner-experience engineering. **Outcome:** internal teams register partner opportunities, resolve conflict and track responsibility; external access is a later slice. **Approach:** registration records and approval decisions reference existing accounts/deals rather than duplicate them. **Integration boundary:** internal membership is not a partner security boundary; portal access requires SP-14. **Research:** UX-14, UX-03, UX-09.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-10.1 | Research partner roles, exclusivity expectations, attribution, approval and cross-partner conflict cases. | Internal workflow and external-access requirements are separately agreed. | SP-01.2; SP-06.1 |
| SP-10.2 | Model partner links and registrations with expiry, evidence, duplicate suggestions and explicit ownership. | One opportunity has traceable partner participation without automatic contact/deal duplication. | SP-10.1; SP-06.2 |
| SP-10.3 | Build the internal register/review/approve/reject/request-information workflow and dependency-aware notifications. | Decisions preserve evidence and cannot silently transfer account ownership or visibility. | SP-10.2; SP-02.2 |
| SP-10.4 | Add co-selling responsibilities, referral provenance and declared commercial terms as reference metadata. | Financial data remains informational; no inferred commission liability or accounting entry is generated. | SP-10.3 |
| SP-10.5 | Configure partner pipeline/templates and reuse follow-up/cancellation through qualified WF/IG effects. | Expiry, conflict and rejection do not trigger duplicate or unauthorized messages. | SP-10.3; SP-04.8; SP-07.8 |
| SP-10.6 | Deliver internal partner performance views with traceable attribution and currency-separated values. | Counts do not multiply when several partners touch one opportunity; definitions are visible. | SP-10.4; SP-08.7 |
| SP-10.7 | Design and qualify an optional external portal with explicit resource grants and partner-safe DTOs. | Cross-workspace/partner isolation, invite revocation and download/export restrictions pass before access opens. | SP-10.3; SP-14.8 |
| SP-10.8 | Qualify internal conflict/expiry/reassignment flows and, separately, the optional external portal. | Internal release can be accepted without claiming the portal; external release needs its own evidence pack. | SP-10.5; SP-10.6 |

## SP-11 — Tender and RFP response workflow

**Owner role:** Enterprise-sales engineering. **Outcome:** teams can decide whether to bid, coordinate a response, retain the approved submission, and track its outcome. **Approach:** add tender-specific records, evidence and approvals around existing customer/opportunity/task/file entities. **Integration boundary:** submission stays explicit and user-controlled; the product does not certify legal compliance or send bids automatically. **Research:** UX-15, UX-06, UX-10.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-11.1 | Interview bid teams and specify qualification, owner roles, deadlines, attachments and go/no-go decisions. | Required procurement facts and industry-specific variations are documented without invented legal rules. | SP-01.2; SP-06.1 |
| SP-11.2 | Model tender, requirement, response owner, decision and file-version associations. | Existing file permissions, IDs, customer links and retention policy remain authoritative. | SP-11.1; SP-06.2 |
| SP-11.3 | Deliver tender intake, qualification matrix, duplicate review and explicit bid/no-bid recording. | Users can explain the decision and change it with audit rather than erase earlier evidence. | SP-11.2; SP-05.2 |
| SP-11.4 | Create a workback plan with milestones, reviewers, local deadline input, timezone and calendar previews. | Iranian/German civil dates and instants are unambiguous; deadline changes are reviewed. | SP-11.2; SP-07.5 |
| SP-11.5 | Add requirement assignments, completeness, review states and scoped reusable answer references. | Restricted answers and files cannot leak through search, exports, templates or shared reviews. | SP-11.2; SP-02.2 |
| SP-11.6 | Implement versioned approval and submission-package preparation with immutable approved evidence. | The prepared artifact matches the approved version; later edits invalidate or require renewed approval. | SP-11.3; SP-11.5 |
| SP-11.7 | Record manual submission reference, amendments, award/loss, debrief and permitted reporting. | Preparing/exporting a package is not mislabeled as actual submission or customer receipt. | SP-11.6; SP-08.7 |
| SP-11.8 | Qualify deadline revisions, withdrawn bids, reviewer access loss, conflicting versions and restore. | No workflow sends a bid or changes financial commitments without explicit approved action. | SP-11.4; SP-11.7 |

## SP-12 — Product-led sales and first-party signals

**Owner role:** Integrations/data engineering. **Outcome:** sellers understand why actual product usage suggests a sales conversation. **Approach:** qualify one real permitted signal source, map stable identities, then expose versioned rules and evidence. **Integration boundary:** do not infer identity by loose email/phone matching or import private behavioral data without a defined source purpose. **Research:** UX-16, UX-08, UX-19.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-12.1 | Validate an actual product-led use case, source contract, data owner, retention and consent/suppression requirements. | A named permitted source and operational owner exist before implementing an ingestion connector. | SP-01.2; SP-07.1 |
| SP-12.2 | Specify event schema, identity mapping, event time, received time, deduplication and deletion semantics. | Unknown or conflicting identities are quarantined for review instead of merged automatically. | SP-12.1; SP-06.2 |
| SP-12.3 | Add bounded authenticated ingestion with replay protection, rate limits and purpose-limited payload storage. | Invalid, late, duplicate and oversized events fail safely without flooding jobs or histories. | SP-12.2; SP-15.2 |
| SP-12.4 | Implement versioned product-qualified rules using fit, demonstrated value and intent with explainable thresholds. | Each qualification explains its source events, time window, missing evidence and rule version. | SP-12.3; SP-05.4 |
| SP-12.5 | Build an evidence panel and qualified work queue with dismiss/snooze/assign and source-status states. | Sellers can act without treating a signal as consent to contact or an assured purchase. | SP-12.4; SP-03.4 |
| SP-12.6 | Integrate explicitly activated follow-up through the shared command/WF/IG path. | Replay and threshold flapping cannot repeatedly create deals or send messages. | SP-12.5; SP-07.8 |
| SP-12.7 | Measure qualification-to-conversation/conversion using defined cohorts and controlled experiments where practical. | Correlation is not reported as causal lift; exclusions and source outages are visible. | SP-12.5; SP-08.7 |
| SP-12.8 | Qualify identity changes, opt-out/deletion, source outage, late events, repeated thresholds and retention expiry. | Removed authority or data is not resurrected by replay, exports or downstream caches. | SP-12.6; SP-12.7 |

## SP-13 — Marketing funnels, attribution, referrals, and flywheel

**Owner role:** Growth-data engineering. **Outcome:** teams can relate acquisition and customer advocacy to opportunities without conflating marketing activity with revenue proof. **Approach:** add defined campaigns/source touchpoints and lifecycle associations; report acquisition cohorts separately from sales-stage progression. **Integration boundary:** no mass campaign sender, implicit contact permission or automatic retrospective attribution. **Research:** UX-17, UX-11, UX-13.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-13.1 | Define acquisition funnel stages, qualified handoff, campaign/source taxonomy and required source evidence. | Awareness/interest/action measures are distinct from active-deal stages and closing-period win rate. | SP-08.1; SP-01.8 |
| SP-13.2 | Add touchpoint/campaign references around existing source-channel fields with explicit unknown states. | Original source data remains intact; importing a touchpoint does not create a campaign membership/send. | SP-13.1; SP-00.5 |
| SP-13.3 | Qualify secure website/form intake and connect deduplication and assignment through existing IG/WF capabilities. | Abuse, duplicate intake, opt-out and replay are controlled without auto-merging uncertain identities. | SP-13.2; SP-07.8 |
| SP-13.4 | Implement labeled first-touch/last-touch attribution, with a path for later approved multi-touch modeling. | Each attribution result names its rules/window; historic unknowns are not rewritten as facts. | SP-13.2; SP-08.3 |
| SP-13.5 | Add lead-to-opportunity handoff and feedback without duplicating the customer or resetting its history. | Rejected or returned handoffs retain reason, owner, timestamps and permissions. | SP-13.3; SP-06.2 |
| SP-13.6 | Add opt-in referral/advocacy records and customer-success handoffs using explicit owner actions. | A customer is not automatically enrolled or contacted because a deal was won. | SP-13.5; SP-09.3 |
| SP-13.7 | Report acquisition quality, referral conversion and lifecycle contribution with honest cost/source availability. | CAC/ROAS remains unavailable without qualified cost data; currency and event definitions are explicit. | SP-13.4; SP-13.6; SP-08.7 |
| SP-13.8 | Qualify multiple touchpoints, source correction, suppression, duplicate conversions and view/export access. | No duplicated revenue, forbidden outreach or disclosure through marketing summaries remains. | SP-13.7 |

## SP-14 — Independent workspaces and isolation

**Owner role:** Architecture/security lead. **Outcome:** one person may join several genuinely isolated company workspaces without accidental cross-company access. **Approach:** select architecture from evidence, introduce a default-workspace compatibility layer, migrate incrementally, and enable switching only after every background and foreground surface is scoped. **Integration boundary:** preserve Better Auth and CRM customer organizations; an auth plugin or dropdown alone is insufficient. **Research:** UX-01, UX-03, UX-18, UX-20.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-14.1 | Research multi-company operators and compare separate deployments/databases with shared-database tenancy. | Ali can choose from costs, migration impact, backup/export isolation, cross-workspace identity and maintenance tradeoffs. | SP-01.2; SP-00.5 |
| SP-14.2 | Record the tenancy/auth architecture decision, membership semantics, admin boundary and threat model. | Customer organizations remain separate; Better Auth integration cannot create a second authority bypass. | SP-14.1; SP-15.2 |
| SP-14.3 | Inventory every tenant-owned object and add workspace context contracts/default-workspace compatibility. | A complete surface registry covers schema, joins, files, cache, jobs, events, WS, search, exports, provider tokens and MCP. | SP-14.2; SP-00.6 |
| SP-14.4 | Rehearse additive schema/backfill/composite references and uniqueness scoping on representative legacy installations. | Every legacy row is attributable; unknown ownership halts that record's migration rather than guessing. | SP-14.3; SP-15.5 |
| SP-14.5 | Scope request/session context, background jobs, integrations, object storage, search and cache at server boundaries. | Client-supplied workspace IDs cannot overrule validated membership; stale context fails closed. | SP-14.4 |
| SP-14.6 | Implement create/join/invite/switch/leave/recover flows, owner transfer and unsaved-context handling. | Switching resets scoped caches/subscriptions; role removal invalidates access; last-owner cases have recovery. | SP-14.5; SP-01.8 |
| SP-14.7 | Run adversarial cross-workspace, restore/export, concurrent switch/revoke and old-client migration qualification. | Every listed isolation surface passes; global operator access is explicit, audited and separate from workspace admin. | SP-14.6; SP-15.5 |
| SP-14.8 | Enable a controlled multi-workspace release with operator limits, docs, observability and recovery evidence. | No unknown-scope jobs/tokens remain; legacy single-workspace installs keep their workflow and URLs through adapters. | SP-14.7; SP-15.7 |

## SP-15 — Cross-cutting quality, operation, and open-source delivery

**Owner role:** Release/security engineering. **Outcome:** each capability ships with evidence, understandable limits, and a rehearsed recovery path. **Approach:** provide test fixtures and operational controls from R0 onward; apply gates to every slice rather than defer quality until the end. **Integration boundary:** use the declared Bun setup and existing checks; do not replace working security/region engines or run paid/provider campaigns from this planning document. **Research:** UX-18, UX-19, UX-20 and every locale-specific study.

| ID | Task and delivery | Done when | Dependencies |
| --- | --- | --- | --- |
| SP-15.1 | Create the critical-journey fixture/evidence registry and exact-candidate verification workflow. | Protected data/UI journeys, baseline states, test owners and evidence ceilings are explicit. | SP-00.4 |
| SP-15.2 | Review threat model, authorization matrix, privacy, export/file isolation, audit and untrusted-input boundaries. | Each foreground/background/API/MCP surface has an applicable deny test and incident owner. | SP-00.5 |
| SP-15.3 | Maintain FA/DE/EN contextual copy, date/money/phone invariants, accessibility and state-complete screen acceptance. | Critical journeys pass native review, keyboard/screen-reader checks, RTL/LTR and responsive/theme matrices. | SP-01.6 |
| SP-15.4 | Benchmark representative/pilot/stress datasets on declared hardware and enforce adjustable resource budgets. | Latency, memory, queue lag, concurrency, export and reconnect behavior meet agreed measured limits. | SP-02.1; SP-15.1 |
| SP-15.5 | Rehearse backup, restore, migration interruption, rollback compatibility and forward recovery for every supported lineage. | Exact data/authority checks reconcile and recovery time/loss targets are measured rather than assumed. | SP-00.3; SP-15.1 |
| SP-15.6 | Add redacted diagnostics, metric/alert ownership, safe feature disablement and stuck-job/provider-revocation runbooks. | Operators can detect, contain and explain failure without exposing personal data or losing uncertain effects. | SP-00.5; SP-15.2 |
| SP-15.7 | Assemble release candidates with migration, functional, security, regional, performance and operations evidence. | G0–G5 as applicable pass; code rollback versus data recovery is stated; broad enablement has named acceptance. | SP-15.1; SP-15.2; SP-15.3; SP-15.4; SP-15.5; SP-15.6 |
| SP-15.8 | Publish OSS docs, license/notice updates, capability limits, changelog, upgrade guide and release handoff. | A maintainer can install, upgrade, disable, diagnose and recover using reviewed version-matched instructions. | SP-15.7 |

## Milestone acceptance and project selection

- **R0:** SP-00.8 plus the scoped SP-15 foundation. No schema collision remains unexplained; current UI and peer work are accounted for.
- **R1:** SP-02.8, SP-03.8, basic SP-04 installation/upgrade safety, and applicable SP-15 release gates. Advanced templates appear only when their capabilities are qualified.
- **R2:** SP-04.8, SP-05.8, SP-06.8, and the selected SP-07 effects with their actual WF/IG prerequisites. Missing providers remain unavailable, not simulated as complete.
- **R3:** SP-08.8 and applicable SP-15 gates; historical inference and forecast limits remain visible.
- **R4:** accept SP-09, SP-11, and other selected motions independently. Decide from observed user need and a named maintenance owner; do not require all projects for one release.
- **R5:** SP-14.8. The external partner portal is a separate acceptance slice under SP-10.7 and cannot be claimed by the internal SP-10.8 milestone.

The eight-task cards are programme work packages. Split XL/XXL work into implementation issues before execution, retaining parent IDs and acceptance boundaries. A UI task is complete only when its loading, empty, validation, permission, conflict, offline/retry and recovery states are specified and exercised for the relevant slice.
