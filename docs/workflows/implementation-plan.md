# Visual workflows: implementation plan

Date: 31 October 2026. Status: approved for implementation; work has started. See [the status ledger](status.md) for current task evidence.

## Objective

Add a native, self-hosted visual automation builder to Warpdrive. Users should be able to automate CRM work, understand what each automation will do, test it safely, publish a stable version, and inspect or stop its executions. Farsi, German, and English are supported from the first usable release. Iranian calendar scheduling is part of the scheduling model.

This is the approved execution backlog, not a statement that all features already exist. The user gave implementation approval on 31 October 2026 and requested repository-wide documentation updates alongside the work. Implementation uses an isolated branch from current fork main and preserves the separate authentication checkout.

## Source baseline and reuse

Read-only inspection: `/tmp/warpdrive-better-auth-20261031`, branch `codex/better-auth`, base commit `01dd1dda4e4a6944f4bb46c7a504d6848a9ccae2`, with substantial in-progress changes owned by the main conversation. This identifies the inspected source snapshot; it is not a fresh remote synchronization claim. Recheck the selected implementation branch, remote head, active work, and ownership before any later implementation.

Verified source foundations:

- Next.js/React, Bun, TypeScript, PostgreSQL/Drizzle, tRPC, Zod, Zustand, next-intl, and Radix-based controls are already declared.
- `src/server/worker.ts` registers pg-boss jobs for email, import, reminders, notifications, and other maintenance. Extend this worker model rather than introducing another queue service by default.
- `src/features/deals/dealMove.ts` and `dealActions.ts` implement permission-checked CRM mutations and transactional board events. Workflow action handlers should reuse the service boundaries.
- `src/server/notify.ts` uses PostgreSQL NOTIFY and channel versions for real-time UI updates. Notifications are not a durable workflow event journal. Add a transactionally persisted event/outbox record at the mutation boundary.
- `src/features/email/outbox.ts` already has stable send identities and reconciliation for ambiguous provider outcomes. Preserve this behavior when calling it from workflow actions.
- `src/constants/permissionFlags.ts` defines current capabilities. Workflow capabilities and execution identity require an explicit addition and migration; they are not present by assumption.
- `src/features/i18n/registry.ts`, account preferences, calendar and temporal helpers provide locale, direction, numbering, calendar, and timezone foundations. Calendar display helpers do not establish a recurrence engine.
- `docs/auth-ui-design.md` records the current design approach. Keep the existing shell, theme tokens, local typefaces, density, and components.
- `docs/google-calendar-event-workflow.md` is a separate comprehensive calendar specification. Refer to it for future calendar actions; do not silently implement that entire project as part of the workflow builder.

## Product boundaries and releases

### R1: first complete production candidate

Workflow library; visual editor; typed data mapping; manual and CRM record triggers; search/create/update CRM actions; conditions and branches; durable duration/date delays; local notifications; controlled email actions; drafts and immutable published versions; test mode; run history and step inspection; cancellation; granular permissions; Farsi/German/English; operational limits and recovery documentation.

Three acceptance workflows: deal-stage follow-up, lead assignment, and overdue-activity escalation. Each must have a successful run, a permission-denied run, a failed action, and an interruption/recovery example. Email testing uses a disposable mailbox or simulated provider; publishing does not authorize real customer mail.

R1 examples use supported CRM change events and persisted waits. Overdue escalation starts when a dated activity is created or rescheduled, waits until its due instant, then rereads completion/date/ownership before notifying; edits invalidate stale waits. Lead assignment must use an explicit authorized routing rule. Round-robin and business-day follow-up require their own concurrency/business-calendar semantics before those template variants are offered. Recurring sweeps belong to R2.

### R2: scheduling and external integrations

Calendar-aware recurring schedules and business-day rules; signed incoming webhooks; restricted outgoing HTTP actions; connection management; rate limits; provider adapters; calendar actions against supported calendar services. Iranian monthly recurrence is implemented and tested here before it is advertised.

### R3: advanced composition and extensibility

Approvals and input forms; bounded iterators; explicit parallel branches and joins; sub-workflows; versioned template import/export; extension contribution contract; conferencing actions where provider prerequisites are met. Arbitrary user code and AI-generated actions are separate proposals requiring isolation, budgets, and authorization controls.

## Architecture decisions proposed for implementation

1. **Editor:** React Flow with custom Warpdrive nodes; compare fit and confirm its license and supported release before adding it. Use top-to-bottom flow as the default; keep an accessible ordered-step representation.
2. **Definition:** a server-validated, versioned graph document. Semantic node IDs, action versions, variable paths, and branch ports are independent from translated labels and canvas layout.
3. **Registry:** each trigger/action declares stable type/version, localized label keys, configuration schema, input/output schema, permission needs, side-effect class, retry policy, and server handler. Never execute client-supplied function names or code.
4. **Execution:** persistent state machine on PostgreSQL, dispatched by pg-boss under Bun. Queue jobs identify durable work; business state remains in application tables. No browser or request process owns a long-lived run.
5. **Events:** CRM mutation and durable event insertion commit together. Events include stable ID/type/schema version, actor, entity references, changed fields, timestamp, and causation chain. Store only the event snapshot necessary for semantics and access control.
6. **Versions:** publishing validates and freezes the definition plus action versions. A run pins one published version; editing or republishing does not mutate existing runs. Store drafts with revision checks to prevent silent overwrites.
7. **Authority:** initial manual runs use the initiating user. Automatic runs use an explicitly configured owner with the intersection of current permissions and approved workflow scope. Disable or pause when that owner is inactive or the connection is revoked. A dedicated service identity is a separate design decision, not an implicit admin bypass.
8. **External effects:** stable per-run/node/iteration effect keys; reuse existing email outbox/reconciliation; use provider idempotency where available. Unknown external outcomes enter reconciliation or needs-review rather than unconditional retry. Do not promise universal exactly-once delivery.
9. **Time:** preserve instants, date-only values, durations, and calendar periods as different types. Persist schedule calendar, IANA timezone, recurrence, business calendar, invalid-date policy, and missed-run policy. Show next occurrences before publication.
10. **Operations:** no new mandatory Redis or hosted service for R1. Test actual Bun compatibility and multi-worker behavior; source compatibility alone is insufficient.

Proposed storage: `workflows`, `workflow_versions`, `workflow_triggers`, `workflow_events`, `workflow_event_deliveries`, `workflow_runs`, `workflow_step_runs`, `workflow_step_attempts`, and `workflow_effects`; later `workflow_schedules`, `workflow_waits`, `workflow_approvals`, and connection-reference metadata. Exact naming, foreign keys, indexes, encryption, retention, and deployment scope are settled before migrations.

## Ordered tasks

Task state and verification are maintained in [status.md](status.md). Dependencies are task IDs. Each task should become a bounded change with its own acceptance evidence. Suggested ownership names describe responsibility, not an assignment to active agents.

Planning progress: initial local inventory for WF-001 is recorded above; branch/remote reconciliation remains for implementation. WF-002 is complete for this research pass: ten Mobbin flow references, visual observations, and task mappings are recorded in the UX document. WF-003/WF-004 have draft scope, vocabulary, journeys, and a 14-surface inventory. WF-005 prototypes are not started; WF-006 decisions are proposed and need finalization before the engine is built. The subsequent user green light authorizes implementation; task completion still requires its acceptance evidence.

### A. Product and design specification

| ID     | Owner / task                                | Deliverable and acceptance criteria                                                                                                                                                        | Depends on     |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| WF-001 | Product: inventory current architecture     | Record actual checkout, services, action boundaries, permission model, event gaps, and existing theme. Reconcile main-thread changes before coding.                                        | None           |
| WF-002 | Design: research Mobbin                     | Inspect relevant screens and complete captured flows. Record exact links, what was visibly observed, what remains unverified, and how each reference maps to Warpdrive.                    | WF-001         |
| WF-003 | Product: define R1 workflows and vocabulary | Specify the three acceptance workflows, supported objects/fields/actions, naming, business rules, and explicit later scope. Draft natural Farsi and German terminology.                    | WF-001         |
| WF-004 | Design: screen and state inventory          | Specify library, editor, step picker, configuration, variables, test, publish, runs, errors, connections, and permissions. Include empty/loading/denied/conflict/unsaved states.           | WF-002, WF-003 |
| WF-005 | Design: prototype against existing shell    | Produce linked desktop Farsi/German prototypes and narrow-screen behavior using real-length synthetic content. Review contrast, density, focus, and state hierarchy before implementation. | WF-004         |
| WF-006 | Architecture: decide semantic contract      | Freeze execution identity, trigger snapshot semantics, graph restrictions, branch behavior, cancellation, retries, test side effects, and version rules in decision records.               | WF-003         |

### B. Durable execution foundation

| ID     | Owner / task                                     | Deliverable and acceptance criteria                                                                                                                                                                                                                                             | Depends on                     |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| WF-007 | Backend: graph and action registry schemas       | Validate stable IDs, config, typed inputs/outputs, bounded graph size, one entry trigger, valid ports, reachability, and allowed action versions. Reject cycles in R1 and references unavailable on the current branch.                                                         | WF-006                         |
| WF-008 | Backend: persistence and migrations              | Add definitions, versions, events, runs, steps, attempts, effects, unique constraints, and indexes. Test upgrade/rollback procedure on a disposable database; include retention and sensitive-field rules.                                                                      | WF-007                         |
| WF-009 | Security: workflow capability and identity model | Add view/create/edit/publish/run/cancel/manage-connection permissions with owner/visibility checks. Define event-payload and historical-data access, including loss of access after the trigger. Test escalation attempts, inactive owners, revoked rights, and hidden records. | WF-006, WF-008                 |
| WF-010 | Backend: draft and publish services              | Implement revision-checked draft save, validation, atomic publication, deactivation, archive, duplication, and restore-as-draft. Concurrent saves conflict visibly; existing runs keep their pinned definition.                                                                 | WF-007, WF-008, WF-009         |
| WF-011 | Backend: transactional CRM event outbox          | Emit only committed create/update/stage-transition events from the canonical mutation services. Include field diffs and causation metadata; process imports and API writes through the same contract. Test rollback and worker outage.                                          | WF-008, WF-009                 |
| WF-012 | Backend: run admission and trigger dispatch      | Match active workflow/version and trigger filters; deduplicate event/workflow delivery; create run plus first ready step atomically. Respect quotas, causation depth, and event schema versions.                                                                                | WF-010, WF-011                 |
| WF-013 | Runtime: resumable step state machine            | Implement queued/running/waiting/succeeded/failed/cancelled/needs-review transitions, worker claims/leases, bounded attempts, and queue re-dispatch reconciliation. Prove restart and competing-worker recovery.                                                                | WF-007, WF-008, WF-012         |
| WF-014 | Runtime: durable effect and retry protocol       | Distinguish retryable/terminal/ambiguous errors; stable effect keys survive attempts; DB-only effects commit with progress where possible. Test crash before/after provider acceptance and prevent blind email replay.                                                          | WF-013                         |
| WF-015 | Runtime: first end-to-end vertical slice         | Manual run reads a visible deal and creates one follow-up activity. Prove success, invalid input, denied record, duplicate job delivery, crash recovery, and auditable actor attribution under Bun.                                                                             | WF-009, WF-010, WF-013, WF-014 |

### C. First usable editor and CRM automations

| ID     | Owner / task                                      | Deliverable and acceptance criteria                                                                                                                                                                                                                  | Depends on                             |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| WF-016 | Frontend: workflow library and routes             | Search/filter library, draft/active/error status, ownership, templates entry, create/duplicate/archive actions, visibility-aware empty states, and navigation. Use existing shell/components.                                                        | WF-005, WF-010                         |
| WF-017 | Frontend: visual canvas                           | Custom nodes, named branches, insert-between control, pan/zoom/fit, selection, undo/redo, auto-layout, save status, and ordered-step alternative. Structural edits use WF-007 rules.                                                                 | WF-005, WF-007, WF-016                 |
| WF-018 | Frontend: trigger/action picker                   | Searchable categories with descriptions, compatible input context, provider readiness, permission reasons, and clear supported/unavailable distinctions. Selecting an action opens its configuration.                                                | WF-007, WF-009, WF-017                 |
| WF-019 | Full stack: schema-driven step configuration      | Render settings from registry plus CRM metadata, including required/custom fields, nullable values, references, and localized errors. Frontend and backend validate the same contract.                                                               | WF-007, WF-018                         |
| WF-020 | Full stack: typed variable mapping                | Browse only available upstream outputs; show human-readable source chips, previews, missing/null handling, type checks, date types, and invalidated references after editing/deleting a predecessor.                                                 | WF-019                                 |
| WF-021 | Backend: CRM action pack                          | Search/read/create/update contacts, deals, and activities through shared permission-checked services; add local notification. Bound search results and define concurrent-update semantics.                                                           | WF-015, WF-020                         |
| WF-022 | Full stack: filters and conditional branches      | Type-aware AND/OR groups, explicit default path, readable summaries, null/empty handling, and deterministic branch selection. R1 exclusive branches do not imply parallel joins.                                                                     | WF-007, WF-013, WF-020                 |
| WF-023 | Full stack: persistent delay                      | Duration and absolute-date delays save resume state without holding a worker. Show waiting state/due time. Cancellation, time changes, expired waits, and restart recovery are tested.                                                               | WF-013, WF-022                         |
| WF-024 | Full stack: controlled email actions              | Draft and send through authorized connected mailbox using existing outbox/reconciliation. Preview recipient/body, validate mapped recipients, enforce ownership and rate limits, and simulate mail by default during testing.                        | WF-014, WF-020, WF-021                 |
| WF-025 | Full stack: test runner                           | Select synthetic/sample trigger data or an authorized CRM record, validate graph, simulate effects, and inspect per-step results. Live test is an explicit separate action with an effect summary and authorization.                                 | WF-017, WF-021, WF-022, WF-023, WF-024 |
| WF-026 | Frontend: validation and publication review       | Summarize trigger, execution identity, effects, permissions, connections, missing mappings, and version changes. Offer Test and Publish with clear validation; a draft save never activates automation.                                              | WF-010, WF-025                         |
| WF-027 | Full stack: run list and step inspector           | Filter runs; inspect pinned graph, redacted inputs/outputs, step attempts, errors, waiting time, and causation. Stream progress through existing real-time layer; server access checks govern every read.                                            | WF-013, WF-017, WF-025                 |
| WF-028 | Full stack: cancel, retry, and operational alerts | Cooperative cancellation checked before claiming/effects; distinguish completed effects. Retry eligible failed steps without replaying completed ones; full rerun creates a new execution with effect review. Alert on repeated failures/stuck work. | WF-014, WF-027                         |
| WF-029 | Content/QA: release the three R1 templates        | Implement and document deal follow-up, lead assignment, and overdue escalation with synthetic fixtures. Every template has valid defaults, access requirements, meaningful translations, and safe test data.                                         | WF-021 through WF-028                  |

### D. Scheduling and integrations

| ID     | Owner / task                                         | Deliverable and acceptance criteria                                                                                                                                                                                                                                                               | Depends on                                  |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| WF-030 | Temporal: calendar-aware scheduler                   | Persist calendar/timezone/recurrence plus next due occurrence; preview next five dates in chosen display calendar. Test Iranian month ends/leap transitions, Berlin DST gaps/overlaps, date-only values, and missed-run policies. No monthly Iranian rule is represented as plain Gregorian cron. | WF-023, WF-026                              |
| WF-031 | Temporal: business calendars                         | Configurable workweek, local business hours, explicitly maintained holiday sources/overrides, business-day delays, and schedule migration policy. Show resolved next dates and policy when calendar data is missing.                                                                              | WF-030                                      |
| WF-032 | Integrations: incoming webhook trigger               | Per-workflow secret reference, signature verification with timestamp/replay protection where applicable, request schema validation, rate/payload limits, durable enqueue, deduplication, and secret rotation. Unsigned-provider support requires explicit policy.                                 | WF-012, WF-014, WF-026                      |
| WF-033 | Integrations: outgoing HTTP and connections          | Server-side encrypted secret references, approved origins, DNS/IP and redirect checks against internal/metadata destinations, timeouts/size limits, redacted logs, OAuth lifecycle, throttling, and provider idempotency.                                                                         | WF-009, WF-014, WF-019                      |
| WF-034 | Integrations: calendar and conferencing action packs | Reuse provider adapters; separate CRM activity creation, remote event creation, and meeting provisioning. Implement provider capability/consent checks and reconciliation; link to existing calendar specification. Validate Google/Zoom/Teams separately before claiming support.                | WF-030, WF-033; calendar/provider readiness |

### E. Advanced composition and open source extensions

| ID     | Owner / task                                        | Deliverable and acceptance criteria                                                                                                                                                                                                                     | Depends on             |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| WF-035 | Full stack: approvals and forms                     | Persistent approval/input wait, authorized approvers, expiry/escalation, one winning response, cancellation, and audit trail. Resume rechecks access and validates response schema.                                                                     | WF-023, WF-027, WF-028 |
| WF-036 | Runtime: bounded iterators and parallel composition | Explicit iteration IDs and limits; define ordered/concurrent execution, error paths, joins, cancellation propagation, and output aggregation. Test partial completion and recovery without duplicated effects.                                          | WF-007, WF-014, WF-028 |
| WF-037 | Runtime: sub-workflows and reusable templates       | Typed arguments/results, pinned called versions, recursion/depth quotas, causation tracing, import validation, template migration, and secret-free export.                                                                                              | WF-010, WF-020, WF-036 |
| WF-038 | OSS: extension contribution contract                | Document trigger/action manifest, input/output schemas, localization, permission declarations, compatibility/versioning, test harness, provider setup, and license review. Distributed extensions do not gain implicit code execution or secret access. | WF-007, WF-033, WF-037 |

### F. Cross-cutting release gates

These start with their dependent work and are not deferred until the end.

| ID     | Owner / task                                  | Deliverable and acceptance criteria                                                                                                                                                                                                                                                                                | Depends on                                     |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| WF-039 | Localization: Farsi/German/English throughout | Localize routes' visible content, nodes, forms, errors, accessibility text, templates, timestamps, and status. Review natural terminology and German expansion; preserve user names. Use stable language-neutral IDs and LTR isolation for expressions, URLs, and IDs.                                             | WF-003; every UI task                          |
| WF-040 | Accessibility/design QA                       | Keyboard creation/editing without drag-only controls, ordered-step representation, focus restoration, screen-reader status, non-color error/status cues, light/dark themes, reduced motion, narrow layouts, and large-graph performance. Review rendered Farsi/German screens against existing shell.              | WF-005; every UI task                          |
| WF-041 | Security/reliability/operations qualification | Real PostgreSQL tests for transactions, races, retries, leasing, revocation, timers, event duplication, and retention; provider contract tests; Bun worker startup/build; resource limits, queue lag, stuck-run detection, logs redaction, backup/restore, staged rollout, kill switch, and recovery instructions. | Each backend milestone                         |
| WF-042 | Release/handoff                               | Rebase/reconcile selected branch with current user fork without replacing custom UI; review migrations and licenses; run scoped then full required CI, build/install/startup checks, and demonstrate acceptance workflows. Record exact revision and source/local/provider/production evidence separately.         | Relevant release tasks, WF-039, WF-040, WF-041 |

## Milestone exits

- **Design ready:** WF-001–006; linked reference dossier; screen/state inventory; prototype review complete. Coding has not begun at this boundary.
- **Engine proven:** WF-007–015; real restart/concurrency/permission evidence for the manual vertical slice.
- **R1 candidate:** WF-016–029 plus applicable WF-039–042; three complete automations and the whole author/test/publish/inspect/recover journey.
- **R2 candidate:** WF-030–034 plus release gates; actual provider consent/delivery tests are recorded separately from mocked contracts.
- **R3 candidate:** WF-035–038 plus release gates; explicit bounded composition and extension compatibility proof.

Proposed change boundaries: semantic contract and schema; engine and event outbox; initial vertical slice; library/canvas; configuration/mapping; conditions/delays; email; test/publish; run recovery; localization/QA; then separate scheduler, webhook, HTTP, provider, and advanced-composition changes. Avoid one unreviewable feature branch containing all releases.

## UX journeys and reference work

See [ux-design-reference.md](ux-design-reference.md) for research results and the resulting interaction specification. Mobbin references are design observations; they do not establish backend capabilities. Third-party assets should not be bundled with Warpdrive.

## External primary sources

- [Twenty workflow overview](https://docs.twenty.com/user-guide/workflows/overview)
- [Twenty workflow actions](https://docs.twenty.com/user-guide/workflows/capabilities/workflow-actions)
- [Twenty workflow versions](https://docs.twenty.com/user-guide/workflows/capabilities/workflow-versions)
- [Twenty workflow run inspection](https://docs.twenty.com/user-guide/workflows/capabilities/workflow-runs)
- [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes)
- [pg-boss persistence, retries, scheduling, and transaction model](https://pgboss.io/introduction)

These sources were reviewed during the preceding architectural exploration. Confirm current versions, compatibility, and license terms at WF-001/WF-007 before dependency changes.
