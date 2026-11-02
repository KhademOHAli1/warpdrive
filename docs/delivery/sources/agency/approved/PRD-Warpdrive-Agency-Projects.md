# PRD: Warpdrive Agency Projects

Prepared 31 October 2026, Europe/Berlin. Status: implementation requested by Ali after this coordinated plan, with execution delegated to a new chat and goal. This is a proposed solution derived from one prospective agency's feedback, not validated market research or an implementation acceptance claim.

## 1. Summary

Build an optional internal project-coordination module for creative agencies that outsource production. Link customer/deal history to client update commitments, freelancer assignments, production templates and revision records while customers keep their existing communication channels. Add quotation-dependent budgets later through the existing financial workstream, preserving Warpdrive's current UI and Farsi/German/English behavior.

## 2. Contacts and ownership

| Owner | Responsibility |
| --- | --- |
| Ali | Product priorities, actual agency access/feedback and consequential external actions. Current instruction authorizes the plan and routine implementation handoff. |
| Agency implementation chat | Agency domain, policies, project UI, task register, tests and owner-coordinated delivery. |
| Sales owner | CRM/pipeline/shared-view and generic SP-09 post-sale handover contracts. |
| Integration/MAIL owners | Shared WF/CONN/EVT and migration allocation; native mail attempts/delivery and IG-12/13 quotation source. |
| Calendar/Settings owners | Activity/date/reminder policy and current-shell settings/UI extension points. |
| Privacy owner | Versioned data inventory, case/lifecycle authority and reviewed adapters. |

Specific chat IDs, source paths and replies are in COORDINATION.md. These are functional responsibilities, not invented staff assignments or reviewer sign-offs.

## 3. Background

The prospective customer reports varied client communication preferences, existing CEO/project group chats, forgotten client updates, freelancer coordination overhead and slow billing preparation. They see clear internal operational value and are uncertain about a sales-led CRM pitch. The transcription includes uncertain terms; the competitor name is not a verified requirement.

Warpdrive has CRM customers/contacts/deals, activities, calendar/reminders, notifications, notes, files, permissions, native authentication and localized UI foundations. Independent mail, integrations/workflows, Sales lifecycle, Privacy and Settings work are active in separate branches/chats. All of those investments must be preserved. A complete agency production model, safe freelancer workflow and external project portal are not existing accepted features.

Existing source makes the proposed module feasible, but shared activity visibility, durable reminders, data lifecycle, integration admission and migration histories require explicit coordination. Several important APIs remain proposals. The module can start with pure policies/domain contracts/current-shell UI work while those interfaces mature.

## 4. Objective and measurable outcomes

Business benefit: test whether an agency-specific workflow reduces coordination effort and missed commitments, giving the product a concrete adoption use case. Customer benefit: each active project has an accountable internal owner, visible next client update and clear outsourced-work status.

Release key results, measured on the exact candidate at each release gate:

1. Every enabled new UI journey and critical recovery state is exercised in FA/DE/EN, with Persian calendar/digits, German long text, RTL/LTR, mobile and keyboard cases. Catalog checks alone do not close this result.
2. All defined unauthorized read/write/count/export/job/MCP/realtime cases deny consistently, including separate financial fields and project-linked activities. No external contact is implicitly granted an account or access.
3. Repeated/concurrent logical requests create one intended project/template instance/task/communication effect in the declared tests. Queue interruption and worker restart preserve intent without blind external resend.
4. Supported clean install/upgrade/fresh restore preserve original CRM/auth/workflow/mail identities, approvals, restrictions and effect certainty; no historical imported/restored action dispatches automatically.

Operational improvement targets require a later authorized agency baseline. Measure missed updates, producer coordination time and revision turnaround before proposing numeric savings. Release gates provide relative milestones; no staffing plan, budget or calendar delivery commitment has been agreed.

## 5. Problem segments

- Account managers who owe clients updates across different channels and need a clear next commitment.
- Producers who coordinate external modelers, editors and designers while retaining internal review responsibility.
- Agency owners who need visibility into stalled work and, later, source-qualified project economics.

Freelancers and clients remain external contacts in the first implementation. External user accounts are not required to obtain the internal coordination benefit.

## 6. Value propositions

| Job | Proposed value | Evidence/validation |
| --- | --- | --- |
| Remember client commitments | A daily scoped queue of updates due, responsible staff and blockers. | Walk through projects with different contact roles/channels; later compare actual missed commitments. |
| Coordinate outsourced work | A focused assignment workflow linking brief, freelancer, internal owner, deadline and review. | Modeling/video synthetic scenarios first; actual agency workflow feedback later. |
| Repeat successful delivery processes | Versioned modeling/video/campaign templates with preview and local overrides. | Replay/interruption tests and observed setup usability. |
| Resolve feedback and revisions | Explicit change requests, version-specific decisions and included/proposed scope. | Conflicting-reviewer, new-version and stale-write journeys. |
| Understand project economics | Quotation-linked commercial baseline plus permitted committed/actual costs and bounded margin. | Accepted quotation contract and exact hand-calculated fixtures; no invented profit data. |

The proposed differentiation is connected CRM and internal production context with natural Farsi/German workflows. It is a hypothesis, not a verified competitor advantage. Investment is high in coordination/reliability/localization, moderate in text/reference review and deliberately absent in asset hosting, portals and invoice issuance in this goal.

## 7. Solution

### P0: projects, commitments and freelancer coordination

Create internal projects explicitly linked to canonical CRM records, keeping deal acquisition results separate. Provide project owner/stage, deliverables, internal/client deadlines, project-safe activity bindings and scoped daily queues.

Record contact roles/channel/update cadence per project. Show last recorded update rather than claiming complete conversation visibility. Marking a reminder complete, creating a draft or copying a message is not evidence of sending. Manual communication records retain staff provenance.

Coordinate freelancers as contacts with skills/declared availability, accountable internal producers, briefs, acceptance/progress records, deadlines, blockers and review states. Staff can record externally received acceptance without impersonating freelancer authentication. Use the existing activity/scheduling engines through reviewed boundaries.

### P1: templates, revisions and qualified automation

Provide three editable starter templates with immutable versions, explicit role/deadline preview, replay-safe installation and retained overrides. Templates create reviewed task intent; installing one does not activate external effects.

Record feedback/change requests and version references without hosting files. Track revision rounds and proposed scope changes. Decisions identify exact versions and the actor/method/evidence; a staff-recorded client decision is not an electronic signature. New versions do not inherit old approval silently.

Integrate through actual WF/CONN/EVT/MAIL exports as they qualify. Default to internal reminders and reviewed drafts. Preserve current consent, actor/record authority, connection generations and accepted/partial/unknown mail outcomes. No duplicate engine/sender is introduced to fill a missing shared contract.

### Conditional P1: project economics

Consume an owner-reviewed quotation/cost contract. Preserve an approved commercial baseline and revisions; record committed and actual costs separately; display currency-separated estimated/tracked project margin with coverage limitations. Financial permission is narrower than project visibility. Unknown source/cost is not zero; no FX, tax posting, invoice issuance or company-profit claim is inferred.

### UI, security and lifecycle

Keep the current sidebar, page patterns, Inter/Vazirmatn, density, tokens and shadcn adapters. Add focused current-shell screens, with secondary fields disclosed on demand and preserved drafts/retry/conflict states. Language, calendar, timezone, digits, country and monetary display remain independent.

Every surface enforces current project/parent permission and module availability, including activity/calendar projections, notifications, search, views, exports, realtime, jobs and MCP. Explicitly classify all new personal stores in Privacy, including briefs, feedback, rates, JSON, history, caches and recipient snapshots. Generalized restriction/writer APIs must be real before being claimed.

Detailed architecture is in ARCHITECTURE.md; each of the96 tasks has expected outcome/tests in PROJECTS.md and TASKS.csv. TEST-MATRIX.md defines36 required test families.

### Explicit exclusions

Invoice preparation/issuance and financial posting; asset uploads/hosting/delivery/video streaming; client/freelancer login/portals; marketplace/plugin runtime; automatic existing WhatsApp-group synchronization; payroll, enterprise resource planning, generalized resource planning and a second CRM/workflow engine. Existing services may be referenced without promising their unqualified capabilities.

## 8. Release and continuation

R0 establishes protected baseline/contracts/design and begins pure policies. R1 releases projects/client commitments after security/privacy/reminder gates. R2 adds internal freelancer coordination/templates. R3 adds revision decisions and qualified automation. R4 enables quotation-dependent economics after its source contract qualifies.

Each release must pass its applicable exact-candidate checks, current-shell/regional journeys, deny/race tests and supported upgrade/recovery gates. Do not withhold all useful internal work for an unrelated provider or future finance dependency. Do not call the whole96-task goal complete while required work remains.

The new implementation chat owns the persistent goal and execution ledger. It refreshes live owner/head/allocation state, implements small tested vertical slices and coordinates reviewable commits. Real participants/providers/outreach, paid operations, financial actions and production rollout have separate concrete authorization/evidence requirements; no simulated result closes those gates.
