# Agency Projects domain and authority review proposal

31 October 2026. Proposed review input for AP-02.1/AP-02.2/AP-08.1, based on agency base `67eb151f228d9a2866d51266420e9fb915a77739` and the immutable planning package. This document adds no schema, migration, capability grant, route, job or effect. All integrations below remain disabled until actual owner contracts and applicable tests exist.

## Record responsibilities and candidate constraints

Names are conceptual responsibilities, not allocated SQL names or invented exports. New record IDs use existing UUID conventions; canonical CRM/auth IDs are retained unchanged.

| Candidate record | Responsibilities and reviewed constraints needed |
| --- | --- |
| Project | UUID, bounded title, internal owner FK to `users.id`, lifecycle, safe nonnegative revision, explicit nullable customer person/organization/deal UUID FKs, date intent and archive metadata. Multiple intentional projects may reference the same deal. Never write deal won/lost status or timestamps. |
| Project membership | Project/user FKs, explicit internal role and unique project/user pair; membership grants only reviewed project actions within CRM ceilings. No external contact, email match or assignee conversion creates membership. |
| Deliverable | Project FK, bounded name, identified external version reference and revision. Composite identity supports same-project child constraints. References grant no file/public access and trigger no fetch. |
| Assignment | Project FK, optional same-project deliverable composite FK, freelancer FK to `persons.id`, accountable producer FK to `users.id`, bounded brief/blocker, lifecycle/revision, separate internal/client date intent. Freelancer person and producer user remain different concepts even with identical email/name. |
| Canonical activity binding | Stable project/assignment-or-commitment/activity mapping with uniqueness for one logical follow-up. Activity FK to `activities.id`; cross-project links rejected. No second reminder/task copy or automatic production-state advance from activity completion. |
| Communication preference and commitment | Project/contact-role/channel/cadence, accountable user, explicit due intent and bounded conversation reference; nullable means unknown/unscheduled, not default weekly or inferred WhatsApp history. Commitment revisions preserve original promise and change reasons. |
| Communication evidence | Append-only staff actor, subject/reference, method, occurred-at and recording time, stable logical request key and corrections. Draft/copy, staff-recorded communication, provider acceptance, delivery and reply remain distinct. No credential/provider payload copy. |
| Feedback, change request and revision round | Project/deliverable/version consistency, bounded plain text/reference, explicit author/provenance, assigned internal owner and source round. Unknown included rounds differ from zero; a request creates no charge. Canonical activity conversion deduplicates one intent. |
| Review decision | Immutable exact deliverable/version, internal recording actor, decision/method/time and bounded evidence reference. New version requires a new decision. Staff-recorded client approval is never authenticated external action or signature. |
| Template/version/install | Immutable bounded supported manifest, referential/cycle validation, stable template version and unique install-intent mappings; preserve overrides and completed evidence. No real recipients/secrets. Install and effect activation are separate actions. |
| Transition/audit/request receipts | Immutable actor/revision/reason/correlation, unique logical request identity and payload binding. No success receipt on rollback; stale revision conflicts. Sensitive free text stays out of routine audit diagnostics. |
| Commercial baseline and cost evidence | Future reference to an owner-approved immutable quotation revision, per-currency exact values and restricted cost evidence. No DDL until the quotation/cost contract exists. No invoice, payment, FX or accounting model. |

Decide FK deletion/retention with Privacy before DDL: do not cascade-delete approvals/history or erase third-party evidence merely because a contact is deleted. Revoked/archived references must stop new work and retain only policy-permitted history. Uniqueness and conditional revision updates require real PostgreSQL tests, not pure-policy success claims.

Proposed bounds for owner review: title 255 Unicode characters, brief 20,000, feedback 10,000, reason 2,000 and external reference 2,048. Validate unknown keys, URL schemes and total manifest size at the boundary; preserve raw names/addresses and meaningful Unicode. These numbers are proposals, not implemented schemas or approved product limits.

## Proposed access truth table

Native request/session/CSRF/account policy is mandatory before domain access. These columns describe required decisions, not existing permission names. A role/capability label or client boolean never establishes authority.

| Current actor/resource condition | Project read | Project mutation/assignment | Financial data | Effects |
| --- | --- | --- | --- | --- |
| No live native actor, inactive/removed staff or failed native request policy | Deny | Deny | Deny | Deny |
| Module unavailable/disabled | No enabled agency journey; history handling requires owner-approved read policy | Deny new work | Deny enabled finance journey | Deny, including historical replay |
| Linked CRM parent hidden/missing/archived under canonical policy | Deny project/reference disclosure; indistinguishable missing response | Deny | Deny | Deny |
| CRM ceiling passes but no project membership/read grant | Deny | Deny | Deny | Deny |
| Project reader only | Minimal permitted DTO | Deny | Absent from DTO unless separately authorized | Deny |
| Project editor/producer with current narrow grant | Permitted DTO | Only scoped commands, references and expected revision; terminal parent fences new work | Separate grant required; never ordinary assignment fields | No implicit external effect |
| Separately authorized financial reader/writer | Same project ceiling | No additional production authority | Only permitted financial projection/commands and qualified provenance | No financial posting/payment |
| Native administrator or delegated manager | Use agreed project/CRM policy; no ad hoc role-name bypass | Recheck current policy and command constraints | Explicit reviewed financial rule | Explicit shared admission and current authority |

Open decision: whether all linked customer/deal parents gate the entire project or some are separately redacted optional references. Default proposed behavior is an intersection for authoritative customer/deal parents, with narrower contact projections. Owners must approve consistent direct/list/count/search/export/cache/realtime/MCP semantics before exposure.

Actual base APIs: `src/features/auth/session.ts`, `src/server/hydrateActor.ts`, `src/features/permissions/{can,canSee,referenceCheck}.ts`, `src/types/entityRef.ts`, `src/types/session.ts`. Current `VisibleRecord` and `Action` have no project variant. Do not cast a project to an activity or extend shared permission registries without a reviewed patch. `assertReferenceVisible` protects canonical CRM/user references; it is not project authority.

## Activity/state/date ownership proposal for Calendar review

Agency owns production lifecycle, acceptance provenance, briefs, original commitments and deliverable review. Calendar owns canonical activity follow-up state, civil-date/instant intent, scheduling generations and reminder delivery. A command adapter applies any agreed linked changes atomically, with current project authority; activity `done` never means freelancer acceptance, deliverable approval or external message sent.

Propose one canonical activity for each current internal follow-up; agency stores only the binding and production facts. Choose explicitly which command may update the canonical due intent and how rescheduling preserves original promise history. No independent mutable agency reminder/date copy should compete with Calendar.

Current `src/features/activities/visibility.ts` resolves dominant deal/person/organization parent, then parentless assignee/participants. This alone does not enforce private-project visibility. Require project intersection on direct reads, lists/calendar batch projections, edit/complete, search, feeds, notification, export, realtime and MCP. Parentless participants and activity assignee exceptions cannot bypass that intersection. Keep linked production work disabled until Calendar approves the implementation and denial tests on all surfaces.

## Proposed store/writer/subject inventory for Privacy review

No registration or lifecycle support is claimed by this table. Each new physical table, JSON/history field, writer, cache and recipient must receive an actual owner-reviewed registry boundary and capability evidence before enabled persistence.

| Boundary group | Writers/readers to register | Explicit subjects and limits |
| --- | --- | --- |
| Project/membership/deliverable | Create/edit/archive/reopen, role change, authorized queries and eventual import | Internal owner/member and explicitly linked contact relationships; a project is not wholly one contact's personal data. |
| Assignment/profile/brief/dependency | Contact selection, producer reassignment, transition, dependency edit, template install | Freelancer person, internal producer, author and mentioned third parties remain distinct; shared email is not identity. Rates isolated. |
| Preference/commitment/communication evidence | Schedule/snooze/log/correct, reminder admission and reviewed communication draft | Relevant client contact, recorder, assignee and explicit recipient binding; conversation reference does not authorize conversation capture. |
| Feedback/round/decision/version history | Feedback/create-change/record-approval/reopen | External source/author, staff recorder, internal reviewer and people mentioned in text; third-party redaction required. |
| Template/version/install/mapping | Author, preview, install, reapply, override, import | Author and mapped internal users/contacts; no real recipient defaults in starter manifests. |
| Audit/request receipts and diagnostics | Every mutation, retry/reconciliation and administrative recovery | Minimal actor/correlation provenance; no brief/address/fee/raw payload in routine logs. Request payloads and stored failures also require inventory. |
| Jobs/admission/notifications/realtime | Accepted canonical engines, scoped subscriptions and last-moment authority checks | Actor, subject reference and authorized recipient; register copied summaries, payloads, retry history and delivery records. |
| Caches/search/saved views/export/import/backup | Scoped read projection, cache invalidation, index update, import mapping, export download, restore | No graph-wide subject inference. Register serialized DTOs, browser/query caches, generated files, backups and recipient copies explicitly. |
| Conditional commercial source/cost/history | Quotation consumer and separately authorized cost writers | Quote/source actor and freelancer cost subjects; financial capability plus third-party disclosure policy. Unavailable until owner contract. |

Restriction, erasure, retention, holds and export must use actual Privacy APIs. Archive is not erasure. Unsupported operation/fence support stays explicitly unavailable. Restored/imported history never authorizes a current external action.

## Owner decisions needed before enabled persistence

1. Calendar: canonical activity mapping, allowed state/date commands, project visibility intersection and cancellation/recovery generations.
2. Sales: minimal explicit SP-09 handover reference, multiple-project intent and preserved CRM acquisition results; no duplicate generic post-sale lifecycle.
3. Platform: accepted combined lineage, real capability/admission API, reviewed permission/error extension, then exact migration slots after schema review. No number, including 94, is allocated here.
4. Privacy: store/writer IDs, explicit subject bindings, restriction fences, third-party export/redaction and retention/deletion choices.
5. MAIL: reviewed draft/attempt binding, certainty and retry/cancellation semantics; quotation/cost contract remains a later finance gate.
6. Settings: committed current presentation/adapters/catalog adoption. Shared changes remain narrow and owner-reviewed.

Until those contracts exist, continue pure lifecycle/template validation and source-local UI design without DDL, linked tasks, provider effects or financial activation. This proposal does not close the dependent implementation or acceptance tasks.
