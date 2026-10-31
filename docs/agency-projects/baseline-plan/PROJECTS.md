# Agency Projects implementation work packages

31 October 2026. Ali requested planning followed directly by implementation in a new goal/chat. These 96 tasks define the agency slice, not replacements for existing Sales, MAIL, Calendar, Privacy or integration tasks.

Effort sizes are relative complexity, including review and qualification, not calendar promises. Each task requires its listed outcome and applicable test evidence. Test-family definitions are in TEST-MATRIX.md. All statuses below are planned; source inspections and owner replies do not complete implementation tasks.

R0 is foundation/design; R1 is projects and client updates; R2 adds freelancer coordination/templates; R3 adds revisions and qualified integration; R4 is quotation-dependent finance. Security/privacy/quality tasks run alongside each slice and gate its enablement. The full goal retains conditional tasks while continuing independent work.

## AP-00: Ownership, baseline and shared contracts

Release: R0. Priority: P0. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-00.1 | Preserve the live source inventory | Refresh committed heads, dirty paths, remote main, applied-ledger availability and service ownership without mutating peers. | T00: every selected source has an exact SHA; dirty source is excluded; no preview is stopped. | None |
| AP-00.2 | Establish the isolated implementation checkout | Create an agency-owned checkout from a reviewable committed base; preserve fork/upstream and pinned Bun without adopting dirty peers. | T00/T35: clean baseline manifest, Bun/lockfile identity and reproducible restart instructions agree. | AP-00.1 |
| AP-00.3 | Accept named ownership and extension contracts | Record Sales handover, Calendar/activity, MAIL, WF/CONN/EVT, Settings and Privacy owners and unresolved interface decisions. | T00: all six owner responses are linked; proposed APIs are distinguished from actual exports. | AP-00.1 |
| AP-00.4 | Select an accepted combined lineage | Compare actual common snapshots and owner-approved cuts, including divergent Privacy/Calendar journals; qualify supported upgrade paths. | T30: no applied history is renamed; common-key conflicts stop reconciliation; SQL-only guards survive. | AP-00.1;AP-00.3 |
| AP-00.5 | Request concrete migration allocations | Present reviewed agency schema deltas to the platform allocator; obtain explicit numbers before generation. | T30: no use of reserved85..93 or assumed94; new journal timestamps advance the accepted combined head. | AP-00.4;AP-02.1 |
| AP-00.6 | Map commands, events and task ownership | Choose canonical assignment/activity states, notification admission and shared effect bindings using actual exports. | T04/T16: one canonical activity/task path; no duplicate scheduler, sender, credentials or event engine. | AP-00.3 |
| AP-00.7 | Set the private qualification profile | Reserve distinct ports, DB and synthetic identities; coordinate finite heavy-test windows and disk/memory checks. | T00/T31: profile is isolated and ignored; no broad worker dispatch against imported or peer rows. | AP-00.2 |
| AP-00.8 | Publish the executable baseline and first slice | Maintain the evidence ledger and begin pure policies/state machines while shared migration or runtime gates remain open. | T00/T35: task statuses distinguish source, local runtime, owner review and release; no fabricated pass count. | AP-00.2;AP-00.3 |

## AP-01: Current-shell design and natural localization

Release: R0/R1. Priority: P0. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-01.1 | Inventory the latest UI and adapters | Inspect current main plus committed Settings/Sales handoffs; record typography, density, navigation, tokens and protected journeys. | T25/T32: annotated current-shell references are tied to exact source/capture versions. | AP-00.1 |
| AP-01.2 | Design project list and workspace states | Specify list, project summary, next actions, client updates and assignment panels using existing wrappers. | T25/T26: loading, empty, error, retry, read-only, conflict and archived designs exist in FA/DE/EN. | AP-01.1 |
| AP-01.3 | Design the focused assignment editor | Keep brief, freelancer, internal owner, deadlines, status and blocker legible; place secondary details on demand. | T25/T26: draft preservation, focus order, Escape, return focus and long translated copy are specified. | AP-01.1 |
| AP-01.4 | Design feedback and approval records | Make requested changes, external version references, included rounds and recorded approval provenance explicit. | T13/T14/T25: no visual state implies an external client authenticated or signed when staff recorded it. | AP-01.2 |
| AP-01.5 | Author Farsi first and German second | Write contextual labels, actions, validation, uncertainty, blockers and recovery text; keep English complete. | T25: ICU/key parity passes; native-language review evidence is retained or clearly pending. | AP-01.2;AP-01.3;AP-01.4 |
| AP-01.6 | Specify responsive and accessible interaction | Reuse shadcn adapters and RTL direction behavior across 390px mobile, desktop, dark/light and keyboard operation. | T26: dialogs trap/restore focus, controls have specific names and no unintended horizontal overflow. | AP-01.2;AP-01.3 |
| AP-01.7 | Validate realistic agency scenarios | Walk through a modeling project, video revisions and a multi-contact client using synthetic data; collect actual feedback when available. | T25/T35: observations, design hypotheses and real participant findings are recorded separately. | AP-01.2;AP-01.4 |
| AP-01.8 | Publish original current-shell UI specifications | Freeze reviewed screen/state decisions and component ownership before production UI increments. | T25/T32: no copied proprietary assets, generated primitive edits or replacement of protected peer UI. | AP-01.5;AP-01.6;AP-01.7 |

## AP-02: Project domain, permissions and CRM links

Release: R1. Priority: P0. Relative size: L.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-02.1 | Specify the additive domain and constraints | Define projects, explicit memberships, deliverables, assignments, update commitments, revision records and audit/version references. | T01/T02: review covers UUID FKs, null semantics, uniqueness, bounded text and same-project consistency. | AP-00.3;AP-00.6 |
| AP-02.2 | Define the project access truth table | Use existing native identity and record ceilings with separate project-read, edit, assignment and financial permissions. | T02/T03/T23: hidden parents and financial fields cannot leak through joins, counts or broad admin assumptions. | AP-02.1 |
| AP-02.3 | Implement project creation and reads | Create projects with an internal owner and explicit authorized CRM links; preserve acquisition won/lost history. | T01/T02/T30: real PG create/read/rollback/duplicate-request tests preserve existing CRM UUIDs and statuses. | AP-00.4;AP-00.5;AP-02.2 |
| AP-02.4 | Implement versioned project transitions | Support planned, active, on-hold, completed, canceled and archived states with reasons and immutable history. | T09/T33: stale writes fail; archive/reopen preserves history; cancellation creates no external effect. | AP-02.3 |
| AP-02.5 | Deliver bounded list and workspace reads | Return permission-filtered project summaries, deliverables and work queues with stable paging and minimal DTOs. | T02/T27/T28: hidden rows/counts are absent; malformed saved filters never widen results. | AP-02.3;AP-01.8 |
| AP-02.6 | Qualify the activity visibility bridge | Agree and implement project visibility intersection on activity list/edit/calendar/search/notification/export/MCP paths before exposing linked tasks. | T03/T04: deny tests cover every surface; assignment linkage never inherits a broader customer permission. | AP-00.6;AP-02.2 |
| AP-02.7 | Implement atomic deal-to-project handover | Explicitly link to Sales SP-09 handover through an agreed seam; one deal may have multiple intentionally distinct projects. | T02/T16/T32: replay creates one intended project; a hidden or archived deal cannot be probed or mutated. | AP-02.3;AP-00.3 |
| AP-02.8 | Ship project navigation and summary | Add the optional module using the current shell, accessible summaries and explicit archived/unavailable states. | T24/T25/T26/T32: disabled module leaves old journeys intact; all three languages retain draft/context. | AP-02.4;AP-02.5;AP-02.6;AP-01.8 |

## AP-03: Client update commitments and communication preferences

Release: R1. Priority: P0. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-03.1 | Model per-project communication preferences | Record relevant contact, role, preferred channel, update cadence and optional external conversation reference without changing global contact identity. | T01/T05/T34: multiple contact/channel roles coexist; links neither fetch remote data nor grant access. | AP-02.3 |
| AP-03.2 | Record update commitments | Set an accountable internal owner, explicit next-update date or instant, client timezone when chosen and reminder intent. | T05/T07: no cadence is inferred from language; Persian dates round-trip to canonical civil/instant intent. | AP-03.1;AP-02.6 |
| AP-03.3 | Record manual communication evidence | Allow staff to record an update's channel, recipient, occurrence time and brief note; label it staff-recorded. | T05/T06: creating a draft/copy does not mark sent; one log id is idempotent and corrections retain audit. | AP-03.1 |
| AP-03.4 | Build the client-update queue | Show last recorded update, next commitment, responsible person, blockers and overdue state with scoped filtering. | T05/T27/T28: untracked WhatsApp activity is not claimed complete; hidden projects do not affect counts. | AP-03.2;AP-03.3 |
| AP-03.5 | Support completion, snooze and reassignment | Resolve or reschedule a commitment explicitly while preserving original promise, reason and owner history. | T06/T07/T33: racing complete/snooze/reassign operations have one current revision and retain evidence. | AP-03.2;AP-03.3 |
| AP-03.6 | Use durable internal reminder intent | Admit reminders through the accepted Calendar/WF/notification paths with atomic intent and current authority rechecks. | T04/T16/T17: queue outage cannot lose committed intent or report a saved record as unsaved; restart does not duplicate reminders. | AP-00.6;AP-03.2;AP-07.3 |
| AP-03.7 | Deliver update editor and daily dashboard | Integrate commitments/preferences into project workspace and a concise daily internal queue. | T25/T26: FA/DE/EN save/retry/conflict, mobile, RTL and mixed-direction address journeys pass. | AP-03.4;AP-03.5;AP-01.8 |
| AP-03.8 | Qualify update completion end to end | Exercise multiple client contacts and manual channels, with explicit delivery evidence only where available. | T05/T06/T17/T18: reminder, draft, recorded communication, provider acceptance and client reply remain distinct. | AP-03.6;AP-03.7 |

## AP-04: Internal freelancer assignment coordination

Release: R2. Priority: P0. Relative size: L.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-04.1 | Reuse freelancer contact identity | Select or explicitly create a person and freelancer role/skills profile without creating an auth account or silently merging addresses. | T01/T08/T20: same-name/shared-address contacts remain distinct; no membership or mailbox access is granted. | AP-02.3;AP-08.1 |
| AP-04.2 | Implement assignment creation and briefs | Link one project/deliverable, freelancer contact, internal accountable owner and sanitized brief through reviewed activity bindings. | T01/T02/T04/T08: cross-project references and inaccessible contacts are rejected atomically. | AP-04.1;AP-02.6 |
| AP-04.3 | Record acceptance and progress provenance | Implement awaiting acceptance, working, submitted, internal review, changes requested, approved and canceled transitions. | T08/T09: only permitted transitions pass; staff-recorded external acceptance is never presented as authenticated freelancer action. | AP-04.2 |
| AP-04.4 | Separate internal and client deadlines | Model internal due intent, client milestone and dependencies; preview actual working-day rules without inferring Iranian weekends. | T07/T10: timezone/DST/Nowruz boundaries, unscheduled work, cycles and impossible dependency dates are handled explicitly. | AP-04.2 |
| AP-04.5 | Implement blockers and producer handoff | Record waiting-on party, blocker reason, next follow-up and producer reassignment with no implied external notification. | T09/T10/T17: blocked work retains original due date; owner removal invalidates stale scheduled work. | AP-04.3;AP-04.4 |
| AP-04.6 | Deliver assignment board and focused editor | Provide scoped list/board views, freelancer filters and project detail panels in the latest UI. | T25/T26/T27: drafts survive failure/navigation; keyboard controls, FA/DE/EN and denied states pass. | AP-04.3;AP-04.4;AP-01.8 |
| AP-04.7 | Deliver internal freelancer workload | Show only permitted assignments, deadlines and declared availability; keep sensitive rates and client pricing separately authorized. | T02/T23/T28: counts and workload do not disclose hidden projects, rates or other freelancers' information. | AP-04.5;AP-04.6 |
| AP-04.8 | Qualify the outsourced production journey | Run modeling and video-project scenarios from assignment through internal review and revision using actual DB/queue paths. | T08/T09/T10/T17/T25: races, restart, cancellation, deactivation and language switching preserve one current assignment state. | AP-04.5;AP-04.6;AP-04.7 |

## AP-05: Versioned project and production templates

Release: R2. Priority: P1. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-05.1 | Define versioned template manifests | Describe project stages, deliverables, assignment intent, review checkpoints, roles and deadline offsets as immutable versions. | T01/T11/T12: invalid references, cycles, unknown actions and unsupported versions are rejected. | AP-02.1;AP-00.6 |
| AP-05.2 | Author three bounded starter templates | Provide modeling, short video and campaign variants with editable assumptions and no preactivated external effects. | T11/T25: FA/DE/EN manifests have no real recipients, assumed freelancer availability or automatic messages. | AP-05.1;AP-01.5 |
| AP-05.3 | Build install preview and role mapping | Show the exact records/tasks to be created, unresolved mappings and chosen date/workweek rules before applying. | T07/T11/T26: missing staff/contact/capability dependencies prevent activation and are explained accessibly. | AP-05.2;AP-04.2 |
| AP-05.4 | Implement atomic replay-safe installation | Install through existing canonical commands/activity paths and stable install/instance mappings. | T11/T16: 100 concurrent retry requests create one intended instance; interruption rolls back or resumes without duplicates. | AP-05.3;AP-02.6 |
| AP-05.5 | Preserve local overrides | Track source template version and local changes without silently changing live projects when a template evolves. | T12/T33: modified tasks, owners and deadlines survive template updates and restore. | AP-05.4 |
| AP-05.6 | Preview changes to installed templates | Provide explicit diff/reapply choices with conflict explanations and no changes to completed or approved work by default. | T11/T12/T14: stale updates fail; completed evidence is immutable; unresolved conflicts stop apply. | AP-05.5 |
| AP-05.7 | Integrate explicit workflow activation | Map eligible template automation to the shared WF builder using actual supported actions and permission checks. | T16/T17/T24: install is not activation; disabled or unavailable capabilities cause zero effects. | AP-05.4;AP-07.2;AP-07.3 |
| AP-05.8 | Qualify template reuse and recovery | Rehearse installation, rollback, override, version upgrade, duplicate events and backup/restore. | T11/T12/T30/T31: one stable project/task mapping survives retry and recovery on the exact candidate. | AP-05.6;AP-05.7 |

## AP-06: Feedback, revision rounds and recorded approval

Release: R3. Priority: P1. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-06.1 | Define feedback and version references | Create bounded text/reference feedback scoped to a project, deliverable and identified external version, with provenance. | T01/T13/T34: malicious HTML/URLs, invalid references and cross-project links fail without remote fetching. | AP-02.3;AP-08.1 |
| AP-06.2 | Turn feedback into assigned change requests | Record requested change, internal assignee, priority, due intent and resolution without creating a second task engine. | T04/T09/T13: duplicate conversion creates one linked task and cannot widen permissions. | AP-06.1;AP-02.6 |
| AP-06.3 | Track revision rounds and agreed scope | Separate rounds, included work and proposed extra scope, preserving the source of agreed limits. | T13/T15: zero/unknown included rounds remain distinct; request counts never automatically create a charge. | AP-06.1 |
| AP-06.4 | Record version-specific review decisions | Save internal approval or staff-recorded client approval with actor, evidence reference, method and timestamp. | T14/T29: a note cannot impersonate client authentication/signature; approval binds the reviewed version exactly. | AP-06.2;AP-06.3 |
| AP-06.5 | Handle reopened and changed work | New versions and reopened requests retain old approval history and require a new decision where applicable. | T09/T14/T15: concurrent approval/change has deterministic conflict handling; old approval never silently approves new content. | AP-06.4 |
| AP-06.6 | Deliver revision and review UI | Show open requests, round history, assigned owner, decision provenance and scope state in the existing workspace. | T25/T26: actionable FA/DE/EN copy, safe plain-text external diagnostics and accessible history pass. | AP-06.3;AP-06.4;AP-01.8 |
| AP-06.7 | Prepare explicit commercial-change handoff | Produce a reviewed scope-change reference for the future quotation owner without automatic pricing, invoicing or financial posting. | T15/T16/T21: unknown prices are not zero; retries create one reference and no financial/external effect. | AP-06.3;AP-09.1 |
| AP-06.8 | Qualify feedback/revision journeys | Exercise contradictory feedback, multiple reviewers, hidden financial context, stale versions and deleted/archived sources. | T02/T13/T14/T15/T20: visibility, third-party disclosure and version provenance remain intact through restore. | AP-06.5;AP-06.6;AP-06.7 |

## AP-07: Optional module and existing automation/integration bindings

Release: R1-R3. Priority: P0. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-07.1 | Implement optional module admission | Use an agreed feature/capability mechanism with server enforcement; no new marketplace/plugin runtime is introduced. | T03/T24: disabled/unlicensed-by-configuration state admits no new effects and does not reveal or delete history. | AP-00.3;AP-02.2 |
| AP-07.2 | Register narrow project command handlers | Expose only reviewed project/assignment/update commands through the existing WF action registry and server policy. | T03/T16: current actor/record/field authority is checked at execution; unavailable handlers stay unavailable. | AP-00.6;AP-02.3 |
| AP-07.3 | Use the shared durable admission contract | Bind committed agency events and reminder intents to an owner-reviewed actual outbox API; if absent, keep external effects disabled. | T16/T17: rollback emits no effect; replay and queue outage preserve one business intent; no fictional import is added. | AP-00.6;AP-07.2 |
| AP-07.4 | Qualify schedule cancellation and recovery | Use the existing scheduler's generation/revision semantics for update and assignment reminders. | T07/T17: reschedule, archive, revocation, import and restore cannot reactivate stale or historical effects. | AP-07.3 |
| AP-07.5 | Add reviewed communication draft actions | Prepare client/freelancer updates through the selected capable MAIL path, with human review and explicit actual recipient intent. | T18/T23: mailbox ownership and data disclosure are checked; draft/copy is never sent status; no secondary SMTP sender. | AP-03.3;AP-04.2;AP-00.3 |
| AP-07.6 | Admit supported outbound actions explicitly | Enable only qualified shared MAIL/CONN effects with selected actor, connection, recipient and original attempt binding. | T16/T18: accepted/partial/unknown holds survive retry, cancellation and reconnect; zero duplicate SMTP submissions. | AP-07.3;AP-07.5 |
| AP-07.7 | Add traceable safe run history | Link project events, canonical activity IDs, workflow runs and domain receipts without exposing credentials/private payloads. | T23/T29: permissions apply to logs, errors, realtime and histories; no hidden rate or mailbox-content leak. | AP-07.4;AP-07.6 |
| AP-07.8 | Qualify disable, offboard and replay | Rehearse module disable/re-enable, removed staff, revoked grants and interrupted worker recovery against actual shared services. | T03/T16/T17/T18/T24: stale work stays fenced; failures are recoverable without fabricated success or blind retries. | AP-07.4;AP-07.6;AP-07.7 |

## AP-08: Privacy lifecycle, restricted data and audit

Release: R1-R3. Priority: P0. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-08.1 | Declare purpose and subject relationships | Map users, freelancer contacts, client contacts, authors and evidence to explicit subjects without email-based identity inference. | T19/T20: shared addresses/authors do not identify the entire project as one subject's data. | AP-02.1;AP-00.3 |
| AP-08.2 | Register every new store and writer | Extend the Privacy owner's versioned inventory for tables, JSON, snapshots, queues, caches, exports and recipients through reviewed adapters. | T19: unknown boundaries fail; every lifecycle operation is supported with proof or explicitly unavailable. | AP-08.1 |
| AP-08.3 | Implement scoped discovery and export bindings | Provide project-domain adapters that preserve third-party redaction, financial visibility and source provenance. | T02/T20/T23: one subject cannot export an entire client/project/freelancer graph by association. | AP-08.2;AP-02.3 |
| AP-08.4 | Consume current restriction and writer fences | Use actual Privacy owner APIs for restriction/erasure fencing where available; document and gate unsupported behavior. | T03/T17/T20: restriction or authority changes invalidate stale mutations/jobs without a new privacy authority. | AP-08.2;AP-00.3 |
| AP-08.5 | Define archive and retention behavior | Preserve approvals, provenance and permitted history while making retention/deletion policies explicit and operator-owned. | T20/T33: archive is not called erasure; preservation/holds and contact deletion follow the accepted domain policy. | AP-08.2;AP-06.4 |
| AP-08.6 | Enforce financial and external-reference boundaries | Redact cost/margin fields independently from project visibility; external references do not produce public access grants. | T02/T23/T34: list/count/export/realtime/MCP/proxy paths fail closed for hidden financial or linked data. | AP-02.2;AP-09.1 |
| AP-08.7 | Implement minimal audited mutation provenance | Reuse existing audit identity, revision and registered error patterns with bounded privacy-safe diagnostics. | T03/T29: failed/rolled-back mutations have no success audit; no brief, address, key or private amount enters routine logs. | AP-02.3;AP-08.1 |
| AP-08.8 | Qualify lifecycle and revocation races | Run real PG shared-subject, removed-staff, export/download authorization and restricted-writer tests on the accepted combined cut. | T03/T19/T20/T23/T31: all applicable deny cases and restored-generation fences pass before enablement. | AP-08.3;AP-08.4;AP-08.5;AP-08.6;AP-08.7 |

## AP-09: Quotation-dependent budgets and bounded margin

Release: R4-conditional. Priority: P1. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-09.1 | Agree the quotation and cost contract | Coordinate with IG-12/13 owner on accepted quote/revision/value sources, currency, cost permissions and missing-data semantics. | T21/T22/T23: no second quotation/invoice/accounting model or invented API; implementation prerequisites are explicit. | AP-00.3;AP-02.1 |
| AP-09.2 | Bind an approved commercial baseline | Link a project to an immutable authorized quotation revision or other explicitly approved budget source. | T21/T22: an edited quote cannot silently alter an approved project baseline; unavailable source is not zero revenue. | AP-09.1 |
| AP-09.3 | Record committed freelancer costs | Add authorized fixed-fee/rate-and-quantity commitments through the shared exact-money conventions with revisions. | T21/T23: canonical IRR/toman and German locale preserve value; hidden rates never enter ordinary assignment DTOs. | AP-09.1;AP-04.2 |
| AP-09.4 | Record actual project cost evidence | Track authorized actual costs with source/reference and correction history; exclude payments and accounting posting. | T21/T22/T29: duplicate references do not double-count; missing/unverified cost evidence is visible. | AP-09.3 |
| AP-09.5 | Handle budget and scope changes | Require explicit financial authority and approved revision links for commercial baseline changes. | T15/T21/T23: feedback or approval does not automatically raise budget or issue an invoice. | AP-09.2;AP-06.7 |
| AP-09.6 | Compute bounded per-currency summaries | Show budget, committed/actual tracked costs and clearly named estimated/tracked project margin with coverage limitations. | T21/T22: no cross-currency sum/implicit FX; zero, unknown, incomplete costs and overhead exclusions are distinct. | AP-09.2;AP-09.3;AP-09.4 |
| AP-09.7 | Deliver permission-safe financial panels | Present authorized summaries and missing-source states without changing ordinary project/freelancer access. | T23/T25/T26: denied fields never reach client data, exports, notifications or realtime; FA/DE/EN units remain exact. | AP-09.5;AP-09.6;AP-08.6 |
| AP-09.8 | Qualify quote-to-project financial consistency | Exercise changes, conflicting currencies, restricted rates, restore and source revocation before enabling the financial slice. | T21/T22/T23/T31: hand-calculated exact fixtures agree with permitted UI/export totals; no financial writes occur. | AP-09.7 |

## AP-10: Integrated tests, migration and operational recovery

Release: All. Priority: P0. Relative size: L.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-10.1 | Maintain meaningful red-green unit coverage | Reproduce domain and workflow bugs before fixes; cover state policies, schemas and region invariants without mirroring implementation. | T01/T05/T07/T09/T11/T13/T21: actual failing cases and passing final scoped results are recorded. | AP-00.8 |
| AP-10.2 | Qualify real database constraints and races | Use disposable real PostgreSQL for permissions, FKs, retries, concurrent updates and transaction rollback. | T02/T03/T06/T09/T11/T14/T23: no DB mocks; denial and one-winner invariants pass. | AP-02.3;AP-04.3;AP-06.4 |
| AP-10.3 | Rehearse supported fresh and upgrade paths | Apply allocator-reviewed actual SQL and all accepted owner deltas; preserve legacy UUIDs, auth, workflow guards and uncertain mail holds. | T30: real platform-to-combined-to-agency upgrade and rerun pass; Drizzle no-diff alone is insufficient. | AP-00.4;AP-00.5;AP-02.3 |
| AP-10.4 | Exercise queue outage and worker restart | Use actual pg-boss and controlled failure/cancellation to validate durable reminders, workflow intent and external effect fences. | T16/T17/T18: stopped queue, process failure, stale lease and reconnect produce no lost intent or duplicate send. | AP-03.6;AP-07.8 |
| AP-10.5 | Run native FA/DE/EN browser journeys | Use native auth and an isolated runtime to create projects, assign freelancers, schedule updates, install templates and review revisions. | T25/T26: real persistence/reload, conflict/retry, mobile/dark/light, keyboard and mixed scripts pass on exact source. | AP-03.8;AP-04.8;AP-05.8;AP-06.8 |
| AP-10.6 | Measure bounded reads and safe exports | Test a declared synthetic workload with paged reads and allowed exports; record host, p95 and query evidence rather than invented throughput. | T02/T27/T28/T34: no unbounded query/export, formula injection or private aggregate leak; agreed measured budgets pass. | AP-02.5;AP-04.7;AP-08.3 |
| AP-10.7 | Rehearse backup, fresh restore and compatibility | Restore owned synthetic DB/keys and reference mappings, verifying existing auth, CRM, MAIL, Calendar, Sales and Privacy boundaries. | T31/T32/T33: restored graph counts/UUIDs/approvals/template mappings and effect holds agree; no historical send is admitted. | AP-10.3;AP-10.4 |
| AP-10.8 | Run consolidated candidate checks | Run pinned frozen install, i18n, typecheck, lint, relevant unit/PG suites, production app and worker builds in coordinated finite windows. | T00/T24/T25/T30/T35: exact candidate checks exit0, failures remain open, no inherited result substitutes for new integration evidence. | AP-10.1;AP-10.2;AP-10.3;AP-10.4;AP-10.5;AP-10.6;AP-10.7 |

## AP-11: Documentation, rollout and maintained open-source delivery

Release: All. Priority: P0. Relative size: M.

| ID | Task | Expected outcome | Expected passing tests | Dependencies |
| --- | --- | --- | --- | --- |
| AP-11.1 | Maintain the task and evidence ledger | Keep all 96 task IDs/dependencies; track planned, active, source-verified, runtime-verified, blocked evidence and accepted states distinctly. | T00/T35: Markdown/CSV/JSON counts match and DAG has no missing/cyclic dependencies. | AP-00.8 |
| AP-11.2 | Write user and operator guides in three languages | Document setup, update commitments, freelancer coordination, revisions, permissions and recovery in natural FA/DE/EN. | T25/T35: every documented action exists; no invoice, portal, hosting or unqualified WhatsApp claim is made. | AP-01.5;AP-03.7;AP-04.6;AP-06.6 |
| AP-11.3 | Define safe import and export mappings | Preserve external IDs and explicit person/project/assignment mapping; imported history and restored events never dispatch communications. | T01/T16/T20/T34: duplicate import, shared-name ambiguity, formula payload and hidden fields are handled safely. | AP-02.3;AP-08.3;AP-07.3 |
| AP-11.4 | Publish staged enablement and recovery runbooks | Document optional-module activation, compatible app/DB restoration, disable behavior and owner-approved migration rollback limits. | T24/T30/T31/T33: disabling preserves history and blocks new work; reverting code alone is not called a DB rollback. | AP-10.3;AP-10.7 |
| AP-11.5 | Document support and observability | Use registered errors, safe audit correlations and finite health/recovery checks with named domain ownership. | T29/T35: logs expose no client brief, freelancer fee, address, credential or hidden record payload. | AP-08.7;AP-07.7 |
| AP-11.6 | Package source, notices and capability limits | Preserve upstream/fork linkage, reviewable commits and licenses; keep optional module source available without a new plugin runtime. | T00/T24/T35: no secrets/private profiles/generated dependencies enter Git; feature labels match qualified source. | AP-10.8;AP-11.2;AP-11.4 |
| AP-11.7 | Prepare the real agency pilot separately | Propose a few authorized real projects and measure missed updates, coordination effort, revision turnaround and billing-handoff delay against an actual baseline. | T35: synthetic results never count as customer adoption; participants/access/outreach require concrete authorization. | AP-10.8;AP-11.2 |
| AP-11.8 | Accept releases and retain honest open gates | Publish per-release exact source, owner contract decisions, migrations, tests, language evidence and remaining dependencies; keep R4 open until qualified. | T35: no incomplete feature or unavailable quotation/provider/privacy capability is marked accepted. | AP-11.1;AP-11.3;AP-11.4;AP-11.5;AP-11.6 |
