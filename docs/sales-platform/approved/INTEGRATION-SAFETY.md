# Integration, preservation, qualification, and release plan

**Status:** proposed architecture and acceptance contract, 31 October 2026. This document does not run migrations, enable features, change access, send messages, merge branches, or authorize production/provider operations. Its purpose is to make later implementation incremental, reviewable and recoverable.

## 1. Non-negotiable product invariants

1. Existing record IDs, customer links, pipeline/stage references, custom field keys, saved filter IDs and historical audit values retain their meaning.
2. A deal belongs to one active pipeline/stage assignment at a time. Account membership, partner participation and post-sale linkage do not duplicate that deal or its revenue.
3. Existing authentication and revocation behavior remains authoritative. A new scope, template, view, worker, integration or MCP tool cannot become an alternate authorization path.
4. A shared query definition never grants access to records or fields. Apply the executing viewer's authority on every result, aggregate, download and live update.
5. A committed sales command changes canonical state once and emits one stable domain event. Repeated requests and events cannot multiply effects.
6. Existing Gmail/independent-email history, sender selection, attachments, delivery receipts and ambiguous-send review remain owned by IG email services. No new sales sender or hidden SMTP retry loop.
7. Simulation does not send, post, invite, submit or create lasting business effects. A successful connection check is not successful delivery.
8. Locale changes preserve raw user text, phone values, dates, currencies, units, stage IDs, filter meaning, unsaved drafts and workflow execution context.
9. No historical import, migration, template upgrade or analytics backfill initiates retroactive outreach or live automations by default.
10. Existing UI remains the baseline. A new interface must improve a named job and pass state/localization review before replacing an established interaction.
11. No archive action silently purges business history. Removal, retention expiry, restoration and irreversible purge have different semantics.
12. Every release states what is observed, tested locally, provider-qualified, pilot-accepted and operated in production. One state does not imply another.

## 2. Reuse map and bounded architecture

| Concern | Reuse / extend | Avoid introducing |
| --- | --- | --- |
| Authentication and security UI | Better Auth plus current CRM account/revocation/fresh-auth rules and screens. | Another user store, parallel session authority or unreviewed auth Organization plugin. |
| Authorization | Existing capability, pipeline and record visibility services; extend them with a reviewed scope policy. | Checks only in React controls, copy-pasted role predicates, or trust in a client workspace ID. |
| Pipelines and stages | Current tables/services and stage-deletion/transfer protections. | A second generic board engine with disconnected deal/history identities. |
| Custom fields | Existing typed definitions/values with stable keys and entity targets. | Framework-specific unvalidated JSON, arbitrary SQL, or user-authored scripts. |
| Saved filters/views | Existing filter services and owner/shared definitions with a versioned decoder. | Materialized copies of customer data per view or creator-authority query caches. |
| Customer accounts | Existing customer-company/contact relations and merge/import contracts. | Reusing customer organizations as tenants or auth organizations. |
| Commands and events | Shared CRM mutation services plus the committed WF event/outbox contract. | Independent trigger emitters in UI handlers, non-durable notifications as event history, or parallel workflow engines. |
| Communication | Existing IG capability contracts, encrypted credentials, durable outcomes and revocation. | Sending from analytics, templates, bulk import, browser code or a second job queue. |
| Regional data | Existing locale/provider, exact decimal money, phone and calendar/date boundaries. | Locale-based country guessing, floating-point money, currency conversion or invented calendar recurrence. |
| Analytics | Existing stats queries, permissions, change logs and analytics proposal. | Silently replacing inferred history, mixing metric bases or adding currencies without FX evidence. |
| Calendar | Existing activity/date/time services and separately scoped calendar/conferencing plan. | Rebuilding Google Calendar parity inside the sales programme. |
| Provider connections and MCP | Existing connected-app policy, token grants, per-action permissions and offboarding. | Activating deferred providers/apps/marketplace features through a template install. |

New application modules should depend on shared commands and typed read models, not call each other's UI endpoints. A project owns its new records, policy and presentation; the established domain owner remains responsible for existing auth, email, workflow or regional behavior. Reserve migration IDs through the integration owner before concurrent schema work begins.

### Candidate additive data contracts

These are architecture candidates to refine, not ready-to-run database migrations.

| Contract | Purpose | Compatibility requirement |
| --- | --- | --- |
| Pipeline policy/revision metadata | Explicit access scope, configuration revision and lifecycle ownership. | Decode legacy `visibilityGroupId`; preserve effective access until an explicit reviewed policy change. |
| Process template/version/install | Immutable authored configuration, installation mapping and local overrides. | Stable installed stage/field IDs; manifests reference only known capabilities. |
| Stage policy/version | Advisory/blocking evidence requirements and override authority. | No new enforcement on existing pipelines until activated; every mutation path uses the same validator. |
| Stage transition/event | Exact from/to stage, pipeline/process version, origin and occurred/recorded time. | Legacy inferred history stays labeled; old reorder/deletion does not rewrite the event's meaning. |
| Qualification evidence | Typed responses, unknown state, source, reviewer, freshness and rule version. | Reuse field visibility and evidence links; framework switch never erases historic values. |
| Buying group and stakeholder association | Several buying committees and roles around existing contacts/accounts/deals. | Existing person/company IDs remain canonical; merges preserve provenance and ambiguous cases require review. |
| Lifecycle/renewal intent | Onboarding/ownership/period intent linked to won opportunities and accounts. | Do not change historic won/lost semantics or infer billing revenue from expected deal value. |
| Partner registration / tender record | Domain-specific decision/approval state linked to canonical accounts/opportunities/files. | No automatic financial commitments, public sharing, external sends or submission. |
| Product/source event | Purpose-limited input with stable source ID, event/received time, identity mapping and retention. | Quarantine unknown identity; deletion/suppression survives replay and rebuild. |
| Forecast snapshot | Versioned scenario assumptions, period, scope and actual outcome comparison. | Historic forecasts remain immutable; a current permission check controls reading the snapshot and underlying records. |
| Future workspace and membership | Explicit company boundary and membership/roles around validated server context. | Complete ownership attribution and scoped references before enabling more than the default workspace. |

Keep custom names as data. Generated names can use a stable catalog key plus a safe legacy fallback. Preserve original raw import values separately from canonical normalized identities. A query or type adapter must not silently coerce an unsupported historical value into a newly meaningful enum.

## 3. Baseline convergence and migration procedure

The observed workflow and integration branches have different `0083` migrations and different schema/journal descendants. **Do not combine them by renaming files blindly or applying both numeric sequences to an existing installation.**

1. Inventory exact heads, uncommitted ownership, migration files/checksums, journal tags and actual applied ledgers. Distinguish committed deployment history from disposable local rehearsal databases.
2. Create an isolated integration candidate from the selected supported baseline. Incorporate peer work through its owners and preserve source commits/patch provenance. No reset, stash, bulk-stage or branch deletion of unrelated work.
3. Decide which histories must be supported: current main, workflow preview, integrations preview, and any real installation shapes identified by maintainers. Remove none from support by assumption.
4. If a migration is demonstrably unreleased and unapplied on retained installations, its owner may regenerate its position/snapshot on the candidate. If applied to retained installations, preserve its identity/checksum and design an explicit forward-convergence procedure. A numeric-prefix collision alone does not determine the repair.
5. Document every supported starting ledger and its exact target path. If ownership/history cannot be established, block that upgrade path while investigation continues; never guess a completed state.
6. Rehearse each path against a restored representative database plus file/object manifest. Compare IDs, raw values, references, access results, queue receipts, workflow versions, view definitions and money/date examples.
7. Test interruption and resume at each bounded backfill phase, competing writers, constraint validation and index creation. Record lock duration and resource use.
8. Qualify a recovery route before exposing new writes. Keep new schema additive through a compatibility window. Rehearsal failure stops enablement; it does not justify resetting the existing installation.

### Expand, backfill, compare, switch, retain

| Step | Concrete work | Evidence / stop condition |
| --- | --- | --- |
| Expand | Add optional structures and compatible decoders; old application paths still operate. | Both intended application versions can read the supported shape; no unexpected defaults grant access. |
| Backfill | Bounded, checkpointed jobs with deterministic ownership and conflict reporting. | Row/reference counts reconcile; unresolved ownership is reported; replay changes nothing already completed. |
| Compare | Shadow new reads/policy calculations while the established path remains authoritative. | Any unauthorized superset is a blocking defect; omissions and metric differences are explained or fixed. |
| Switch reads | Operator-controlled server feature gate for a finite pilot scope. | Cache keys, search, aggregates, exports, files and WS all enforce the same context. |
| Switch writes | One canonical command transaction; compatibility projections updated atomically where required. | No independent dual writers; exactly one domain-event identity; failure rolls back both projection and command. |
| Validate | Apply strict references/uniqueness/nullability after verified coverage and safe index strategy. | Constraints describe actual data; no silent deletion or guessed remapping to satisfy them. |
| Retain | Preserve adapters and old read capability for the documented release window. | A separate versioned retirement decision follows evidence; no automatic destructive cleanup. |

Backfills and template migrations use an origin such as migration/import rather than normal user action. Workflow admission must explicitly decide whether that origin is actionable; default is no outbound historical effects. Event projection rebuilds similarly must not resend or recreate tasks.

## 4. Permission and context contract

For the current single workspace, maintain the existing active-user, session, administrator, pipeline-group and record rules. New per-pipeline capabilities may restrict a user's action further; they may not exceed the established capability ceiling. A deliberate future authority-model change needs its own mapping, truth table and review.

In multi-workspace mode, validate workspace membership and scope **before** any workspace administrator bypass of record rules. The existing `isAdmin` flag must not accidentally become cross-company superuser access. Any global host-operator capability is an explicit audited server path separate from normal workspace administration.

| Actor/context | Read a pipeline | Read a deal | Edit a deal | Manage pipeline | Share/export data |
| --- | --- | --- | --- | --- | --- |
| Inactive account or dead session | Deny. | Deny. | Deny. | Deny. | Deny; revoke live/download access as defined. |
| Active legacy member | Existing pipeline visibility. | Pipeline gate plus record visibility. | Existing capabilities plus record/action policy. | Existing management capability. | Existing permissions and per-record scope. |
| Proposed scoped viewer | Within allowed scope and legacy ceiling. | Within allowed scope and record rules. | Deny unless a separately permitted operation exists. | Deny. | Only explicitly permitted operations; view sharing does not expand data. |
| Proposed scoped editor | Within allowed scope and ceiling. | Record rules remain. | Scope plus capability plus field/stage policy. | Only if explicitly delegated within ceiling. | Independently checked; never implied by editing. |
| Team manager | Existing authorized team visibility, constrained by pipeline restrictions. | No automatic bypass for hidden pipeline/contact/mailbox data. | Explicit capability only. | Explicit capability only. | Same executing-viewer rules. |
| Workspace administrator | Current single-workspace model; future mode scoped to validated workspace. | Explicit administrator behavior within that boundary. | Policy-specific admin/override path, audited. | Within its workspace and freshness rules. | Exports/files/actions remain attributable and scoped. |
| Future external partner | Deny until external boundary is qualified. | Resource-specific grant and safe data projection only. | Allowlisted operations only. | Deny by default. | No general export/search/download access by membership alone. |
| Automation/API/MCP actor | Fresh validated scope and grant ceiling. | Recheck at read and execution. | Shared command/policy checks. | Only explicitly granted actions. | No impersonation of creator's historic broader access. |

Recheck authority after long waits, before irreversible/external effects, after account/pipeline/workspace revocation, and when a result is downloaded. Queue admission is not enduring permission. A stale UI receives useful denial/recovery without restricted names, counts or field values.

Every project must cover server actions, tRPC/HTTP APIs, workers, imports, bulk operations, MCP, search/autocomplete, statistics, exports, signed file URLs and realtime subscriptions. Scope caches by the relevant actor/context/policy version and invalidate on membership changes. Client caches are presentation state, never an authority source.

## 5. Workflow, provider, calendar and notification integration

Sales commands validate the actor, workspace where applicable, pipeline, record, field and stage policy in one coherent boundary. Committed state emits an outbox event with a stable ID. Consumers deduplicate by event and target action/version; only the selected branch/effect executes. Real-time UI notifications are not a durable event ledger.

The existing WF owner supplies event admission, immutable published versions, durable waits, cancellation, budgets and effect states. The existing IG owner supplies account readiness, encrypted tokens, provider capabilities, sender/recipient handling, durable receipts and reconnect/revocation behavior. Integrate when each exact capability is qualified; unsupported controls remain unavailable with a clear explanation.

Required effect states include planned, queued, running, accepted, completed where provable, rejected/failed, partial, cancelled and unknown/needs-review as relevant. Do not call SMTP acceptance a delivered inbox message. An uncertain external outcome must not enter a blind retry path. Reconciled proof and retry eligibility are separate from a user's desire to try again.

Connection changes, account suspension, offboarding and workspace removal invalidate future effects, stale subscriptions and connection grants. Restored/backfilled records cannot resurrect revoked credentials. Keep a recipient's language, consent/suppression, source country and selected sender independent from the operator's interface language.

Calendar date-only values are civil dates; scheduled events are instants with explicit authored timezone/calendar intent. Reuse the regional services and WF scheduling contract. Test nonexistent/repeated Berlin times, Tehran time display, Iranian month/year boundaries, leap behavior, all-day dates and timezone changes. Synchronizing an event through a provider does not establish support for Iranian month/year recurrence; that remains a separately verified capability.

## 6. Historic truth, analytics and money

Keep the existing inferred funnel available and label its basis. A stage's current ordinal cannot be used to rewrite what a historical event meant after reorder, merge, archive or transfer. New transition events retain enough pipeline/stage-version information to distinguish exact entries, inferred passage, skips, returns and reopened deals.

Define the created-cohort funnel, closing-period win rate and current inventory independently. An open stage stay is right-censored; its current age is distinct from completed-stage duration. Show sample sizes, unknowns and unavailable comparisons. Every chart/table/forecast/export has an equivalent permitted contributing-record query.

Movement reconciles opening inventory plus additions/transfers/reopenings/value changes minus wins/losses/transfers/removals to closing inventory. Snapshot assumptions and forecast time are immutable. A score's completeness is not a win probability; activity correlation is not a causal revenue effect.

Keep exact decimal amounts and currency codes. Report totals per selected currency unless a separately approved FX contract exists. IRR remains canonical for Iranian amounts; selected toman display divides exactly by ten, including 1 IRR → 0.1 toman. German locale preserves that choice. Contract-value, expected deal value, billed revenue, ARR/MRR, CAC and ROAS each require appropriate reliable sources; display unavailable rather than derive a misleading number from unrelated fields.

## 7. Qualification strategy and scenario register

Use focused unit checks for pure policy/schema/date/money logic, real PostgreSQL tests for transaction/constraint/race/migration behavior, real queue/worker tests for durability, and working-browser journeys for UI integration. Use protocol/provider contract tests where an external behavior matters. Avoid a large snapshot suite that merely reproduces component markup or duplicates implementation details.

| Scenario | Required evidence and failure boundary |
| --- | --- |
| Upgrade from supported main and both observed branch lineages | Migration ledger/checksum compatibility; unchanged IDs/raw data; reconciled records/permissions/files/queue state. |
| Migration interrupted/resumed with concurrent edits | Bounded checkpoint recovery; no lost updates or duplicate effects; explicit unresolved row list. |
| Existing UI and saved state | Current routes, shell, fonts, themes, favorites, filters, density, composer drafts and record history persist. |
| Restricted pipeline with permissive record | Pipeline gate still denies; owner/team/visible-to cannot bypass it. |
| Shared view owned by broader-access creator | Reader results, totals, autocomplete, exports and files reflect reader authority only. |
| Access removed during edit/export/queue wait | Submit/effect/download rechecks; caches/live subscriptions invalidate; safe local draft/recovery feedback. |
| Stage rules through non-UI paths | Bulk/import/worker/API/MCP obey the same rule and override policy as interactive moves. |
| Stage rename/reorder/archive/merge/transfer | Current display changes without rewriting historical process meaning; old links resolve safely. |
| Template install/upgrade/retry with local overrides | Atomic installation; stable mapping; no overwrite, duplicate configuration, activation or historical outreach. |
| Account merge or partly hidden buying group | Canonical references survive; ambiguous identity requires review; private communications stay private. |
| Event replay, worker crash and duplicated callback | Deterministic event/effect IDs; no duplicate tasks, deals, sends, renewals or notifications. |
| Provider timeout or accepted-but-unknown message | Correct durable unknown/partial state; receipt reconciliation before any eligible resend. |
| Farsi/German locale switch during unsaved work | Drafts, IDs, amounts, selected calendar/unit/timezone, filter meaning and custom names remain unchanged. |
| Iranian date/phone and German DST/money cases | Exact approved vectors, original input retention and explicit ambiguity/error guidance. |
| Analytics edge cases | Empty cohorts, skips, reversals, reopenings, transfers, deleted/archived records, multi-currency and hidden records reconcile. |
| Tender approval and later amendment | Immutable approved package; new edits cannot masquerade as approved or submitted evidence. |
| Renewal/cancellation and threshold flapping | One intended next record/effect; cancellation and suppression survive retry and replay. |
| Product-event unknown identity/deletion/outage | Quarantine, explicit source state and retention; no resurrected removed data. |
| Future workspace forgery or concurrent switching | Scope validation on every surface; no cross-workspace rows, events, files, tokens, notifications or cached drafts. |
| Backup restored after external effects | Freeze uncertain outbound work; reconcile surviving receipts/provider evidence; never replay all queued sends blindly. |
| Very many pipelines, long German/Persian names and large histories | Search/pagination/resource limits; usable keyboard/narrow layouts; measured hardware-specific envelope. |

Run the protected cross-domain journeys: login/security; invite/deactivate/revoke; find existing pipeline; open/edit/transfer deal; contact/account edit/import; saved-filter use/export; compose/send/reply/attachment/draft/unknown-send; activities and date selection; workflow edit/save/publish/simulate/run/cancel; stats and drill-down. Do not claim a provider journey is qualified by a synthetic local auth fixture.

The visual matrix includes FA/DE/EN; light/dark; 390/768/1280/1440 widths; admin/member/scoped-reader/scoped-editor where relevant; empty/populated/loading/error/denied/conflict/recovery. Cover every critical permutation for the affected flow, with risk-based representative coverage for repeated shared components. State omitted combinations and why. Keyboard-only, screen-reader and reflow are independent acceptance checks, not inferred from screenshots.

## 8. Performance, capacity, and operator limits

No current unlimited-capacity claim is made. The following are **proposed benchmark datasets and targets**, to refine against pilot installations and declared hardware. Do not launch stress/cloud campaigns from this document.

| Dataset | Pipelines | Deals | Stage/history events | Concurrent active users | Use |
| --- | ---: | ---: | ---: | ---: | --- |
| Basic | 10 | 10,000 | 100,000 | 10 | Initial release regression and UI behavior. |
| Team | 100 | 100,000 | 1,000,000 | 25 | Representative larger-team performance research. |
| Scale | 1,000 | 1,000,000 | 10,000,000 | 50 | Optional architecture/stress qualification; not an R1 support promise. |

Initial candidate targets on documented local-network hardware: p95 ordinary paginated list/filter API ≤500 ms; p95 first useful board content ≤2 seconds; p95 standard dashboard query ≤2 seconds; visible local action feedback ≤100 ms. Measure warm/cold caches, permission predicates and active-write load separately. Revise a target explicitly if evidence requires a tradeoff; never silently remove inaccessible records or disable policy checks to meet it.

Use server pagination/search rather than loading every pipeline/member/deal. Bound query complexity, bulk sizes, exports, worker concurrency, event payloads, history retention and retry budgets. Queue admission/backpressure must be observable and localized. Large exports run asynchronously with scoped manifests and expiring downloads. Operator safety limits are distinct from artificial paid-plan quotas.

Monitor query latency/errors, lock time, connection pool, memory, queue lag, dedup conflicts, unknown effects, revocation delay, backup age and migration progress. Default diagnostics are local and redacted; new external product telemetry is a separate decision. Assign alert ownership before enabling a feature.

## 9. Release gates, flags and acceptance

| Gate | Entry/exit requirement |
| --- | --- |
| G0 — Baseline | Exact candidate ancestry, peer ownership, current UI references, migration lineage and protected journeys recorded. |
| G1 — Product/design | Relevant research findings, Farsi/German current-shell prototypes, complete state behavior and explicit decisions available. |
| G2 — Functional/integration | Shared command behavior, real DB/queue invariants, migration/backfill/resume and cross-feature journeys pass on the exact candidate. |
| G3 — Authority/data/regional | Permission and isolation matrices, redaction, exact data conventions, native copy and accessibility checks pass. |
| G4 — Recovery/operations | Rehearsed rollback or forward recovery, backup/restore proof, feature disablement, diagnostics and versioned runbooks exist. |
| G5 — Controlled real-use acceptance | Where applicable, authorized provider evidence and finite pilot outcomes pass; remaining limitations are explicitly accepted before broader enablement. |

Use server-enforced capability/feature gates such as pipeline sharing, templates, rules, insights and advanced motions. Names and implementation belong in the architecture review; avoid one global flag that makes every unfinished capability visible. Flags may hide an entry point, gate new writes and pause new admissions; they never bypass authorization or erase already-created data.

Recommended progression is developer fixtures → isolated combined candidate → maintainer rehearsal → opt-in finite pilot → measured limited enablement → broader availability. Record exact commit/build/schema/flag versions and the supported starting installation shape. Announce a changed workflow with contextual release guidance rather than rearrange the entire sidebar at once.

Stop the affected rollout for unexplained data differences, unauthorized result supersets, duplicate/unknown uncontrolled effects, migration lineage mismatch, inaccessible critical workflows, broken regional invariants, or inability to execute recovery. A cosmetic non-blocking issue may be explicitly tracked with an owner; security/data-loss defects cannot be offset by an average usability score.

## 10. Rollback and disaster recovery

**Application rollback:** redeploying an older binary is safe only if it can read the new additive schema and data semantics. Test this with writes created after enablement. Preserve unsupported new records for a forward-capable version; do not drop them to make an old binary start.

**Disablement:** stop new feature admissions and new outbound effects, preserve definitions/history/receipts, let provably safe in-flight database work finish or cancel according to its contract, and surface persistent state. Pausing a feature cannot unsend a message, revoke a submitted tender or reverse a financial action.

**Database restore:** restore into a quarantined destination, verify checksums/manifests/IDs/authority and queue state, rotate recovery context where designed, then reconcile external effects before enabling workers. Restoring an old snapshot may lose local acceptance receipts even when the provider already acted. Such work stays suspended/needs-review until evidence is reconciled; never replay an entire historical outbox automatically.

Proposed disaster-recovery objectives for a configured installation are recovery point ≤15 minutes and recovery time ≤60 minutes; confirm feasibility against the installation's backup/storage/hardware and measure the actual rehearsal. Normal application rollback should preserve all acknowledged business writes. These targets do not guarantee reconstruction of external provider outcomes after lost receipts; explicit reconciliation is required.

Retain a release manifest with source/build/schema versions, migration lineage, flag state, backup identifier, file manifest, recovery instructions, provider capability versions and unresolved gates. Keep credentials outside artifacts and logs. Restore evidence includes actual permitted reads/writes and protected journeys, not merely a successful database process exit.

## 11. Open-source maintenance and project ownership

Each shipped capability needs a named code owner, support path, capability status, changelog, schema/API compatibility policy, upgrade/disable/recovery guide, sample synthetic data and a realistic operating envelope. Check dependency licenses, notices and template/framework attribution before redistribution. Preserve Bun package/lockfile ownership and keep dependency upgrades separate from major domain migrations unless necessary and qualified.

Document stable extension contracts for commands/events/templates without opening an arbitrary plugin runtime. Public marketplace review, billing, remote code installation and broad ChatGPT/Claude app expansion remain separately scoped work. Existing MCP tools remain supported and adopt shared server policy; a new interface is not a reason to break their schema.

Before allocating a project, record its owned files/modules and interfaces and who owns adjacent WF/IG work. Merge a small vertical slice only after its own checks and combined-candidate compatibility pass. Refresh the source/branch/status manifest after merges; do not report an old preview's UI or verification as proof of the new main branch.

## 12. Practical first vertical slice

After R0, deliver a single-workspace path: create a pipeline from a safe basic template → choose access → save a personal/shared view → create and move a synthetic deal → show an actionable advisory requirement → inspect exact contributing records → archive/restore the pipeline. Keep external effects disabled.

Prove this path through UI, shared server commands, actual database transactions, old-filter compatibility, access removal, a concurrent edit, Farsi/German display, and recovery from an interrupted upgrade. Only then expand blocking stage policies, automated effects, advanced analytics and specialized motions. This establishes the integration pattern without requiring a simultaneous rewrite of the product.
