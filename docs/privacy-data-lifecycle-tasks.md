# Privacy and data-lifecycle implementation backlog

Canonical scope: [PRD](PRD-warpdrive-privacy-data-lifecycle.md). Tests: [acceptance design](privacy-data-lifecycle-tests.md). All tasks start NOT_STARTED. The new implementation chat owns execution and evidence. Full implementation includes P0 and P1.

For each task, record status, owner, commit/PR, test command/result, locale review and residual installation gates. Dependencies normally require QUALIFIED source/test evidence to start dependent implementation; unavailable external ACCEPTED gates block final release, not independent source work. Actual destructive execution also requires its own approved scope and authorization.

Current execution statuses and evidence: [implementation register](privacy-implementation-status.md). The initial NOT_STARTED baseline below is historical planning context; the register records implementation progress without implying acceptance.

## M1: inventory, authority and cases

### DPL-01: Whole-product data and writer inventory

- Priority/size: P0 / L. Dependencies: none. Ownership: privacy registry and inventory documentation.
- Work: classify every current schema table, object namespace/version, queue/outbox, derived index/cache, log, backup and external recipient. Map subject relationships, writers, permissions, purposes and capability gaps, including change snapshots and import source data. Reconcile concurrent integration/calendar additions without taking over their implementation.
- Accepted outcome: no discovered store or writer is silently unclassified; ownership is separate from subject identity; registry coverage is machine-checkable and unknown adapters fail closed.
- Tests: P01A, P01B; C01, C08, C12. Evidence: generated coverage report and reviewed adapter register.

### DPL-02: Privacy-specific authorization

- Priority/size: P0 / M. Dependencies: DPL-01. Ownership: permissions/privacy boundary and route/action guards.
- Work: define case intake/review, sensitive disclosure, export, restriction, erasure approval/execution, holds and policy capabilities. Require case authority and appropriate fresh authentication in addition to existing account policy.
- Accepted outcome: regular users, unrelated managers, inactive/invited users and an administrator lacking required case authority cannot disclose or erase case data. Mid-job loss of authority prevents publication/download/execution.
- Tests: P02A, P02B; C01-C04, C09, C10. Evidence: permission/action matrix and negative endpoint tests.

### DPL-03: Durable request and job state machines

- Priority/size: P0 / L. Dependencies: DPL-02. Ownership: privacy schema, services and jobs.
- Work: store access, portability, correction, restriction, objection, closure and erasure cases; subject references, decisions, approvals, deadlines, responses and related jobs. Keep case/job state distinct, encrypted sensitive metadata and immutable minimal transitions.
- Accepted outcome: validated transitions are durable and idempotent; duplicates do not create repeated destructive jobs; failed/partial work cannot close a case; upgrades preserve existing identities and CRM relationships.
- Tests: P03A, P03B; C03, C05, C06, C11. Evidence: migrations, state diagram and concurrency tests.

### DPL-04: Proportionate identity and recipient verification

- Priority/size: P0 / M. Dependencies: DPL-03. Ownership: intake, verification and recipient binding.
- Work: support authenticated self-service and operator-assisted external requests, verified channels and minimized evidence. Bind approval/delivery to the reviewed subject and recipient; never automatically merge by email.
- Accepted outcome: no matched data is revealed before verification; unknown addresses receive safe acknowledgements; changing a recipient invalidates delivery approval; users need not open a CRM account or upload identity documents by default.
- Tests: P04A, P04B; C01-C04, C10, C12. Evidence: intake/verification walkthrough and abuse tests.

### DPL-05: Deadlines and decision records

- Priority/size: P0 / M. Dependencies: DPL-03. Ownership: deadline engine and review evidence.
- Work: model receipt, identity questions, response due dates, justified extensions, refusal reasons and communications. Use policy-selected calendar-month arithmetic and store canonical instants; reminders do not send external messages automatically.
- Accepted outcome: deadlines originate from receipt and remain visible; extensions require explicit reasons and notice records; Farsi/German display does not change calculation; jurisdiction-specific decisions are auditable.
- Tests: P05A, P05B; C05, C07, C13. Evidence: date decision table and month-end/DST cases.

### DPL-06: Controller policy, purposes and deployment register

- Priority/size: P1 / M. Dependencies: DPL-01, DPL-05. Ownership: versioned policy/configuration and operator decision register.
- Work: record controller/processor roles, contacts, purposes, grounds, recipient/subprocessor locations, retention profiles and rights eligibility/exception decisions. Include SMTP, analytics, enrichment, storage and backup transfers. Do not infer law from language.
- Accepted outcome: unknown choices remain explicit; unconfigured policy cannot silently enable broad disclosure/purge; policy changes invalidate affected previews and have evidence of activation.
- Tests: P06A, P06B; C01, C03, C07, C13. Evidence: policy schema, defaults table and operator setup checklist.

## M2: discovery, export and user experience

### DPL-07: Reviewed subject discovery

- Priority/size: P0 / L. Dependencies: DPL-01, DPL-04. Ownership: subject discovery adapters.
- Work: discover linked contacts, user identities, aliases, emails, files, shared relationships and indirect references, with provenance and confidence. Handle ambiguous/shared addresses and changed identifiers through review.
- Accepted outcome: a verified case has an exact approved scope; a record owner is not assumed to be the subject; missing adapters/ambiguous matches are visible; discovery is paged and does not fetch remote content.
- Tests: P07A, P07B; C01, C07, C08, C12. Evidence: seeded multi-subject relationship graph and match report.

### DPL-08: Disclosure rules and export manifest

- Priority/size: P0 / L. Dependencies: DPL-02, DPL-06, DPL-07. Ownership: export schemas, disclosure/redaction adapters.
- Work: distinguish subject-access and eligible portability scopes. Define field inclusion, third-party redaction, explanatory metadata, CSV safety, original/reconstructed email representation and unavailable data.
- Accepted outcome: versioned manifests account for every reviewed category; passwords, recovery secrets, integration credentials and unrelated/private-party content are absent; exclusions have specific reasons and require review.
- Tests: P08A, P08B; C01, C03, C10, C12. Evidence: manifest fixtures and approved redaction rules.

### DPL-09: Durable export generation

- Priority/size: P0 / L. Dependencies: DPL-08. Ownership: export jobs and private artifact storage.
- Work: stream/paginate scoped data and authorized objects into an integrity-checked archive. Implement quotas, leases, checkpoints, cancellation, retry and immutable reviewed-scope versions.
- Accepted outcome: one logical job publishes at most one valid result; interrupted work resumes without omissions/duplicates or orphaned public objects; stale authority/scope cannot publish an artifact.
- Tests: P09A, P09B; C03, C05, C06, C08, C11, C16. Evidence: real PostgreSQL/object-store failure drill and archive validator.

### DPL-10: Secure export delivery and revocation

- Priority/size: P0 / M. Dependencies: DPL-02, DPL-09. Ownership: delivery grants/download endpoint.
- Work: deliver to an authenticated authorized actor or verified reviewed recipient, with short-lived hashed grants and transfer semantics. Recheck status on retrieval; support safe range/retry and prevent archive path/content execution.
- Accepted outcome: copied, expired, revoked or wrong-recipient grants cannot disclose data; authority loss revokes access promptly; downloads use private storage and safe headers; URLs/logs contain no subject identifiers or reusable secrets.
- Tests: P10A, P10B; C01-C04, C06, C10, C16. Evidence: real HTTP/download security tests.

### DPL-11: Personal/external request experience

- Priority/size: P1 / M. Dependencies: DPL-03, DPL-04, DPL-10. Ownership: personal privacy settings, intake and localized status UI.
- Work: request, clarify, follow status, cancel where allowed, download an approved result and understand closure versus erasure. Offer a supported external intake path without forced registration.
- Accepted outcome: FA/DE/EN journeys cover loading, empty, validation, verification, expiry, success, rejection and partial failure; no account existence leak or promise that access removal deletes all CRM data.
- Tests: P11A, P11B; C01, C04, C07, C09, C13. Evidence: component/HTTP tests and actual browser walkthroughs.

### DPL-12: Administrative privacy workspace

- Priority/size: P1 / L. Dependencies: DPL-03, DPL-05, DPL-07, DPL-08. Ownership: privacy administration UI.
- Work: queue, assignment, due dates, subject-match review, encrypted notes, disclosure preview, decisions, evidence and failure recovery in the established settings design.
- Accepted outcome: authorized reviewers can complete a case without raw database access; counts/status are truthful; secrets are never placed in tables/tooltips; private details obey specific case authority; keyboard/focus behavior is complete.
- Tests: P12A, P12B; C01-C04, C07, C09, C13. Evidence: FA/DE/EN reviewer scripts and preserved-shell visual review.

## M3: closure, erasure, restrictions and retention

### DPL-13: Account closure and ownership handover

- Priority/size: P0 / M. Dependencies: DPL-02, DPL-03, DPL-04, DPL-12. Ownership: closure integration with existing offboarding/ownership services.
- Work: distinguish suspend access, transfer required shared records, revoke sessions/OAuth/mailbox credentials and request personal-data erasure. Preserve last-administrator and last-method protections.
- Accepted outcome: closure immediately ends relevant access while showing retained records and next actions; it never purges another person's records by ownership alone or reports remote revocation before acknowledgement.
- Tests: P13A, P13B; C01, C03, C06, C12, C14. Evidence: atomic handover/revocation tests and localized confirmation.

### DPL-14: Erasure preview, holds and approval

- Priority/size: P0 / L. Dependencies: DPL-06, DPL-07, DPL-12, DPL-13. Ownership: preview and approval policy.
- Work: classify delete/redact/retain/transfer/external/unsupported actions, legal/operational holds, estimates and backup/provider residuals. Bind expiring approval to a deterministic versioned preview.
- Accepted outcome: no irreversible job starts from a stale, unreviewed or unauthorized preview; a new hold wins against a concurrent purge; the operator sees all retained exceptions and affected shared data.
- Tests: P14A, P14B; C01-C06, C12, C14, C15. Evidence: preview fixtures, approval tests and lock-order ADR.

### DPL-15: Structured erasure/anonymization executor

- Priority/size: P0 / L. Dependencies: DPL-14. Ownership: structured-record erasure adapters and job service.
- Work: implement approved removal/redaction across persons, users, relationship tables, custom fields, related identifiers and derived records. Preserve valid references/shared business records and minimal justified evidence.
- Accepted outcome: every approved action has a durable result; interrupted runs resume safely; held/unauthorized records remain unchanged; retained identifying data is not labeled anonymous.
- Tests: P15A, P15B; C01, C03, C05, C06, C11, C12, C14. Evidence: relational integrity and sentinel-removal report.

### DPL-16: Historical and unstructured personal data

- Priority/size: P0 / XL. Dependencies: DPL-14, DPL-15. Ownership: history/free-text/import/email adapters and review fallback.
- Work: cover change-log old/new values, notes, comments, imports/raw JSON, drafts, notifications, email bodies, queued payloads, filenames and available search/cache copies. Preserve third-party rights and approved exceptions.
- Accepted outcome: known sentinels are absent from approved erased surfaces; uncertain/unsupported material blocks complete-erasure claims and has a reviewed resolution path; future events do not republish removed content.
- Tests: P16A, P16B; C01, C05, C06, C10-C12, C14, C15. Evidence: post-action scans and manual-review state tests.

### DPL-17: Object and attachment lifecycle

- Priority/size: P0 / L. Dependencies: DPL-09, DPL-14, DPL-15. Ownership: storage adapter and attachment reference handling.
- Work: cover source objects, email snapshots, derived previews, temporary archives, multipart uploads, versioned copies, shared references and bucket retention/object locks.
- Accepted outcome: revoked objects cannot be served by old application grants; physical deletion is verified where permitted; shared or held objects are retained explicitly; metadata/object failures remain retryable and visible.
- Tests: P17A, P17B; C01, C03, C05, C06, C08, C10, C14-C16. Evidence: real S3-compatible deletion/version/denial tests.

### DPL-18: Concurrent writer and connector fences

- Priority/size: P0 / XL. Dependencies: DPL-01, DPL-14, DPL-15. Ownership: privacy policy interface and bounded writer/provider hooks.
- Work: integrate consent/restriction/erasure decisions with imports, email sync, enrichment, job retries, outbound queues and existing/future connector capabilities. Fence stale work and keep provider effects separate from local receipts.
- Accepted outcome: races cannot recreate erased data or send a restricted message after the relevant boundary; a provider's unsupported/deferred deletion is not silently marked done; no lock cycle with existing auth/MCP flows.
- Tests: P18A, P18B; C01, C03, C05, C06, C08, C11, C14, C15. Evidence: actual concurrent writer tests and capability matrix.

### DPL-19: Restriction and objection enforcement

- Priority/size: P0 / L. Dependencies: DPL-02, DPL-03, DPL-07, DPL-18. Ownership: restriction policy and operational action guards.
- Work: support reviewed restrictions and purpose-specific objections across UI, APIs, exports, enrichment and outreach. Distinguish marketing processing from essential security notifications and legally justified processing.
- Accepted outcome: the restriction is enforced on the server and by workers, not merely displayed as a badge; removals/overrides require authority and rationale; necessary service security flows are not accidentally disabled.
- Tests: P19A, P19B; C01-C03, C05, C06, C12, C14. Evidence: allowed/denied purpose/action matrix.

### DPL-20: Rectification and recipient follow-up

- Priority/size: P1 / M. Dependencies: DPL-03, DPL-06, DPL-07, DPL-19. Ownership: correction cases, propagation and communications ledger.
- Work: review corrections, apply canonical identifier changes safely and track affected downstream recipients/derived data. Record human-reviewed response or recipient-notification needs without automatically sending external messages.
- Accepted outcome: corrected data and necessary derived views agree, subject matching does not merge unrelated records, failures are visible, and the case records reasons for any permitted exception or refusal.
- Tests: P20A, P20B; C01, C03, C05, C07, C12, C13. Evidence: correction/provenance tests and communication review.

### DPL-21: Explicit retention policy configuration

- Priority/size: P0 / M. Dependencies: DPL-01, DPL-06, DPL-14. Ownership: retention configuration and operator settings.
- Work: classify expiry anchors, periods, holds, preview behavior, policy versions and migration from current auth defaults. Keep active-CRM purge disabled until an operator activates a valid profile.
- Accepted outcome: configuration is validated and understandable in FA/DE/EN; policy changes show expected impact before activation; no fabricated jurisdictional deadline or accidental whole-database default purge.
- Tests: P21A, P21B; C01, C03, C07, C13, C14. Evidence: profile schema/default fixtures and dry-run review.

### DPL-22: Retention workers and repair

- Priority/size: P0 / L. Dependencies: DPL-18, DPL-21. Ownership: bounded maintenance jobs and receipts.
- Work: implement deterministic cutoff selection, leases, batch bounds, idempotent purge/redaction, holds, retries, cancellation and repair; reuse existing worker architecture.
- Accepted outcome: two workers cannot apply the same action twice; a new hold/policy generation prevents stale deletion; progress, failures and residual objects are truthful; no long database transaction spans remote I/O.
- Tests: P22A, P22B; C03, C05, C06, C08, C11, C14. Evidence: cutoff/concurrency/crash tests.

### DPL-23: Export, proof and log minimization

- Priority/size: P0 / M. Dependencies: DPL-09, DPL-10, DPL-21, DPL-22. Ownership: transient artifact and privacy metadata cleanup.
- Work: expire export objects/grants, unneeded verification evidence, debug fields and obsolete sensitive job payloads; review logging/analytics/referrers for secrets and subject data.
- Accepted outcome: expired artifacts are inaccessible and physically reclaimed or explicitly blocked; logs retain only necessary references/outcomes; failures do not expose bearer links or revive cleanup work.
- Tests: P23A, P23B; C01, C03, C05, C06, C10, C16. Evidence: real storage expiry and secret-sentinel scans.

### DPL-24: Deletion/revocation record and restore protection

- Priority/size: P0 / XL. Dependencies: DPL-15, DPL-16, DPL-17, DPL-18, DPL-22. Ownership: protected lifecycle record and restore admission.
- Work: retain minimized, justified replay instructions independently of snapshot rollback, with integrity, versioning and key handling. Reapply deletion/restriction/revocation before restored traffic/jobs are admitted.
- Accepted outcome: restoring an older snapshot does not expose removed data or revive sessions/grants; missing/stale/corrupt lifecycle records fail closed; residual matcher identifiers have a bounded documented purpose.
- Tests: P24A, P24B; C01, C03, C06, C11, C14, C15. Evidence: older-snapshot replay and admission tests.

### DPL-25: Encrypted backup and restore rehearsal

- Priority/size: P0 / L. Dependencies: DPL-24. Ownership: operator tooling, manifests and qualification scripts.
- Work: exercise database, object storage, versioned artifacts and necessary keys with encrypted backups, integrity checks, restricted access, measurable restore steps and lifecycle-record replay. Keep credentials out of arguments/logs.
- Accepted outcome: synthetic restore verifies relationships and permitted data after erasure/revocation; production RPO/RTO and backup-residual expiry are explicit operator decisions; a missing key or failed checksum cannot yield a ready service.
- Tests: P25A, P25B; C05, C06, C08, C10, C11, C15. Evidence: automated disposable rehearsal plus installation-sized drill in DPL-36.

### DPL-26: Minimal privacy audit and access review

- Priority/size: P1 / M. Dependencies: DPL-02, DPL-03, DPL-06, DPL-15, DPL-23. Ownership: audit schema, viewer and review workflow.
- Work: record actor/case/action/reason/approved scope/outcome, access review, recipient disclosures and retention; protect free-form notes and exclude erased content, tokens and secrets from routine audit entries.
- Accepted outcome: authorized operators can explain a case and review excessive access without a hidden duplicate of erased data; audit retention and holds are explicit; audit viewing/export requires appropriate authority.
- Tests: P26A, P26B; C01-C03, C07, C10, C12-C14. Evidence: audit sentinel and privilege-loss tests.

## M4: operational and release acceptance

### DPL-27: Incident response workflow and rehearsal

- Priority/size: P1 / M. Dependencies: DPL-03, DPL-05, DPL-06, DPL-26. Ownership: incident records, response templates and runbook.
- Work: record awareness, containment, risk assessment, affected categories/recipients, controller/processor responsibilities and conditional notification decisions/deadlines. Provide localized draft communications and escalation contacts.
- Accepted outcome: a tabletop exercise produces a complete decision/evidence record and appropriate deadlines; no automatic report or customer message is sent; restricted incident material follows retention/access policy.
- Tests: P27A, P27B; C01, C03, C07, C10, C13. Evidence: synthetic incident drill and reviewed runbook.

### DPL-28: Notices, transparency and language quality

- Priority/size: P1 / M. Dependencies: DPL-06, DPL-11, DPL-12, DPL-19, DPL-20, DPL-26. Ownership: localized notices, policy text configuration and help content.
- Work: describe actual controller identity, purposes, recipients, retention and rights channels; distinguish account closure, recovery and erasure; inventory optional tracking and consent controls where applicable.
- Accepted outcome: published text matches the installation configuration and actual behavior, FA/DE/EN are complete and natural, policy versions are visible, and unset operator facts cannot masquerade as a finished notice.
- Tests: P28A, P28B; C07, C09, C10, C12, C13. Evidence: copy review and notice/configuration assertions.

### DPL-29: Real staging authentication checks

- Priority/size: P0 / M. Dependencies: DPL-01, DPL-02. Ownership: staging checklist and reproducible scripts; operator owns live credentials/devices.
- Work: verify HTTPS origin/cookies, SMTP TLS/certificate checks, actual reset/notice delivery to designated test mailboxes, physical passkeys and FA/DE recovery. Preserve current tested auth behavior.
- Accepted outcome: the exact staged revision has recorded delivery/device evidence and verified fallback/recovery; absent domain/mailbox/device inputs remain OPEN, not replaced with mock-success claims.
- Tests: P29A, P29B; C01-C04, C07, C09, C10, C16. Evidence: redacted installation record. External sends/device actions require specific authorization.

### DPL-30: Complete synthetic privacy workflow qualification

- Priority/size: P0 / L. Dependencies: DPL-11 to DPL-13, DPL-15 to DPL-20, DPL-22 to DPL-25. Ownership: end-to-end fixtures and browser/API qualification.
- Work: run request -> verification -> review -> action -> delivery/response -> closure for all supported case types, with multiple people and roles, real PostgreSQL/storage/SMTP and failure injection.
- Accepted outcome: all approved actions and residual obligations reconcile with actual stores; no unauthorized disclosure, resurrection or false completion; each FA/DE/EN path has positive and failure-state evidence.
- Tests: P30A, P30B; every applicable C-series scenario. Evidence: traceable case/store/job reports.

### DPL-31: UI, accessibility and localization acceptance

- Priority/size: P1 / M. Dependencies: DPL-28, DPL-30. Ownership: browser review, accessibility checks and approved visual adjustments.
- Work: review desktop, 320/390-pixel layouts, light/dark, zoom, keyboard-only use, focus restoration, screen-reader announcements, contrast and reduced motion. Preserve the existing shell and review idiomatic Farsi/German text.
- Accepted outcome: no horizontal overflow, missing locale states, clipped critical actions, inaccessible confirmation or misleading destructive copy; field direction and calendar/number preferences remain correct.
- Tests: P31A, P31B; C07, C09, C12, C13. Evidence: actual browser captures and interaction checklist, not catalog parity alone.

### DPL-32: Bounded-resource and failure qualification

- Priority/size: P1 / L. Dependencies: DPL-09, DPL-15, DPL-17, DPL-18, DPL-22 to DPL-24. Ownership: finite synthetic resource/failure campaigns.
- Work: qualify the declared 10k-record/100-MiB profile, cancellation, stream/page limits, job leases, unavailable storage/providers, process restart and stuck-work repair. Record hardware/runtime and measurements.
- Accepted outcome: memory/page/cancellation targets from the PRD are met or explicitly revised with evidence; no unbounded retries, orphaned disclosure artifacts, duplicate effects or hidden partial-success states.
- Tests: P32A, P32B; C03, C05, C06, C08, C11, C16. Evidence: reproducible results and limit configuration.

### DPL-33: Adversarial security/threat review of the candidate

- Priority/size: P0 / L. Dependencies: DPL-10, DPL-14, DPL-18, DPL-24, DPL-26, DPL-29 to DPL-32. Ownership: adversarial test review and risk register.
- Work: review cross-user access, stale authority, CSRF/origin, token leakage/replay, subject enumeration, provider/SSRF boundaries, archive safety, job tampering and dependency findings. Add regression tests before fixes.
- Accepted outcome: no unresolved critical/high issue in the new flows; remaining risks have owners and evidence; dependency exceptions are explicit; reviewer does not infer production safety solely from synthetic fixtures.
- Tests: P33A, P33B; C01-C16. Evidence: threat model and issue-to-regression closure list.

### DPL-34: Exact-revision CI and release candidate

- Priority/size: P0 / M. Dependencies: DPL-25, DPL-27 to DPL-33 at their source/qualification gates. Ownership: scoped integration, CI and release evidence.
- Work: run frozen Bun install, full unit/real-PG tests, types, i18n, lint, app/worker/site/docs builds and migrations/upgrade checks on the exact candidate. Keep peer branches/dirty work intact.
- Accepted outcome: reviewable commits/PRs and exact-revision CI are green; tests cannot be skipped to force acceptance; required external gates remain visible until DPL-36 resolves them.
- Tests: P34A, P34B; C01-C16. Evidence: commit/tree IDs, CI links and release manifest.

### DPL-35: Open-source operator and maintainer handoff

- Priority/size: P1 / M. Dependencies: DPL-26 to DPL-28, DPL-32, DPL-34. Ownership: operations, administration and contributor documentation.
- Work: provide FA/DE/EN user/operator instructions, retention and recipient configuration, incident exercise, backup/restore, key rotation, repair/rollback and adapter-contribution rules. Separate code qualification, installation and legal acceptance.
- Accepted outcome: an operator can follow the instructions without undocumented database edits or exposing secrets; all commands are exercised on synthetic data; unsupported capabilities and residual obligations are clear.
- Tests: P35A, P35B; C07, C10-C15. Evidence: runbook rehearsal and maintainability review.

### DPL-36: Installation acceptance and final goal closure

- Priority/size: P0 / L. Dependencies: DPL-29 to DPL-35. Ownership: installation operator/Ali for live decisions; implementation chat for evidence and fixes.
- Work: perform authorized staging walkthroughs, actual external delivery/device checks, controller-policy/notice review, production-profile restore and deletion-record replay, and incident/ownership handoff.
- Accepted outcome: every required task and acceptance gate is ACCEPTED with exact revision and evidence. Unavailable credentials, legal/operator decisions or live actions stay OPEN/BLOCKED_EXTERNAL. Do not mark the implementation goal complete while a required acceptance remains unresolved.
- Tests: P36A, P36B; all C-series scenarios at their appropriate automated or installed level. Evidence: signed-off acceptance register and final release state.
