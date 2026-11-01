# PRD: Warpdrive Sales Process Platform

**Date:** 31 October 2026. **Status:** proposed programme; implementation has not started through this document. **Scope:** product expansion built on the current open-source CRM. **Planning units:** relative releases and task dependencies, not promised calendar dates.

## 1. Summary

Extend Warpdrive so sales teams can organize different sales motions, collaborate with clear access, and understand progression from acquisition through renewal. Keep the working UI and existing records, reuse the authentication, communication, automation, and regional foundations, and introduce each capability through a reversible, qualified increment. Independent workspaces are a separately gated architectural extension rather than a prerequisite for improving the current pipeline experience.

## 2. Decision responsibilities

| Responsibility | Decision owner |
| --- | --- |
| Product priorities, terminology, intended customers, and release acceptance | Ali. |
| Architecture, migration safety, and integration review | A named maintainer assigned before the relevant project starts. |
| Interaction design, Mobbin study, and usability findings | A named product designer/researcher assigned in SP-01. |
| Farsi contextual language review | A fluent Farsi reviewer; separate from automated catalog checks. |
| German contextual language review | A fluent German reviewer; separate from automated catalog checks. |
| Security, operations, and release evidence | Named reviewers assigned in SP-15; they must not silently inherit ownership from a contributor. |

These are proposed roles, not claims that a staffed team exists. One person may hold several roles, but the review responsibilities remain explicit.

## 3. Background and existing foundation

The preview at `http://127.0.0.1:3116` was inspected on 31 October 2026. It exposed Sales Pipeline and Workflow preview in the pipeline picker. Its code was in `/private/tmp/warpdrive-workflows-20261031`, observed at commit `d0c83e8ad0ed07097f40bec82727976d022b7742` on `codex/visual-workflows`. This is a preview branch, not a declaration that all its features are merged into main.

The observed data model supports one workspace per installation, many pipelines, team memberships and visibility-group memberships without explicit count quotas, one optional pipeline visibility group, and one pipeline/stage per deal. Creating a pipeline requires management permission. There is no first-class pipeline membership with per-pipeline roles and no cross-company workspace switcher. The creation dialog currently submits a name without a sharing editor.

The existing foundation includes board/list views, deal pages, contacts and customer companies, activities, saved filters, custom fields, change logs, dashboard analytics, permission predicates, Better Auth, and an early-access visual workflow builder. The workflow status document reports a qualified manual deal-to-task slice and explicitly leaves automatic events, waits, external effects, and broader release gates open. This programme must extend that work, not restart it.

A separate integrations checkout was observed with main baseline `8539fe8c4aeb0b58b6d05e629710460ef90bbed4` and in-progress independent email/regional work. Its current source includes migrations `0083` through `0088`; the workflow branch has a different `0083_visual_workflows.sql`. Their journal lineage must be reconciled before an integration release. Neither a shared numeric prefix nor a passing branch-local test establishes a safe combined upgrade.

Existing analytics, workflow, authentication, calendar, and local-integrations plans remain authoritative for their approved scope. Their status must be refreshed at project start because active branches can change after this snapshot. See the [source register](SOURCES-AND-DECISIONS.md).

## 4. Objective and measurable outcomes

**Customer benefit:** organize several processes without duplicated customer records, understand access and next actions, and use each workflow naturally in Farsi or German.

**Product benefit:** support a broader range of sales teams while keeping the open-source distribution maintainable and upgrades recoverable. Adoption and retention hypotheses require observation; no revenue increase is claimed in advance.

| Key result | Baseline | Proposed target and measurement deadline |
| --- | --- | --- |
| KR-01: successful completion of create/share/filter/move tasks | Measure current experience during SP-01; no result invented. | At least 90% unassisted completion in each Farsi and German usability round, before R1 release acceptance. Report counts and participant numbers. |
| KR-02: prevent unintended data and access changes | Inventory exact row counts, IDs, authorities, and representative values during SP-00. | Zero unexplained record loss, unexpected historical effects, or unauthorized disclosures in every required upgrade/rollback and isolation scenario before each release. |
| KR-03: improve time to find the next permitted follow-up | Timed baseline from existing board/list/activity flows in SP-01. | Median task time at least 25% below that baseline by the R2 pilot review, with an equal or lower error rate. |
| KR-04: preserve current working behavior | Record current routes and journeys at the reconciled baseline. | Every designated critical journey passes on the exact release candidate in FA/DE/EN; every reported aggregate reconciles to its permitted contributing records before release. |

Usability targets are product decision thresholds, not statistical population claims. Performance, recovery, accessibility, and operational targets are specified separately in the safety plan and must be measured on declared hardware.

## 5. Users defined by the work they need to do

| Segment | Job and current friction |
| --- | --- |
| Small sales teams with several offerings | Run different selling processes while preserving one customer history; separate spreadsheets and copied boards fragment that history. |
| Sales managers and administrators | Control who can see and change opportunities, inspect blockers, and manage templates without accidentally granting company-wide access. |
| Enterprise account teams | Coordinate buying committees, procurement, qualification evidence, tenders, and several opportunities within the same customer company. |
| Customer-success and recurring-revenue teams | Hand over a won opportunity, coordinate onboarding, and manage renewal/expansion without altering the original sales outcome. |
| Partner managers | Register and assign partner opportunities, resolve duplicates, and share only the agreed records. External partner access requires a qualified isolation boundary. |
| Self-hosted maintainers | Upgrade an installation with existing data and integrations, diagnose failure, and recover using documented, tested procedures. |

## 6. Value propositions and investment choices

| Need | Intended improvement | Preservation constraint |
| --- | --- | --- |
| Different processes | Configurable pipelines, versioned templates, stage rules, and optional qualification panels. | Existing pipelines stay editable and keep their IDs and meaning. |
| Useful collaboration | Clear pipeline access, saved views, task queues, and account roles. | A shared view never grants access to its underlying records. |
| Better decisions | Defined conversion, aging, movement, and forecast measures with record drill-down. | New event-exact metrics coexist with labeled legacy inference until users explicitly switch. |
| Regional usability | Farsi-first composition, German review, Iranian civil-date handling, and exact monetary display. | Changing locale cannot change amounts, stored dates, user text, or execution timezone. |
| Maintainable extensibility | Stable typed commands/events and reviewed template/provider adapters. | Reuse approved engines; no arbitrary code execution or unrestricted plugin runtime in this programme. |

Relative investment is highest in preservation, contextual localization, explainable workflows, and self-hosted operation. Match established CRM expectations for pipeline/view management. Defer opaque AI scoring, public marketplace operation, general project management, full ERP, and automatic financial posting. This is an investment choice, not a measured competitor ranking.

## 7. Proposed solution

The project-level specification and acceptance criteria are in [PROJECTS.md](PROJECTS.md). The programme deliberately separates eight process-model families from six complementary selling/qualification approaches.

| Model family | Representation |
| --- | --- |
| AIDA marketing funnel | Defined acquisition cohorts, events, and conversion reporting. |
| Opportunity pipeline | Deals progressing through configurable stages, including explicit won/lost outcomes. |
| Account-based selling | Customer companies, buying groups, role-based stakeholders, and related opportunities. |
| Product-led selling | Consented first-party product signals and explainable product-qualified opportunity rules. |
| Bowtie lifecycle | Linked acquisition, onboarding, adoption, renewal, and expansion records. |
| Flywheel | Customer experience, advocacy, referrals, and repeat acquisition, supported by measured events. |
| Partner/channel selling | Internal registration, approval, ownership, attribution, and later controlled external access. |
| Tender/RFP | Bid qualification, deadlines, response ownership, approvals, evidence, submission, and outcome. |

BANT, MEDDPICC, SPICED, SPIN, Challenger, and Sandler become optional structured guidance, questions, and evidence rather than mandatory pipeline stages. Validate framework naming, attribution, and template redistribution terms before shipping authored content; the roadmap does not authorize copying training courses.

**R1 P0:** reconciled baseline and migration history; pipeline lifecycle/sharing; saved-view compatibility; safe basic template installation; preservation, localization, security, and release gates. **P1:** advanced templates/rules, qualification, account teams, qualified automation integration, analytics, and selected post-sale/tender motions. **P2 or separately gated:** partner portal, product telemetry, advanced attribution, and independent workspaces. P0/P1/P2 are this proposal's priorities; they do not override the separate approved IG or WF release plans.

The existing shell remains. Place pipeline-specific Insights beside Board/List only when its handlers and permission-aware metrics are qualified. Keep template installation, active template version, unsaved edits, and activation visibly distinct. Use current dialogs/drawers for focused changes; full-page editors are reserved for complex administration.

| Assumption | Validation method | Owner |
| --- | --- | --- |
| Users can distinguish pipelines from views and workspaces. | UX-01 concept sorting and timed navigation study. | Design/research. |
| The current scope model can safely support incremental pipeline roles. | Permission truth table, shadow comparison, downgrade/race testing, then architecture review. | Engineering/security. |
| Templates shorten setup without forcing a sales methodology. | Compare blank, duplicate, and template creation; inspect subsequent edits. | Product/design. |
| Existing WF/IG engines can support the requested motions. | Versioned capability inventory and one vertical integration slice per effect type. | Engineering and the existing project owners. |
| Multiple independent workspaces justify their migration cost. | Interviews with multi-company operators, deployment alternatives, and isolation spike. | Ali/architecture. |
| Product-led and marketing signals are available and usable. | Identify an actual permitted source, data owner, consent/suppression behavior, and ingestion contract. | Product/integrations. |

## 8. Releases and scope boundaries

| Release | Intended outcome | Gate |
| --- | --- | --- |
| R0: preserve and converge | Exact current baseline, safe integration lineage, research plan and prototypes. | G0/G1. |
| R1: multiple processes in one workspace | Pipeline management/sharing, saved views, basic versioned template install. | G2/G3/G4 and R1 journeys. |
| R2: repeatable team selling | Qualification, account teams, shared next-action work and only qualified automation effects. | Existing WF/IG prerequisites plus G2–G5. |
| R3: explainable revenue insight | Event-defined progression, reconciled analytics and scenario forecasts. | Historic-data disclosure, metric parity/drill-down, G2–G5. |
| R4: selected advanced motions | Independently pilot Bowtie, tender, internal partner, product-led, and marketing work. | Each project's source, UX, authorization, and adoption gates. |
| R5: independent workspaces | Safely join/switch/leave company-isolated workspaces. | Separate SP-14 design decision, full tenancy qualification, and restore rehearsal. |

R4 projects need not all ship, and R5 is not a condition for useful single-workspace releases. Project sizes are planning ranges that require capacity assignment; no calendar completion date is committed.

Google Calendar event-editor parity, Meet/Zoom/Teams conferencing, SMS/PBX/accounting provider qualification, public plugins, and broad MCP/app expansion remain with their existing or future plans. This programme consumes their reviewed capabilities and specifies graceful unavailability; it does not silently declare them complete or expand external-access authorization.

R1 succeeds only when KR-01, KR-02, and KR-04 meet their stated thresholds, no open critical accessibility/security/data issue remains, and a maintainer can execute the documented recovery procedure on the qualified installation shape. R2 additionally evaluates KR-03. Record an explicit evidence ceiling: source review, local tests, integrated runtime, provider qualification, pilot use, and production operation are different states.
