# Sales / Agency reference and handover review

31 October 2026. Sales committed candidate:
`c655b8e3aa0d9aada5ac3c533bef13688b8ec700`, branch
`codex/sales-platform-20261031`. Agency implementation chat is
`01a192a3-dba9-7a52-80b6-43f384542fe6`; it retains its isolated source/modules.
This is a read-only source review and proposed seam, not runtime adoption or
approval on behalf of another owner. The Agency source may advance independently.

## Direction and existing availability

The inspected Agency proposal preserves canonical CRM/auth UUIDs, allows several
intentional production projects per opportunity, and does not write acquisition
won/lost fields. This aligns with Sales SP-09's linked post-sale records and
independent acquisition/renewal histories. Generic onboarding/adoption/renewal
and expansion remain Sales-owned; production projects/deliverables/assignments
remain Agency-owned. Neither domain should start a second generic milestone,
automation, sender or authentication engine.

SP-09 handover records and exports are not implemented in this Sales candidate.
The Agency proposal and pure policies are not a persistent handover adapter.
At inspection, Agency HEAD was `67eb151f228d9a2866d51266420e9fb915a77739`, with
proposal/domain work untracked. Recheck a committed owner handoff before adoption.
The inspected copies of native reference/permission/actor/session primitives and
`EntityRef` were byte-identical across the two candidates.

Sources inspected:

- Agency `docs/agency-projects/domain-review-proposal.md`, lines 7-12, 20-21,
  30-45 and 49-53.
- Agency `docs/agency-projects/baseline-plan/ARCHITECTURE.md`, lines 41-49.
- Agency `src/features/agency-projects/projectSchemas.ts`, lines 23-27;
  `projectLifecycle.ts`, lines 25-33; `projectLifecycle.test.ts`, lines 149-158;
  `docs/agency-projects/project-policy-v1.md`, line 20.
- Sales `approved/PROJECTS.md`, SP-09, and the canonical
  `src/features/permissions/referenceCheck.ts`, `can.ts`, `canSee.ts` and native
  request/session services.

## Proposed creation-intent seam

Keep existing opportunity and CRM customer UUIDs as explicit references. Several
deliberate projects may reference one deal. A stable **creation intent ID**, not
`dealId` alone, must identify one intended project creation. An identical retry
returns that intent's original result after current authorization; reuse with a
different canonical reference or payload conflicts. Bind the receipt to its
payload/version and retain enough provenance to diagnose a retry.

Stale-revision rejection is useful concurrency evidence, but it is not durable
create-intent idempotency. The inspected pure command schema/receipt did not yet
contain a request identity or persistent receipt store; its existing replay test
only establishes stale-revision refusal. Do not label that a completed seam.

An accepted handover may identify source opportunity, customer, source revision,
receiving owner and accepted intent/version, with a permitted evidence snapshot.
This is a proposed shape, not a live DTO. Later source corrections must not
silently rewrite accepted evidence or acquisition outcome.

## Parent and project authority intersection

Decide which deal/customer references are authoritative whole-project gates and
which optional stakeholder references are separately redacted. Validate explicit
canonical consistency; name/email similarity must not infer a link. Project
membership or a freelancer contact never grants CRM, mailbox, file or auth access.

`can()` or `canSee()` alone is insufficient: they do not load absent/deleted
parents or reject archived pipelines. The existing canonical
`assertReferenceVisible` rejects deleted deals and absent/archived pipelines
before record visibility, including for administrators. Native actor/session
validation is also required. Use an owner-reviewed adapter around these actual
primitives; do not cast an Agency project into a CRM permission record.

A canonical activity link creates another disclosure surface. Existing parent
and assignee permissions do not themselves establish project authority. Keep
project-linked activities unavailable until direct read, list, calendar, search,
export, realtime, notifications and MCP enforce the same intersection. Returning
an old receipt/result must also recheck current authority before revealing any
project or canonical-reference details.

## Current coordination and qualification ceiling

The Sales candidate includes opt-in pipeline lifecycle and unavailable saved-view
handling. Its PostgreSQL batch passed 239 tests across 50 files; its full unit
batch passed 6020 tests across 966 files. Both have finished. The task-owned
browser preview and PostgreSQL 55461 are stopped after recovery evidence. The
finite production build and worker bundles passed. These observations are
dated, not a lease on shared resources or a claim of whole-programme acceptance.

No migration number, shared DDL, reciprocal acceptance, provider action or
production exposure follows from this review. Use the existing platform allocator
and actual qualified WF/CONN/EVT/MAIL exports. The complete Sales goal remains
active; this review does not take over the Agency programme.
