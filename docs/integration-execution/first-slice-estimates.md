# BASE-012: first delivery slice estimates

Review date: 2026-10-31. Estimation input: integration source head `2f6098b13455fc241389df48b4d4a17f1eed77a7`, the 70 CONN/EVT/SLK tasks in `docs/integration-platform-tasks.csv`, and the BASE branch/UI, queue/event and authorization audits in this folder. These are planning ranges, not implementation completion or fresh runtime evidence.

## Capacity and scope assumptions

One active implementation owner works on one vertical slice. Estimates are focused person-hours, including test-first implementation, relevant real-PostgreSQL/concurrency/provider-fixture tests, code review and corrections, natural FA/DE/EN copy, applicable Iranian/Gregorian/timezone cases, keyboard/mobile checks, and finite operator/evidence updates. One planning day is six focused hours; elapsed throughput depends on review and peer handoffs. No dates or staffing commitment are inferred. Agent/tool wall time is not interchangeable with these engineering effort units.

The ranges assume BASE reconciliation/service qualification and ARCH-001 through ARCH-007 contracts have closed, Bun 1.4.4/frozen dependencies are available, and shared QA fixtures are reusable. They exclude BASE/ARCH/QA/OPS package work and unrelated AI/calendar/provider tracks; those have their own task evidence. Each row contains its attributable feature checks. Milestone-wide acceptance/build and operational drills should run once on the integrated head, with results reused where they actually satisfy more than one criterion rather than duplicated mechanically.

Existing Slack OAuth, encrypted credentials, joined-channel selection and the completed Connections UI are preserved and adapted. Existing code lowers extraction cost but does not close the broader CONN acceptance. The shared runtime remains pg-boss. Adopt the reviewed workflow cut `b8f25a4` for immutable definitions, manual admission, durable cursors, transactional DB steps, actor rehydration and recovery polling. Do not rebuild those facilities or include the workflow peer's dirty condition/editor work implicitly. CRM trigger/outbox and external delivery intent remain new work.

The independent mail peer at `/Users/ali/Developer/warpdrive-integrations` owns active mailbox, `src/features/connections/`, credentials, SMTP/IMAP, lifecycle and offboarding changes. Initial work defines shared identities, capability/lifecycle DTOs and adapter interfaces around those boundaries. Do not overwrite or independently duplicate that working tree. CONN row estimates are programme effort to implement or adopt and qualify the chosen contract, not an instruction to redo peer implementation. Re-estimate against a reviewable immutable mail handoff before changing shared schema/connection storage. Compatibility adapters can be isolated on this branch meanwhile; they do not prove peer adoption.

Confidence is medium for source inventory, renderers and existing-UI extraction, low to medium for shared ownership/migrations, and low for refresh concurrency, temporal scheduling and ambiguous external outcomes. Upper ranges cover expected design/test corrections, not unbounded provider or peer waiting.

## First execution cut and widening path

1. **Contract and durable stage-change spine**: CONN-001/002/023, EVT-001/002/003/004 and SLK-001/002/006. Task-row effort is **100-188 hours**. Begin with shared contracts/fake provider, then a durable event in the deal stage-change transaction, restart-safe dispatch and escaped link-only rendering. Preserve board NOTIFY. First red tests cover rollback, CAS/no-op moves, lost enqueue, duplicate workers and untrusted fields. A stage-change implementation is partial evidence where a task's acceptance also covers other mutation types; it must not close the whole task prematurely.
2. **First end-to-end local deal demonstration**: widen to the 50 selected rows listed below, **592-1136 hours total including cut 1**, before reusable package-wide completion. This deliberately includes connection authorization, resource policy, durable deliveries, preview/rules, fake sends, unknown outcomes, failure visibility and worker-restart evidence. Most estimates are for complete row acceptance; the first stage-change screen/demo can arrive earlier while remaining subcases stay open. It is not the complete R1 exit because activity scheduling and the remaining lifecycle/operational acceptance still have to close.
3. **Full CONN/EVT/Slack local acceptance**: all 69 local rows, **868-1676 hours**, including API-key/custom handshakes, key/refresh rotation, activity timing, finite replay and operator docs. This is a coarse programme envelope, not the next batch's workload. Re-estimate after cut 1 and after the first complete local delivery/restart drill.

The task register's package dependencies are local-foundation contracts. These cuts refine engineering order without changing task IDs or claiming that unrelated live-provider/publication approvals block local work. A first demonstration never waives later row acceptance or applicable cross-cutting gates.

Selected local-deal-demo rows:

`CONN-001, CONN-002, CONN-003, CONN-004, CONN-005, CONN-006, CONN-007, CONN-010, CONN-013, CONN-014, CONN-016, CONN-017, CONN-018, CONN-020, CONN-021, CONN-022, CONN-023, EVT-001, EVT-002, EVT-003, EVT-004, EVT-006, EVT-007, EVT-008, EVT-009, EVT-010, EVT-012, EVT-013, EVT-014, EVT-015, EVT-018, EVT-020, SLK-001, SLK-002, SLK-003, SLK-005, SLK-006, SLK-007, SLK-008, SLK-009, SLK-011, SLK-012, SLK-013, SLK-014, SLK-015, SLK-016, SLK-017, SLK-018, SLK-020, SLK-021`

## Per-task remaining effort

Ranges apply to the complete recorded acceptance, including tasks whose first mutation/provider example is narrower. Totals are additive rough-order estimates, not a promised schedule. Shared implementation reuse is already assumed. The task register remains authoritative for status and acceptance; this document changes neither.

### CONN

26 tasks, 318-612 focused hours across all stages.

| Task     | Title                                        | Hours | Sizing basis                                                                                   |
| -------- | -------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| CONN-001 | Inventory provider adapter seams             | 4-8   | Inventory existing Slack seams and peer shared-connection handoff; no rewrite.                 |
| CONN-002 | Define typed provider contracts              | 12-20 | Result/AbortSignal contracts and capability fixtures; align peer connection types.             |
| CONN-003 | Implement provider registry metadata         | 8-16  | Retain 21 catalog entries and assets; separate advertised and executable availability.         |
| CONN-004 | Migrate existing Slack connection records    | 12-24 | Forward/upgrade/recovery DB fixtures preserving Slack IDs/history; migration collision review. |
| CONN-005 | Model account identity and duplicates        | 12-24 | Stable account identity, duplicate and reconnect races; adapt peer-owned model.                |
| CONN-006 | Implement connection ownership enforcement   | 16-32 | Current actor plus personal/shared/delegated-use checks in requests and jobs.                  |
| CONN-007 | Implement resource selection policy          | 12-20 | Resource IDs, scope allowlist, stale selection and deletion contract cases.                    |
| CONN-008 | Implement guarded OAuth attempts             | 12-24 | Single-use state, intent/session binding, redirects and PKCE adapter cases.                    |
| CONN-009 | Implement atomic callback completion         | 12-24 | Concurrent callback, replay/cancel and failed transaction coverage.                            |
| CONN-010 | Implement safe credential storage            | 12-24 | Adopt existing encryption, key-ID metadata and DTO/log/job leakage checks.                     |
| CONN-011 | Implement concurrent token refresh           | 20-40 | Rotation-family and generation fencing with real-DB concurrent refresh cases.                  |
| CONN-012 | Implement credential key rotation            | 16-32 | Resumable re-encryption and failed-key/rollback operator drill.                                |
| CONN-013 | Implement health observations                | 8-16  | Separate attempt/success/error/retry observations and localized state DTOs.                    |
| CONN-014 | Classify provider failures                   | 8-16  | Typed failure taxonomy and deterministic status/response fixtures.                             |
| CONN-015 | Implement reauthorization workflow           | 16-28 | Reconnect identity and changed-scope consent with FA/DE/EN browser checks.                     |
| CONN-016 | Implement pause and resume                   | 8-16  | Pause/resume generation check and pending-work semantics with worker cases.                    |
| CONN-017 | Implement local block before revocation      | 8-16  | Preserve existing local-first revoke and test concurrent credential readers.                   |
| CONN-018 | Implement durable revocation retries         | 12-24 | Bounded sweep/retry, redacted failures and operator repair state.                              |
| CONN-019 | Implement ownership transfer and offboarding | 16-32 | Explicit shared retention/transfer policy and offboarding races; peer owns mail changes.       |
| CONN-020 | Implement per-connection audit events        | 8-16  | Redacted correlation and resource-level audit assertions.                                      |
| CONN-021 | Implement reusable connection actions        | 8-16  | Extract current CSRF/fresh-auth/input checks without changing existing UI.                     |
| CONN-022 | Implement common management UI               | 20-36 | Shared management adapters, natural three-language copy, keyboard/mobile review.               |
| CONN-023 | Provide a local fake-provider harness        | 16-28 | OAuth/refresh/paging/failure/revoke fixture harness for downstream reuse.                      |
| CONN-024 | Document provider authoring                  | 6-12  | Authoring example, capability fixture and walkthrough of actual contracts.                     |
| CONN-025 | Implement API-key credential workflows       | 16-28 | Masked API-key workflow and replacement/rotation tests; reserve implementation seam.           |
| CONN-026 | Implement custom provider handshakes         | 20-40 | Signed custom handshake, replay/expiry/identity fixtures and operator instructions.            |

### EVT

20 tasks, 282-544 focused hours across all stages.

| Task    | Title                                        | Hours | Sizing basis                                                                     |
| ------- | -------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| EVT-001 | Reconcile workflow and event implementations | 4-8   | Adopt committed workflow ownership, worker and event seams; no second engine.    |
| EVT-002 | Define the versioned event envelope          | 6-12  | Versioned minimal envelope, single-tenant context and invalid payload fixtures.  |
| EVT-003 | Emit events transactionally                  | 16-28 | Durable rows inside mutation transactions with rollback, CAS and upgrade cases.  |
| EVT-004 | Implement the event-to-queue dispatcher      | 20-40 | Recover lost nudges/acks and concurrent dispatch using pg-boss plus DB state.    |
| EVT-005 | Define supported event taxonomy              | 12-24 | Deal and activity timing definitions and domain behavior fixtures.               |
| EVT-006 | Implement delivery intent records            | 16-28 | Subscription/rule-version/destination identities with redacted delivery rows.    |
| EVT-007 | Implement deduplication keys                 | 16-32 | Database uniqueness and provider ambiguity scenarios under concurrency.          |
| EVT-008 | Implement retry and rate-limit policy        | 16-28 | Deterministic clocks, Retry-After, budget/jitter and bounded exhaustion cases.   |
| EVT-009 | Implement job cancellation                   | 12-24 | Rule/connection/resource invalidation and queued/running cancellation races.     |
| EVT-010 | Recheck permission at execution time         | 16-32 | Current actor, record, grant and destination evaluation before each effect.      |
| EVT-011 | Implement dead-letter inspection             | 16-28 | Permission-gated failure review/retry/discard with localized operator UI.        |
| EVT-012 | Define rule conditions and templates         | 12-24 | Reuse workflow typed bindings; allowlist rule operators/templates.               |
| EVT-013 | Implement rule draft and activation          | 12-24 | Immutable active versions, draft edits and authorization cases.                  |
| EVT-014 | Implement safe dry-run previews              | 12-24 | Deterministic match/denial explanations without queue/provider effects.          |
| EVT-015 | Implement rule administration UI             | 20-36 | Event/filter/destination management using current adapters in FA/DE/EN.          |
| EVT-016 | Implement time-based scheduling              | 24-48 | Persisted wakeups, reschedules, timezone/DST and obsolete reminder cancellation. |
| EVT-017 | Implement loop prevention and provenance     | 12-24 | Origin/provenance chain and bounded loop tests shared with workflow admissions.  |
| EVT-018 | Implement delivery observability             | 8-16  | Bounded correlation/queue-age metrics and payload redaction checks.              |
| EVT-019 | Implement bounded replay tooling             | 16-32 | Finite replay preview, explicit selection and existing dedup preservation.       |
| EVT-020 | Qualify worker restart recovery              | 16-32 | Worker/database outage and duplicate-effect recovery with operator evidence.     |

### SLK

24 tasks, 276-536 focused hours across all stages.

| Task    | Title                                                 | Hours | Sizing basis                                                                           |
| ------- | ----------------------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| SLK-001 | Define the notification event set                     | 4-8   | Exact deal/activity trigger timing and committed-versus-rolled-back examples.          |
| SLK-002 | Define Slack destination and data policy              | 6-12  | Link-only default, destination audience and field-disclosure scenarios.                |
| SLK-003 | Review current bot scopes                             | 4-8   | Check current official methods/scopes during implementation and lock contract fixture. |
| SLK-004 | Support Slack token rotation                          | 16-32 | Shared refresh lifecycle plus Slack token-family rotation/outage cases.                |
| SLK-005 | Implement channel resource refresh                    | 8-16  | Joined-public pagination, rename/membership/scope changes with stable IDs.             |
| SLK-006 | Implement the Slack message renderer                  | 12-24 | FA/DE/EN renderer, escaping, trusted CRM links and injection fixtures.                 |
| SLK-007 | Implement message preview                             | 12-24 | Exact destination/locale/field preview and accessible localized UI.                    |
| SLK-008 | Implement Slack notification rules                    | 16-28 | Versioned Slack rule binding and fresh admin authorization DB cases.                   |
| SLK-009 | Implement deal notifications                          | 16-28 | Creation, repeated moves/back moves and no-op update integration cases.                |
| SLK-010 | Implement activity notifications                      | 24-48 | Assignment/completion/overdue and reschedule/reassignment temporal cases.              |
| SLK-011 | Implement provider delivery                           | 12-24 | Bounded adapter request, rate limit and redacted response contract.                    |
| SLK-012 | Handle ambiguous send outcomes                        | 16-32 | Confirmed/failed/unknown outcomes and safe manual reconciliation path.                 |
| SLK-013 | Implement delivery history UI                         | 16-28 | Searchable delivery history/recovery, mobile/keyboard and FA/DE/EN checks.             |
| SLK-014 | Implement safe test messages                          | 8-16  | Explicit test preview and fake-provider-only local execution.                          |
| SLK-015 | Implement pause and rule removal                      | 8-16  | Pending-send cancellation on rule/connection pause/removal and retained audit.         |
| SLK-016 | Recheck authorization on every send                   | 12-24 | Actor/CRM/grant/destination revocation immediately before delivery.                    |
| SLK-017 | Protect shared-channel disclosure                     | 12-24 | Private-field leakage through payload, preview, error and cache adversarial fixtures.  |
| SLK-018 | Finish reconnect and revocation recovery              | 12-24 | Reconnect resets health; revoke failure remains blocked and repairable.                |
| SLK-019 | Polish Slack operator onboarding                      | 12-24 | Three-language setup, scopes/rotation and failure/recovery operator walkthrough.       |
| SLK-020 | Qualify retry and deduplication behavior              | 20-36 | 429/5xx, crash/restart, duplicate jobs and delayed responses in local harness.         |
| SLK-021 | Demonstrate the complete local workflow               | 12-24 | Synthetic deal create/move through preview, delivery and history evidence.             |
| SLK-022 | Prepare a finite live verification script             | 4-8   | Finite future live script with actions/counts/cleanup; resources remain unselected.    |
| SLK-023 | Validate the authorized Slack sandbox (live-provider) | 8-16  | Engineering execution/evidence only once actual sandbox and approval exist.            |
| SLK-024 | Publish the connector support record                  | 6-12  | Truthful local/live support matrix at exact head, with limitations and provenance.     |

## Unknowns and bounded investigation

- **Shared connection handoff**: compare the mail peer's committed schema/identity/lifecycle DTOs before CONN storage extraction. Use a bounded 4-8-hour source/fixture review within CONN-001; if no stable handoff is available, continue provider-independent event/rendering work and retain adoption as pending. Do not mark overlapping peer tasks complete on its status prose alone.
- **Migration sequencing**: preview and workflow both used 0083, while mail is editing a separate 0083-0088 series. BASE owns the initial combined migration. CONN-004 then tests the chosen forward/upgrade path and records irreversibility/rollback boundaries. Additional accepted peer schema changes can invalidate the present range.
- **Workflow event admission**: committed manual admission stores only a record trigger payload. A versioned event ID/subscription identity and permission semantics require review with the workflow owner before automatic admission. EVT-001/002 includes that design; EVT-004/007 must prove recovery/dedup with unique DB constraints, not singletonKey assumptions.
- **Execution authorization**: shared Slack is currently admin-managed; recorded owner and operator are different concepts. ARCH defines whose authority a delayed rule uses. CONN-006/019 and EVT-010 must test deactivation, group changes, destination disclosure and ownership transfer. A reusable CRM actor alone is not a connector grant.
- **Slack token rotation and provider behavior**: check current official Slack documentation and pinned adapter/library behavior during SLK-003/004. No scope, entitlement or live token family is assumed. Local fixtures close only local behavior; actual rotation/revoke/send stays SLK-023.
- **Ambiguous side effects**: determine available provider reconciliation/idempotency affordances before promising automatic retry. The minimum supported unknown state is blocked/reviewable, not blind replay. If the selected policy requires richer reconciliation, split a child spike under SLK-012 while leaving its parent open.
- **Temporal reminders**: current reminder enqueue is post-commit, update does not replace schedules, and stale jobs do not compare original due time. EVT-016/SLK-010 includes replacing those assumptions with durable reschedule/cancel semantics and Tehran/Berlin fixtures. Calendar display language remains independent of wire timestamps and numbering.
- **User journeys**: keep existing shadcn adapters and current shell. Research any major new rule/history journey before UI work, and count natural Farsi review plus German/English acceptance in the UI row. External research assets and private settings do not enter source bundles.
- **Actual throughput**: record completed acceptance and correction effort after the first bounded tranche. If migration, ownership or failure semantics expand, update these ranges and task child work before offering dates. Parallel specialists can review independent contracts/tests; shared schema/worker files require one coordinating owner.

## External work and evidence boundary

SLK-023's 8-16 hours covers finite engineering execution, cleanup and evidence capture only after a real chosen sandbox, scopes/channel, credentials and appropriate authorization are supplied. Account setup, administrator availability, vendor approval, provider outages and public callback/hosting dependencies have unknown external lead times and are excluded, not assigned zero duration. SLK-022 prepares the finite script without sending messages. No live resources, domain or provider grant were selected by this estimate.

SLK-024 must report local-only status until actual provider evidence exists; a local support record can document the limitation without asserting a supported live connector. No simulated success closes SLK-023. The same boundary applies to publication and every later provider.

Review outcome: BASE-012 has an auditable first-slice range, capacity assumptions and explicit unknowns. This document supplies planning-review evidence only. CONN, EVT and SLK implementation statuses remain unchanged and require their own acceptance evidence.
