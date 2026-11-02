# Integration work coordination and scope amendment

Recorded 31 October 2026 at Ali's request. This is a documentation amendment; it does not modify running services, credentials, source code, migrations, Git branches or persistent-goal state.

## Authority and implementation boundaries

Use the master integration task register for common task identity and use the approved local-email/P0-P1 plan to select the early delivery slice. The existing broader platform backlog remains a planning programme; this amendment does not approve every package, live action, deployment or publication. Keep current implementation evidence in its existing execution record and map it here, without resetting planned tasks to completed solely because code exists.

| Earlier local-plan item                      | Canonical responsibility / IDs                             | Collision-prevention rule                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IG-01, IG-03, IG-04, IG-05                   | MAIL-001..020; CONN contracts                              | The email owner keeps the provider-neutral mail domain, transport, mailbox identity and mail UI work. Review actual ongoing changes before another writer touches them.   |
| IG-02                                        | CONN-001..026                                              | One common registry, credential store, lifecycle, ownership policy and Connections hub. Email/SMS/PBX/accounting add domain adapters and capabilities to these contracts. |
| IG-06                                        | Existing regional/phone/currency domain plus UX/QA         | Reuse existing country, calendar, number and currency/unit helpers; do not create a second parser or reinterpret records through UI locale.                               |
| IG-07, IG-15 and verified-provider expansion | SMS-001..132                                               | One SMS domain and per-provider qualification chain. Preserve first/second candidates as defaults; expand other verifiable candidates at the end of approved P1.          |
| IG-09                                        | MS-001..005 plus relevant later Microsoft gates            | One Outlook mailbox adapter and consent/refresh implementation. Calendar/Teams work retains its own contracts.                                                            |
| IG-10, IG-11                                 | EXP-041..044                                               | One selected, version-qualified PBX track; no duplicate telephony adapter or conflicting priority.                                                                        |
| IG-12, IG-13, IG-14                          | Domain quotation work plus EXP-045..048                    | CRM quotation authoring remains domain work; the accounting connector is conditional on actual Sepidar API/edition/access and explicit financial-write boundaries.        |
| IG-16                                        | EVT, applicable AUTO/API contracts                         | One existing workflow/rule engine and delivery path. SMS/email contribute channel actions; they do not recreate queue, event, retry or scheduling infrastructure.         |
| IG-08, IG-17 and all locale/security checks  | UX, OPS, QA, existing auth/permission owners               | Preserve common release gates and separate local fixtures from authorized real-provider qualification.                                                                    |
| Deferred IG-18..22                           | Existing SDK/STORE/CAL/GOOG/MS/ZOOM and later domain scope | Do not implement the same later feature through a separate local-plan project. Original deferred approval boundaries still apply.                                         |

These responsibility labels do not assign an actual person or override an active writer. BASE-001/002 must record named chat/person ownership for specific files, schemas and migration allocation. Separate worktrees do not prevent semantic or migration conflicts. Coordinate shared edits before mutation; do not reset/stash, bulk-stage, replace the UI shell or independently number a competing migration.

## Priority and dependency reconciliation

1. **IR1 / P0:** independent IMAP/SMTP mail first, preserving Gmail, authentication and the current UI. MAIL-001..011 and MAIL-013..020 carry this approved early scope. MAIL-012 remains a separate Gmail live-provider gate. The new register entries map ongoing email work, not permission to rebuild it.
2. **IR2 / P0:** shared SMS-domain contracts and the initial qualified provider after independent mail, consuming reviewed CONN/EVT local foundations. SMS-001..016 hold the common work and initial Kavenegar chain.
3. **IR3 / P1:** the previously approved operational tranche includes the mail-only Microsoft path and selected PBX/accounting tracks. EXP-041..048 become P1 rather than P3. Broad remaining SMS-provider delivery belongs at the end of this approved P1 tranche; Melipayamak remains the second default candidate.
4. Existing R0..R7 platform milestones continue for their other packages. They do not force independent mail to wait for unrelated calendar, public API, SDK, marketplace or live-provider approvals. Task-level exceptions are recorded in the CSV and summary.
5. CONN and EVT are planned foundations in the supplied snapshot. Reconcile any implementation already underway, agree a single shared contract/owner, and extend it incrementally. A planned checkbox is not proof that a component exists or a reason to build another one.

## Broad SMS scope and evidence

The inventory contains 30 discovery candidates with independent specify -> implement -> local -> live stage IDs. A public API page, marketing claim or SDK is research evidence, not qualified support. Verify provider/account identity, API/version, licensing, sender permissions, receipt/inbound entitlement and callback authenticity. Exclude or leave unverified candidates pending with reasons, and keep them out of supported-product claims. Providers sharing an API family retain separate identity/configuration/evidence; reuse is conditional on compatibility tests.

Use common credentials, permission checks, audit, delivery intents, cancellation, safe retries and revocation. Preserve unknown/accepted/delivered distinctions, suppress blind retries after ambiguous sends and maintain complete Farsi/German/English setup, failure, recovery, mobile, RTL/LTR and operator workflows. Actual live messaging, calls, financial writes and paid services still require their separately authorized resources/actions.

## Active execution register handoff

The platform execution record is already active in `docs/integration-execution/tasks.csv`; its actual statuses, evidence, source heads, estimates and notes remain unchanged by this documentation update. The original planning CSV is a dated scope snapshot, not a competing live status source. The v1.1 planning expansion contains 140 new rows; `integration-coordination-task-import.csv` carries only these additions, and `integration-coordination-task-overrides.csv` carries exact old/new planning priorities and dependencies. The execution-register owner should reconcile these once without overwriting existing acceptance text or completion evidence, and update the main goal reference in its persistent chat. Do not mark all 586 planning slots as implemented or assume the live register already contains the additions.

The independent mail branch currently owns its in-progress transport, mailbox identity, connection checks/endpoint policy, email settings and unmerged migration work. The platform branch owns the common integration hub and shared platform contracts. BASE must reconcile actual current path ownership and migration heads before adoption; the already committed platform/workflow migrations and the mail peer's unmerged migrations must not be renumbered or copied blindly across installed databases.

## Goal and handoff wording

Update the main persistent goal's scope reference to this amendment instead of creating a competing integration goal: complete the approved P0/P1 slice, beginning with non-Gmail email; preserve current UI/auth/Gmail/data and fully tested FA/DE/EN workflows; then implement as many independently verifiable SMS providers as practical at the end of P1, through the shared platform and evidence gates. Broader platform packages retain their separately approved scope.

The side conversation could not activate or change a persistent goal (the tool requires a persistent thread). This file records the requested goal wording and coordination boundary; it does not claim goal metadata was changed. Plan snapshots preserve all original IDs and historical verification. The current execution record remains authoritative for actual progress.
