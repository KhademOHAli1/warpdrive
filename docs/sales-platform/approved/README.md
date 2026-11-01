# Warpdrive sales platform roadmap

Prepared for Ali on **31 October 2026**, Europe/Berlin. **Status: planning proposal for review.** Creating this package does not start implementation, change existing approvals, or certify production readiness.

This programme extends the working CRM into a configurable sales-process platform. It covers multiple pipelines and teams, sharing, saved views, qualification methods, account selling, automation, analytics, post-sale revenue, partner sales, tenders, product-led sales, marketing funnels, and a separately gated multi-workspace architecture. Existing UI, records, authentication, integrations, and regional behavior remain the starting point.

## Read this package

| Document | Purpose |
| --- | --- |
| [Product brief](PRD-Warpdrive-Sales-Process-Platform.md) | Problems, intended users, measurable outcomes, scope, assumptions, and release boundaries. |
| [Project roadmap](PROJECTS.md) | Sixteen projects with outcomes, delivery approach, dependencies, and 128 individually identifiable tasks. |
| [Task register](TASKS.csv) | The same 128 tasks in an importable CSV with ownership, dependencies, acceptance criteria, research references, and planned status. |
| [UX research programme](UX-RESEARCH.md) | Twenty research studies, exact Mobbin references where verified, recruiting, prototype states, usability protocols, and design acceptance. |
| [Integration and preservation plan](INTEGRATION-SAFETY.md) | Architecture boundaries, migration strategy, permission matrix, test scenarios, performance targets, releases, rollback, and recovery. |
| [Sources and decision register](SOURCES-AND-DECISIONS.md) | Observed baseline, existing plans to reuse, evidence limitations, source links, and decisions to settle before dependent implementation. |

The CSV and project tables are two presentations of one task set. If either changes later, regenerate the other and validate identifiers and dependencies. Task IDs use `SP-project.task`; existing `WF-*` and `IG-*` work remains owned by its existing plan.

## Recommended delivery order

1. **Foundation:** SP-00, SP-01, and the initial SP-15 quality work. Reconcile working branches and migration history, preserve the current UI baseline, and test the product vocabulary with users.
2. **First product release:** SP-02, SP-03, and the core of SP-04. Deliver understandable multi-pipeline management, sharing, saved views, and safe template installation within the current single workspace.
3. **Sales execution:** SP-05, SP-06, and the qualified parts of SP-07. Add qualification, account buying groups, and follow-up through the existing workflow and communication systems.
4. **Revenue insight:** SP-08. Extend the existing analytics proposal and calculations with explicit event history, reconciled movement, and explainable forecasting.
5. **Select advanced motions from research:** SP-09 through SP-13. Each has its own evidence and adoption gate; none is required just to improve the current board.
6. **Independent workspaces:** research SP-14 early, implement its tenancy migration only after a separate architecture decision and isolation rehearsal. External partner access waits for this boundary and its qualification.
7. **Every release:** apply SP-15 gates, controlled enablement, monitoring, and a usable rollback or forward-recovery path.

## Preservation commitments

- Extend existing features before introducing replacements. No new authentication authority, mail sender, generic workflow engine, currency engine, or calendar implementation.
- Keep the existing sidebar, fonts, theme tokens, component adapters, and established record pages. Prototype changes inside the actual current shell.
- Keep stable record IDs, raw user data, custom names, historic audit values, saved filters, API behavior, and links through additive compatibility layers.
- Introduce no automatic historical message sending, mass stage changes, permission broadening, or marketing enrolment.
- Distinguish a workspace from a customer company, a team from an access group, a pipeline from a saved view, and a funnel chart from a working board.
- Farsi is the first design-review language, German the second, and English remains supported. Calendar, timezone, country, currency, and display unit remain independent choices.

No engineering plan can promise zero defects. This roadmap makes preservation testable and defines how to stop, diagnose, and recover when a gate fails.

## First reviewable increment

Complete the baseline and migration reconciliation report; produce current-shell prototypes for creating a pipeline, sharing it, choosing a template, saving a view, and explaining a blocked stage move. Review them in Farsi and German. Deliver a release plan with exact compatibility evidence before beginning the first production rollout.

No application code, running services, repository branches, or existing planning files were changed to prepare this package.
