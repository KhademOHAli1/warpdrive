# Agency Projects: architecture and boundaries

31 October 2026. Proposed domain design for owner review and test-first implementation. Names below describe responsibilities; they are not claims that shared APIs already exist.

## Product/module boundary

Deliver an optional first-party agency module inside the existing CRM. Reuse native Better Auth, CRM UUIDs, current permission services, shared UI adapters, calendar/date/money helpers, activities, notifications, published workflows, pg-boss and canonical integration/MAIL services. Avoid dependencies and package changes unless a concrete missing capability warrants qualification.

The module is enabled explicitly through the accepted capability/feature mechanism. Hiding navigation is insufficient: server actions, reads, jobs and effects check enablement and current authority. Disable preserves history and fences new work; re-enable does not replay historical external effects. This is open-source module packaging, not a second plugin engine or paid entitlement system.

## Proposed domain responsibilities

| Record | Responsibility and key constraints |
| --- | --- |
| Project | UUID, title, internal owner, revision, lifecycle, dates and explicit customer/deal links. Multiple intentional projects may refer to one won deal. No change to acquisition won/lost semantics. |
| Project membership/access | Explicit internal resource permissions constrained by existing CRM parent visibility. Adding an assignee/contact never grants unrelated CRM, mailbox or file access. Financial fields have a separate capability. |
| Deliverable | A named unit of work, external version reference, internal/client milestone and review state. No object storage, upload, streaming or public delivery ownership. |
| Assignment | Project/deliverable, freelancer person ID, accountable internal user, brief, state, deadlines, blocker and revision. Freelancer contact ID is never an authentication user ID. |
| Canonical activity binding | Explicit mapping between domain assignments/commitments and existing activities. One canonical due/reminder source and one direction of state ownership must be selected before implementation; no two independent mutable task copies. |
| Communication preference | Per-project/contact role, preferred channel, relevant conversation reference and explicit update cadence. Preserve global contact identity and original addresses/phone values. |
| Update commitment/log | Internal obligation and next-update intent, plus staff-recorded communication evidence. Draft/copy, recorded communication, provider acceptance, delivery and reply are separate facts. |
| Feedback/revision | Bounded text and reference, author/provenance, deliverable version, revision round, requested change, responsible user and resolution. A request is not automatically additional billable work. |
| Review decision | Immutable decision tied to a specific version, actor, method, timestamp and evidence reference. Staff-recorded external approval is not client authentication or a digital signature. |
| Template/version/install | Immutable manifest and stable installation mapping; preview, explicit application and local override tracking. Install does not activate external actions. |
| Commercial baseline/cost | Conditional consumer of reviewed quote revisions and shared exact-money rules; authorized committed/actual cost evidence. No duplicate quotation, invoice or accounting domain. |

Exact tables, foreign keys, composite constraints, indexes and names are approved through AP-02.1/AP-00.5 before DDL. Keep all JSON/text/recipient/history fields in the privacy inventory. No migration number is assigned by this package.

## Activity and Calendar integration is a release gate

Existing activities use dominant-parent visibility (deal, person, organization, then parentless assignee/participants). Merely linking a private project to an activity does not make activity list/calendar/search/MCP reads enforce the project's permission. A parent organization may be more broadly visible than the project.

Choose and document a project-visibility intersection with the Calendar/activity owner before enabling linked work. Apply it to list, calendar, edit, completion, search, realtime, notification, export and MCP paths, including in-memory batch projections. Parentless activity participants are also potential disclosure recipients and must not bypass project policy. Adding a file or person link does not solve this boundary.

An assignment contains additional outsourced-work semantics; an existing activity remains the canonical internal follow-up/reminder mechanism. Select field/state ownership explicitly. Resolve disagreements with a narrow adapter and tests, not a second task engine. If the cross-surface bridge is not ready, continue pure domain/policy/design work and keep linked production tasks unavailable.

Calendar owns civil-date/instant intent, event revision/ownership, reminder save/recovery and reminder privacy. Client deadlines and freelancer deadlines remain separate. A chosen language does not imply timezone, workweek, holidays or calendar. Date-only deadlines stay civil dates; scheduled actions preserve timezone/DST disambiguation. Configurable workday offsets are previewed; do not invent an Iranian holiday service.

## State and concurrency

Project lifecycle: planned, active, on-hold, completed, canceled, archived. Assignment lifecycle: awaiting acceptance, working, submitted, internal review, changes requested, approved, canceled. Exact allowed transitions, reasons and reopening rules are versioned domain policies with optimistic revision checks.

Use database uniqueness and transaction boundaries for create/install/convert/record operations. Stable idempotency keys identify one intended action. A new intended project or assignment uses an explicit new intent, rather than accidental retries. Preserve past revisions and approvals. Imported history cannot generate current actions.

## Sales handover and saved views

Sales SP-09 owns generic onboarding/adoption/renewal/expansion. Agency owns production projects, deliverables and outsourced assignments. Agree a minimal canonical handover reference and explicit creation command, preserving the original deal result and generic lifecycle. Do not duplicate SP-09 state or its task generator.

Sales owns pipeline lifecycle and the saved-view compatibility layer. Consume its committed query/view services when available. Sharing a saved definition never grants records. Invalid/unsupported filters are visibly unavailable, never silently dropped into a wider query. Financial summaries and counts use the same scoped query policy as displayed rows.

## Automation, connections and communication

The adopted workflow engine has real persistence, published versions, authorization and pg-boss execution. The shared richer CONN credential broker/authority evaluator and EVT durable CRM outbox are still partly design contracts. Inspect exports and owner acceptance before importing an interface.

An agency mutation commits domain data and accepted durable intent atomically through an actual owner-reviewed admission API. Queue nudge failure cannot erase committed intent or report an already committed save as unsaved. Reconciliation, cancellation and current authority belong to existing engines. No new scheduler/outbox/sender is created to fill a missing shared contract.

Internal reminders are the default. A client update remains an internal obligation until a human records communication or an authorized actual effect has evidence. External send requires selected execution actor, recipients, source disclosure authority, qualified connection and explicit activation/intent. Bind the shared effect to the original MAIL attempt. Accepted, partial and unknown remain distinct; retry/cancel/reconnect cannot bypass duplicate protection. A draft or copied message is never marked sent.

WhatsApp conversation references/manual recording can be supported without group synchronization. Automatic capture, templates, consent, provider entitlement and existing-group compatibility are separate connector work, not promised here.

## Authority, privacy and sensitive costs

Reuse existing request/session CSRF, freshness and account-deactivation rules. Capability labels are not grants; every mutation/read/job rechecks current permission. Financial data is separately projected and never sent to ordinary assignment clients in hidden fields. Client and freelancer personas remain internal CRM contacts in this goal.

Privacy owns case authority and lifecycle adapters. Register new tables, writers, queues, caches, JSON/history, templates, logs, exports and external recipients through its versioned registry. Contact/email matching alone does not authorize discovery/export/erasure of a project. Subject relationships and third-party provenance need explicit classification. Use actual restriction/writer fence APIs when available, with clear unsupported gates otherwise. Soft deletion/archive is not called erasure.

External URLs are bounded references with allowed schemes and safe rendering, never server-fetched previews or implicit file/public grants. Existing file references retain their original authorization. No new asset delivery or external download route is part of this module.

## Quotation-dependent finance

The quotation owner is the existing MAIL/regional P1 programme (IG-12/13). Establish an actual immutable quote/version/value contract before enabling a commercial baseline. No invoice preparation or posting is introduced in this goal. Keep source quoted value, approved project budget, committed costs, actual recorded costs, invoiced amounts and paid amounts conceptually distinct; only qualified source values are displayed.

Aggregate within one explicit currency. Preserve canonical IRR and exact selected rial/toman display, including1 IRR=0.1 toman after a German language switch. Do not infer FX, tax, revenue recognition or full company profit. Name figures estimated/tracked project margin and show missing costs/overhead/source coverage. Unknown is not zero. Rate/quantity and negative/zero values follow an explicit reviewed money contract.

## Migration and recovery

Use the platform allocator's live integrated ledger. At the latest reply, platform83/84 are immutable and MAIL 85..93 are reserved.94 is unreserved, not available by assumption. Privacy local83..85, Calendar local83/84 and MAIL local83..88 are divergent histories; they cannot be overlaid or renamed on retained databases.

Use an isolated candidate with exact common snapshots, structural three-way merge, fresh snapshot IDs/prevId links and strictly increasing journal timestamps beyond its accepted head. Preserve SQL-only constraints/triggers in addition to snapshot metadata. Test clean installation, supported baseline upgrade, real owner-combined upgrade and migration rerun. Unsupported retained ledgers remain explicit blockers rather than being rewritten.

Restore matching synthetic database/key/reference snapshots into new owned databases, preserving UUIDs, approval history, template mappings, restrictions and uncertain-send holds. Restored/imported events do not send messages. Reverting app source alone is not database rollback.
