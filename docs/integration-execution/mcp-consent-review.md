# AISEC-002: granular consent catalog and review contract

Design/source review date: 2026-11-01. Executable source cut:
`643738bdba1e7aba8b414a98dc0b6cdc9c17a361`. Exact acceptance: “Specify read, write, draft
and approved outbound capabilities with understandable FA/DE/EN descriptions.” Verification is
consent review. AISEC-001 is the prerequisite: root accepted the corrected operation inventory
in `23c1a85`, normalized its CSV to LF in `5508dc2`, and recorded its closure in `423dd15`.
Neither this catalog nor the approved vocabulary addition closes AISEC-002, enables a scoped
client or changes a grant.

[mcp-consent-capabilities.csv](mcp-consent-capabilities.csv) supplies **37 exact names**, each
with FA-first and natural DE/EN label, description, risk, resource/ownership binding and approval
copy. Technical columns identify current tool mappings, indirect effects, required intersections,
policy and provenance. Every row describes a **proposed granular grant contract**. Current MCP
has no enforced scope vocabulary: `auth.ts:34-40` sets empty `scopes`, and `server.ts:9-12`
registers both tool groups. Existing grants remain broad role-based access and must be labelled
that way. An annotation such as readOnlyHint is not consent enforcement.

## Single canonical vocabulary and finite expansion

The source of names is [ARCH-003](architecture-identities-authority.md), section 4, including
its root-approved **dated additive v1.1 revision**. The v1 history is retained. This catalog
uses no provider OAuth scope, wildcard, display name or parallel authorization namespace.

| Derivation | Enumerated names | Current MCP relationship |
| --- | --- | --- |
| v1 CRM read domains, 7 | `crm.deals.read`, `crm.leads.read`, `crm.persons.read`, `crm.organizations.read`, `crm.activities.read`, `crm.pipelines.read`, `crm.stats.read` | Existing read tools; the granular grant ceiling and field/resource projections are future enforcement. |
| v1 ordinary write domains, 5 | `crm.deals.write`, `crm.leads.write`, `crm.persons.write`, `crm.organizations.write`, `crm.activities.write` | Existing mutations, subject to exact action checks and the indirect effects below. No implicit read/transfer/archive/delete/outbound right. |
| Conditional distinct mutations, 5 | `crm.deals.transfer`, `crm.leads.transfer`, `crm.persons.transfer`, `crm.organizations.transfer`, `crm.leads.archive` | Finite supported branches only: create_deal owner override; create/update_lead owner assignment; update_person/update_organization ownership changes; archive_lead archive/restore. `update_deal` is not a transfer endpoint. Native authority checks and scoped interception still need review/enforcement. |
| Approved v1.1 addition, 1 | `crm.notes.write` | Creation-only add_note mapping; no notes read/update/delete capability is introduced. |
| v1 mail, 3 | `mail.messages.read`, `mail.drafts.read`, `mail.drafts.write` | Existing reads and local unsent draft mutations. Draft deletion is explicitly disclosed within the draft-write policy. |
| v1 calendar, 2 | `calendar.events.read`, `calendar.events.write` | No calendar-resource MCP tools today. CRM activities are not an alias for selected provider calendars. |
| v1 outbound, 4 | `outbound.slack.post`, `outbound.mail.send`, `outbound.calendar.invite`, `outbound.conference.create` | No direct send/post/invite/conference MCP tool. Activity creation can already cause a derived reminder email; this is not an arbitrary-recipient send endpoint. Granular outbound enforcement is future work. |
| v1 resource management, 1 | `connection.resources.select` | No resource-selection MCP tool today. Selection does not grant resource use or disclosure. |
| v1 workflow, 6 | `workflow.view`, `workflow.create`, `workflow.edit`, `workflow.publish`, `workflow.run`, `workflow.cancel` | Local workflow services exist, but none of these MCP operations is currently registered. Publication never adds node/send authority. |
| v1 administration, 3 | `admin.connections.manage`, `admin.grants.manage`, `admin.apps.manage` | No such MCP tools today. Require current administrator plus explicit operation authority; the first private SDK profile excludes admin requests. |

The conditional family does **not** generate every delete/archive/transfer combination. Unsupported
combinations are absent and deny in a new scoped profile; adding one later requires canonical
review and consent/version policy. The four transfer rows describe only the existing supported
owner-assignment branches above, not new owner-change endpoints. Contact creation fixes ownership
to the actor; activity assignment is not silently renamed ownership transfer.

The 37 rows comprise 21 direct/conditional current-tool mappings, one indirect-only outbound
mapping (`outbound.mail.send` via create_activity), and 15 with no MCP path today. All 35 domain
tool names are accounted for through the AISEC-001 inventory; a tool can require several rows.
HTTP/OAuth/protocol controls are adjacent infrastructure, not extra CRM capabilities or tools.

## Notes: the v1.1 addition is deliberately narrow

Root approved one design name after independent source confirmation:
`crm.notes.write`, initially for **add_note creation only**. `notesSchemas.ts:5-10` accepts a
deal/person/organization/lead parent, UUID, body and pinned state. `notesRepo.ts:40-76` checks
`assertReferenceVisible` and inserts actor authorId. It has **no parent-edit or separate note-create
flag**. Do not claim such a native gate exists or invent a runtime permission flag in this design.

New scoped admission must additionally require the exact capability and explicitly selected
parent kind plus immutable ID, current parent visibility and the authenticated actor as author.
No wildcard parent, supplied author ID, arbitrary update/delete or general parent mutation is
permitted. The current handler returns the inserted note; future write-only scoped output is a
minimal creation receipt, not independent access to stored note fields.

No current read tool returns collaboration-note DTOs. get_activity's own free-text `note` is an
activity field governed by its read/projection policy; it is not a collaboration-note endpoint.
No `crm.notes.read` name is added merely for the creation echo. If a future read tool embeds
collaboration-note content, that disclosure needs a separately reviewed canonical/projection
decision and consent before exposure; hiding the content in another response cannot bypass it.

Lead conversion copies source notes internally (`convertCarryOver.ts:24-31`) and returns a deal
ID, not note bodies. It remains a distinct `crm.leads.write` plus `crm.deals.write` composite
with checked source/destination parents and the per-child/mailbox ownership and disclosure
policy below. It does not acquire general note authority or become an arbitrary add_note operation.

## Minimum consent and capability composition

New clients start with **no capabilities and an empty resource selection**. A use-case shortcut
may propose an exact set for review; it never selects all future additions automatically.

| Intended use | Smallest explicit set and binding |
| --- | --- |
| Read one CRM domain | That one `crm.<domain>.read` name enumerated above, selected records/pipelines and an allowed field projection. No write, mail or outbound. For a meeting-preparation example, separately review only the needed person/deal/activity read rows. |
| Search | Current searchAll reads deals, people, organizations and leads (`search/query.ts:69-167`). A new narrow client needs per-domain search projection, or the unchanged composite requires all four corresponding read rows. Do not quietly add four domains to satisfy a one-domain request. |
| Make an unsent draft | `mail.drafts.write` with one explicit owner-bound mailbox and checked parent links. Add `mail.drafts.read` only to read existing draft content; CRM/mail read rows only for the actual source context used. A write-only result is a minimal receipt. No send/schedule permission. |
| Create a local activity | `crm.activities.write` plus exact domain/reference/assignment rules. The existing reminder-to-email chain below means a scoped activation also needs the derived-outbound policy; a local-write label cannot make that path effect-free. |
| Convert a lead | `crm.leads.write` plus `crm.deals.write`, exact source/destination/pipeline resources and current permissions/visibility, plus the per-child/mailbox ownership and destination-disclosure gates below. Current G7 includes target-pipeline and child/mailbox policy gaps; missing authority blocks scoped conversion. Two write names alone cannot enable it. |
| Change an owner | The relevant ordinary write plus its exact transfer row, active selected target user, current native transfer authority and before/after visibility checks. Returning newly invisible row fields is forbidden; use a receipt. |
| Archive or restore a lead | Separate `crm.leads.archive`; it is not ordinary lead write. Current visibility-only native admission is inventory G4 and needs an explicit reviewed action-authority decision before scoped enablement. |
| Send/post/invite/create a conference | Exact outbound row, authorized source disclosure, selected connection/account/destination and a separately approved effect or pinned rule policy. There is no general outbound wildcard or direct MCP tool today. |
| Publish or run a workflow | Exact workflow row, selected immutable workflow/version/run and execution actor. Each node independently needs its domain/resource/outbound authority. A publish or run grant is not send consent. |

Conversion is a reviewed composite, not an unrestricted history export. The current helper
copies collaboration notes, activities, guests and participants, and adds a deal link to eligible
source email threads while retaining the lead link (`convertCarryOver.ts:18-105`). The source
lead is archived/stamped by conversion. The destination audience can differ from the source
lead's audience even though the MCP response returns only a deal ID. Before scoped conversion
activation, require current source-lead and destination-deal/pipeline admission plus a checked
policy for **each** copied child and linked thread: current visibility, child ownership/assignment,
mailbox ownership and personal/shared-mail rules, allowed field projection and destination
audience/disclosure. Missing child or mailbox disclosure authority blocks the scoped conversion;
it cannot fall back to native broad access or silently omit a child to bypass the transaction's
reviewed semantics. G7 records both missing target-pipeline visibility and missing per-child/mailbox
policy in the current carry-over helper. These are future activation gates, not existing checks.
This composition creates no `crm.notes.read` scope and no blanket mail-read grant; copying a
specific permitted child under the reviewed composite does not grant arbitrary content queries.

Writes never imply reads. For responses containing stored row fields, intersect the matching
read capability, current visibility and projection; otherwise return a minimal receipt. Technical
authentication bookkeeping such as access-token lastUsedAt is separate from business mutation
authority and must not be described as an external/provider effect.

Personal resources remain owner-bound; shared use requires explicit delegated use and an eligible
administrator custodian under ARCH A2. Admin connection management does not expose a private
mailbox. Grant constraints use immutable client/actor/connection/account/calendar/channel/parent
IDs and field projections; names are presentation only. Empty means none. The current draft
MCP path derives the actor's own Gmail mailbox and has no account selector: a future selected
account cannot silently become “whichever mailbox is default”. Current G5 existence-only draft
link checks and sharing semantics must be reconciled before claiming full selected-parent privacy.

## Derived reminder emails: actual source and proposed outbound ceiling

The inspected current path is conditional but real source, **not** a direct MCP email-send tool:

```text
create_activity
  → activities/repo.ts:220 scheduleReminder
  → activities/reminders.ts:11-12,30,56 job {activityId}
  → notifications/wire.ts:84-104 notifyActivityReminder, actorId:null
  → wire.ts:13-23 deliver / emailDispatch.ts:25 job {notificationId}
  → notifications/email/job.ts:27,63-107 current recipient/preferences/visibility/mailbox gates
  → job.ts:137-143 default sendGmail
```

Current recipient preferences, current visibility and mailbox/runtime checks can prevent delivery.
They are not provenance for the initiating MCP client's approval. The queued records carry neither
origin client/grant nor capability/approval revision; the reminder's actorId is null. Therefore the
existing runtime cannot distinguish delegated-origin reminders from native reminders by those
fields. Do not infer origin from the activity owner/assignee or treat a selected resource as send
consent. Do not claim that `crm.activities.write` currently excludes all external communication.

The **proposed scoped model**, required before enabling a narrow activity-write grant, is:

1. Persist typed origin with the activity/reminder intent and preserve it through notification and
   email jobs: principal kind, immutable originating client/grant/actor IDs, grant/capability-policy
   revision, source activity/parent identity, selected resource constraints and simulation/effect
   mode. Queue payloads may keep IDs only, but the referenced durable origin must be resolvable.
   No worker reconstructs origin from a mutable owner, a display name or ambient admin state.
2. A delegated-origin email requires the origin's exact `outbound.mail.send` ceiling **and** a
   bounded recipient-owned notification authorization, current recipient preferences/visibility
   and eligible mailbox. This does not grant the originating client arbitrary send/read access
   to the recipient's private mailbox. The broker's distinct recipient-notification authority
   must bind the fixed notification purpose/template, permitted fields, recipient and destination.
   An ordinary “email notifications enabled” preference alone cannot widen the origin grant.
3. Record effect approval as either a reviewed single effect or a specific pinned reminder policy
   that approves recipient set, template/field projection, timing and limits. Store its identity
   and revision. Broad capability consent alone, publication and activity creation do not approve
   arbitrary message bodies, accounts or recipients. No extra capability name is invented here.
4. Before each derived attempt, re-evaluate origin authority, recipient notification authorization,
   connection lifecycle, selection and approved disclosure. A missing/expired/revoked origin or
   approval blocks the derived email; it cannot fall back to a trusted native principal. A future
   scoped write without outbound authority may still create the permitted local activity and
   internal reminder, with a truthful blocked-email result, under the reviewed domain policy.
5. Native first-party reminders retain their **separately typed** authenticated/policy origin and
   recipient checks. Do not disable unrelated native reminders to simulate delegated-scope
   enforcement. Untyped legacy jobs need an explicit migration/admission policy; they must not
   silently become either newly approved delegated effects or a universal trusted fallback.
6. Simulation/clone contexts have external effects disabled. Real effects use the immutable,
   bounded prepared business request, provenance, stable identity and retry/reconciliation rules
   already defined in ARCH-006/007. Preserve the original execution context; do not rewrite origin
   IDs. Unknown acceptance never authorizes blind resend or a claim that nothing was sent.

This is future persistence/dispatch/evaluator work, not implemented enforcement or live-provider
qualification. No database, job, reminder preference or runtime path was changed by this catalog.
Local synthetic work remains independent of external account/domain approval.

## Versioning, widening and truthful consent

- Present v1.1 labels with exact capability IDs, effective resources, client registration identity
  and self-reported identity status. A client display name, provider mark or disabled DCR switch
  is not a verified publisher or administrator allowlist.
- Store the reviewed vocabulary version, exact capability set, immutable resource selections,
  projection, operation/schema version and consent/approval-policy revision with a new grant.
  Unknown names/versions deny in that future evaluator. Current OAuth does not implement this
  merely because the CSV exists; supported wire encoding and metadata remain separate work.
- Widening actions, resources, recipients, fields or app/runtime requirements requires explicit
  review and a new consented revision before use. New catalog rows are never added to old grants.
  A changed domain/client identity needs the corresponding new registration/grant policy.
  A newly introduced send action or purpose needs renewed consent before use even if its
  capability name already appears in a prior catalog; this is not advance approval of future
  functionality.
- Tightened/revoked authority takes effect at admission/execution checks and can hold pending
  work. Reconsent must not silently release previously blocked work. Preserve reviewed prepared
  payloads; changed content/destination is a new reviewed effect with duplicate risk explained.
- Existing broad grants stay accurately labelled until a tested migration/reconsent path exists.
  The v1.1 notes addition neither narrows nor widens them at runtime. Do not advertise existing
  grants as read-only or pretend historical reminder emails had recorded outbound approval.

All trilingual placeholders must be safe, localized presentation derived from actor-visible DTOs.
`{resources}` is a display summary backed by selected immutable IDs; `{owner}` is an authorized
target user; `{account}`, `{connection}` and `{destination}` disclose no credentials or foreign
private mailbox data; `{workflow}`/`{version}` identify the actual pinned workflow. Direction
isolation belongs in the FA rendering layer. Locale, calendar, digits and zone do not change an
identity key, capability ID, selected resource or authored recurrence rule.

## Review and verification boundary

The canonical v1.1 addition is root-approved design. The corrected CSV and composition
contract passed independent source/copy consent review by queue_audit on 1 November 2026
against the accepted AISEC-001 inventory, with no remaining blocking findings. Root retains
task-acceptance and closure authority. The per-row mappings expose current authority/privacy
gaps instead of declaring them fixed. New scoped discovery must
omit ungranted operations **and** direct invocation must enforce the same ceiling, including
internal composite/derived effects. A hidden tool alone is not enforcement.

Bounded Python artifact checks on 1 November 2026 passed: strict CSV parsing with LF line
endings; 37 unique exact capability IDs across 27 columns; 555 nonempty localized fields;
185 matching placeholder comparisons across FA/DE/EN; exact source-cut/version values;
all 35 inventory domain tools mapped; no em dash or trailing whitespace. The row statuses
are 21 current direct/conditional tool mappings, 1 indirect-only outbound path and 15 future
rows without a registered MCP tool. These are artifact checks, not executable authorization
or provider tests.

Root copy review corrections are applied: activity reminder risk and approval use plain
user wording while the technical columns preserve origin ceilings/provenance; email action
copy does not grant future functionality in advance; new actions/purposes require reconsent;
and mailbox limits explicitly concern the originating client, while the notification worker
still needs the separate bounded recipient-owned authority described above. Independent
review also corrected English transfer labels/descriptions to refer to record owners, FA read
risks to mean nondisclosure rather than deletion, German authenticated note-author wording, and
trilingual conversion history/mail-link audience disclosure. The conversion composition now
explicitly blocks scoped activation without per-child/mailbox disclosure authority. The final
independent review passed these corrections, the exact 37-name set, source-tool mapping,
trilingual fields/placeholders, retained v1 history and derived-email boundaries. This does
not qualify runtime enforcement or AISEC-003.

Only bounded source/CSV/text checks are permitted in this task. No runtime, DDL, ledger, tracker,
external write, provider grant, test, Bun, PostgreSQL, compiler, lint, build, install or browser
action is part of this delivery. The artifact is not all-future-screens implementation, a
native-speaker qualification, AISEC-001 closure or AISEC-002 closure.
