# Integration platform task register

Execution activated on 31 October 2026. This file retains the dated planning snapshot.
The single live status source is [the execution register](integration-execution/tasks.csv);
see [current evidence and restart guidance](integration-execution/README.md).

Planning snapshot v1.1, 2026-10-31. 586 planned task slots in 24 work packages. Task states below remain planned; actual implementation evidence is maintained separately.

The active execution register retains its actual states; the 140 added planning rows and priority/dependency overrides await one owner-controlled reconciliation, as described in the coordination handoff. The user-requested coordination amendment preserves all original 446 IDs and adds eight independent-mail tasks, 12 shared SMS tasks and 120 conditional stage tasks for 30 SMS candidates. Provider candidates are not promised shipped integrations. See [scope/ownership reconciliation](integration-coordination.md) and the [provider inventory](integration-sms-providers.md).
The existing local foundation and completed UI refinement are recorded separately in the [project plan](integration-project-plan.md).
This register does not authorize deployment, provider messaging or publication. Current work remains local.

The [CSV export](integration-platform-tasks.csv) contains the same IDs, acceptance criteria, owners, dependencies, verification and stage flags.
Role owners are proposed responsibilities, not assigned people. Estimates remain unestimated until BASE-012.
Dependencies below are minimum initial constraints. Refine task-level ordering after each design/spike.
Package prerequisites mean reviewed contracts and locally verified foundations, excluding optional live-provider, hosting and publication gates.
The CSV marks this as `dependency_scope=local-foundation`. Specific external release gates still require their own evidence.
Each EXP provider has an independent specify -> implement -> local qualification -> live qualification chain.
After issue import, record the tracker URL in the project plan and use it as the execution status source; retain these dated files as the starting snapshot.

## Index

| Package                                                      | Milestone | Priority | Tasks | Responsibility                             |
| ------------------------------------------------------------ | --------- | -------- | ----- | ------------------------------------------ |
| [BASE](#base) Reconcile the preview with current development | R0        | P0       | 12    | Platform                                   |
| [ARCH](#arch) Architecture and product contracts             | R0        | P0       | 12    | Platform + security                        |
| [UX](#ux) Product design, localization and accessibility     | CROSS     | P0       | 14    | Design + localization                      |
| [CONN](#conn) Shared connector lifecycle and provider SDK    | R1        | P0       | 26    | Platform + integrations                    |
| [EVT](#evt) Events, rules and reliable delivery              | R1        | P0       | 20    | Platform + workflows                       |
| [SLK](#slk) Slack notifications and management               | R1        | P0       | 24    | Integrations + workflows                   |
| [SLKX](#slkx) Slack commands, actions and unfurls            | R5        | P1       | 12    | Integrations + security                    |
| [AISEC](#aisec) MCP and application authorization            | R2        | P0       | 24    | Security + platform                        |
| [MCP](#mcp) Complete the CRM MCP capability surface          | R2        | P1       | 22    | MCP + domain owners                        |
| [CLIENT](#client) ChatGPT, Claude and supporting client apps | R2        | P1       | 20    | MCP + client UX                            |
| [MAIL](#mail) Mail integration hardening                     | IR1       | P0       | 20    | Email + integrations                       |
| [CAL](#cal) Calendar domain and event workflow               | R3        | P0       | 22    | Calendar + localization                    |
| [GOOG](#goog) Google Calendar and Google Meet                | R3        | P1       | 20    | Google integrations                        |
| [MS](#ms) Microsoft 365, Outlook and Teams                   | R4        | P1       | 16    | Microsoft integrations                     |
| [ZOOM](#zoom) Zoom conferencing                              | R4        | P1       | 12    | Conferencing integrations                  |
| [API](#api) Public API and signed webhooks                   | R5        | P1       | 20    | Platform + developer experience            |
| [AUTO](#auto) Workflow and automation integrations           | R5        | P2       | 12    | Workflows + integrations                   |
| [EXP](#exp) Additional provider delivery tracks              | R6        | P2       | 52    | Provider owners                            |
| [SMS](#sms) Verified Iranian SMS provider coverage           | IR2 / IR3 | P0 / P1  | 132   | SMS domain + provider owners               |
| [SDK](#sdk) Application SDK and isolated extension runtime   | R6        | P1       | 24    | Platform + security + developer experience |
| [STORE](#store) Marketplace and app management               | R7        | P2       | 22    | App platform + product                     |
| [OPS](#ops) Self-hosting, observability and operations       | CROSS     | P0       | 18    | Operations + platform                      |
| [QA](#qa) Shared verification and release acceptance         | CROSS     | P0       | 18    | QA + security + domain owners              |
| [OSS](#oss) Open-source distribution and maintenance         | CROSS     | P1       | 12    | Maintainers + developer experience         |


<a id="base"></a>
## BASE: Reconcile the preview with current development

Inventory and reconcile current main, the isolated integration branch and any parallel workflow work without overwriting peer changes.

Milestone: **R0**. Default priority: **P0**. Responsibility: **Platform**.
Package dependencies: none.

**Exit criterion:** A current isolated checkout contains the intended changes, has a reproducible local runtime and records its own passing baseline.

- [ ] **BASE-001** [P0; local] Record repository and worktree ownership.
  Acceptance: Record heads, remotes, dirty files, worktrees and the owner of each active change before integration. Verification: source review.
- [ ] **BASE-002** [P0; local] Locate parallel workflow implementation.
  Acceptance: Find source branches and handoffs; distinguish runtime previews, uncommitted work and merged code. Verification: source review.
- [ ] **BASE-003** [P0; local] Inventory the eight integration UI commits.
  Acceptance: Map a5d8ea0 through e321126 to affected files and existing acceptance evidence. Verification: source review.
- [ ] **BASE-004** [P0; local] Reconcile changes in an isolated branch.
  Acceptance: Resolve conflicts with the current UI and auth implementation without resetting, stashing or bulk-staging unrelated files. Verification: build and regression.
- [ ] **BASE-005** [P0; local] Verify Bun and frozen dependencies.
  Acceptance: Use the declared Bun version and frozen lockfile; document runtime requirements without updating global tools. Verification: reproducible install.
- [ ] **BASE-006** [P0; local] Map existing queues and domain event hooks.
  Acceptance: Identify pg-boss handlers, email outbox behavior, reminder producers and any workflow/event bus before adding infrastructure. Verification: source review.
- [ ] **BASE-007** [P0; local] Map authorization and account boundaries.
  Acceptance: Document current actor, role, mailbox, OAuth grant and Slack workspace ownership paths. Verification: source review.
- [ ] **BASE-008** [P0; local] Create the isolated service profile.
  Acceptance: Define app, PostgreSQL, worker, realtime and storage services with separate ports and disposable data. Verification: local smoke.
- [ ] **BASE-009** [P0; local] Qualify worker and realtime startup.
  Acceptance: Start the isolated required services and verify queue handling plus authenticated realtime without port conflicts. Verification: service smoke.
- [ ] **BASE-010** [P0; local] Capture the baseline suite.
  Acceptance: Run applicable build, unit, PostgreSQL, i18n, lint and UI checks against the reconciled head. Verification: regression suite.
- [ ] **BASE-011** [P0; local] Preserve regression evidence and restore steps.
  Acceptance: Save the exact head, logs, source bundle and private-config locations without credentials or database dumps in Git. Verification: artifact inspection.
- [ ] **BASE-012** [P0; local] Estimate the first delivery slice.
  Acceptance: Size CONN, EVT and SLK tasks after the audit, identifying unknowns and capacity assumptions before assigning dates. Verification: planning review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="arch"></a>
## ARCH: Architecture and product contracts

Define the common contracts used by connections, MCP, workflows and future apps within the existing single-tenant product.

Milestone: **R0**. Default priority: **P0**. Responsibility: **Platform + security**.
Package dependencies: BASE.

**Exit criterion:** Reviewed ADRs define ownership, capability enforcement, event delivery and extension boundaries with migration examples.

- [ ] **ARCH-001** [P0; local] Define installation, connection and grant identities.
  Acceptance: Distinguish an installed app, upstream account, authorization grant and individual credential; illustrate reconnect and duplicate-account behavior. Verification: design review.
- [ ] **ARCH-002** [P0; local] Define personal and shared ownership.
  Acceptance: Specify who can connect, use, configure, transfer and remove each connection without introducing unrequested multi-tenancy. Verification: authorization scenarios.
- [ ] **ARCH-003** [P0; local] Define the capability vocabulary.
  Acceptance: Specify domain read/write, outbound actions, resource selection and administrator capabilities reused by APIs, MCP and extensions. Verification: policy examples.
- [ ] **ARCH-004** [P0; local] Define the authoritative permission evaluator.
  Acceptance: Identify the shared server-side evaluator and explain how CRM visibility intersects with grants and app roles. Verification: negative-case review.
- [ ] **ARCH-005** [P0; local] Define integration lifecycle states.
  Acceptance: Publish transitions for unconfigured, authorizing, configuring, active, degraded, reauthorization, paused, revocation pending and removed. Verification: state transition review.
- [ ] **ARCH-006** [P0; local] Define transactional event ownership.
  Acceptance: Choose where committed CRM changes become durable events and how parallel workflow infrastructure is reused. Verification: failure scenario review.
- [ ] **ARCH-007** [P0; local] Define delivery semantics.
  Acceptance: Specify at-least-once processing, deduplication, ambiguous upstream outcomes and ordering limits without promising exactly-once external effects. Verification: failure scenario review.
- [ ] **ARCH-008** [P0; local] Define identity and public client policy.
  Acceptance: Compare verified client metadata, legacy dynamic registration and administrator allowlists against the pinned MCP specification. Verification: protocol review.
- [ ] **ARCH-009** [P0; local] Define extension runtime boundaries.
  Acceptance: Require a Bun-compatible execution target with a real OS/container isolation boundary; distinguish trusted native adapters from untrusted apps. Verification: threat-model review.
- [ ] **ARCH-010** [P0; local] Define API and schema versioning.
  Acceptance: Specify versioned payloads, compatibility windows, migrations and deprecation notices across SDKs and providers. Verification: compatibility examples.
- [ ] **ARCH-011** [P0; local] Define the live-provider delivery gate.
  Acceptance: Specify the domain, provider test accounts, approved scopes, finite actions and evidence needed for each later live test. Verification: operator review.
- [ ] **ARCH-012** [P0; local] Define parity and release scope.
  Acceptance: Mark Twenty parity as capability-based and dated; separate local preview, provider validation and released support in product copy. Verification: scope review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="ux"></a>
## UX: Product design, localization and accessibility

Apply the existing visual language and Farsi-first quality requirements throughout every new workflow.

Milestone: **CROSS**. Default priority: **P0**. Responsibility: **Design + localization**.
Package dependencies: BASE.

**Exit criterion:** Each delivery has reviewed FA/DE/EN flows, Iranian-calendar behavior, responsive evidence and keyboard-accessible states.

- [ ] **UX-001** [P0; local] Inventory every integration screen and state.
  Acceptance: Map discovery, details, consent, resource selection, configuration, health, errors, reconnect and removal for members and admins. Verification: flow inventory.
- [ ] **UX-002** [P0; local] Research upcoming workflows in Mobbin.
  Acceptance: Inspect relevant integration, automation, permission-review and app-management flows; record links and applied patterns without copying assets. Verification: design evidence.
- [ ] **UX-003** [P0; local] Define reusable screen patterns.
  Acceptance: Specify provider headers, account rows, permission summaries, recovery notices and delivery histories using current shadcn adapters. Verification: design review.
- [ ] **UX-004** [P0; local] Define honest availability language.
  Acceptance: Separate implemented, configured, authorized, healthy, provider-validated and planned states in all locales. Verification: copy review.
- [ ] **UX-005** [P0; local] Maintain the Farsi terminology guide.
  Acceptance: Standardize CRM, pipeline, connection, permission, workflow and calendar terms with contextual examples. Verification: localization review.
- [ ] **UX-006** [P0; local] Write German and English copy alongside Farsi.
  Acceptance: Cover confirmations, operator instructions, errors, notifications and empty/loading states without untranslated fallbacks. Verification: catalog and copy review.
- [ ] **UX-007** [P0; local] Preserve language and calendar independence.
  Acceptance: Specify FA with Gregorian or Iranian calendars, DE with either calendar, numbering preferences and explicit time zones. Verification: locale matrix.
- [ ] **UX-008** [P0; local] Design RTL and mixed-direction layouts.
  Acceptance: Keep URLs, tokens, account identifiers and brand marks correctly isolated while mirroring directional controls only. Verification: browser matrix.
- [ ] **UX-009** [P0; local] Define date and recurrence explanations.
  Acceptance: Explain all-day dates, time zones, ambiguous times and any unsupported Solar Hijri recurrence conversion clearly. Verification: calendar scenarios.
- [ ] **UX-010** [P0; local] Define responsive constraints.
  Acceptance: Review 320, 390, 768 and 1440 pixel layouts with container-aware cards, fully reachable tabs and long German labels. Verification: browser geometry.
- [ ] **UX-011** [P0; local] Qualify keyboard and focus behavior.
  Acceptance: Cover menus, dialogs, selectors, list navigation, pending actions, Escape and focus restoration. Verification: browser keyboard.
- [ ] **UX-012** [P0; local] Review accessibility and contrast.
  Acceptance: Test names, status announcements, contrast, reduced motion and screen-reader operation with evidence separate from static audits. Verification: accessibility review.
- [ ] **UX-013** [P0; local] Maintain provider asset provenance.
  Acceptance: Keep approved local SVGs, source revisions, licenses, safe markup and light/dark appearance without remote tracking loads. Verification: asset validation.
- [ ] **UX-014** [P0; local] Attach localization evidence to each release.
  Acceptance: Record reviewed screenshots and workflows per locale; make unresolved copy or layout issues explicit release blockers. Verification: release review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="conn"></a>
## CONN: Shared connector lifecycle and provider SDK

Generalize the working Slack foundation into one lifecycle used by first-party connectors and future app providers.

Milestone: **R1**. Default priority: **P0**. Responsibility: **Platform + integrations**.
Package dependencies: ARCH.

**Exit criterion:** Two test providers exercise the same ownership, credential, refresh, reconnect, health and removal contracts without feature-specific bypasses.

- [ ] **CONN-001** [P0; local] Inventory provider adapter seams.
  Acceptance: Identify Slack-specific assumptions in catalog, schema, actions and callbacks and define an incremental extraction plan. Verification: source review.
- [ ] **CONN-002** [P0; local] Define typed provider contracts.
  Acceptance: Cover authorize, exchange, refresh, list resources, check, disconnect and capability discovery using Result and AbortSignal. Verification: contract tests.
- [ ] **CONN-003** [P0; local] Implement provider registry metadata.
  Acceptance: Resolve stable provider IDs, local assets, localized copy, supported auth types and actual availability from the same registry. Verification: unit and UI.
- [ ] **CONN-004** [P0; local] Migrate existing Slack connection records.
  Acceptance: Preserve IDs, owner, scopes, settings and history through forward and rollback-safe migration paths. Verification: PostgreSQL migration.
- [ ] **CONN-005** [P0; local] Model account identity and duplicates.
  Acceptance: Use stable upstream IDs; prevent accidental duplicate grants or cross-account reconnect while allowing distinct accounts. Verification: PostgreSQL concurrency.
- [ ] **CONN-006** [P0; local] Implement connection ownership enforcement.
  Acceptance: Enforce member/admin, personal/shared and delegated-use rules at every server and job boundary. Verification: authorization integration.
- [ ] **CONN-007** [P0; local] Implement resource selection policy.
  Acceptance: Store allowed channels, calendars or folders and validate each requested resource against the connection's current scope. Verification: provider contract.
- [ ] **CONN-008** [P0; local] Implement guarded OAuth attempts.
  Acceptance: Bind expiring single-use state to user, session, provider and intent; validate redirects and PKCE where supported. Verification: replay and session tests.
- [ ] **CONN-009** [P0; local] Implement atomic callback completion.
  Acceptance: Handle provider errors, cancellation and simultaneous callbacks without partially saved installations or mismatched accounts. Verification: PostgreSQL fault injection.
- [ ] **CONN-010** [P0; local] Implement safe credential storage.
  Acceptance: Use encrypted values with key identifiers and never expose secrets through DTOs, logs, jobs or browser responses. Verification: storage and leakage tests.
- [ ] **CONN-011** [P0; local] Implement concurrent token refresh.
  Acceptance: Serialize refresh per connection, preserve provider rotation families and reject stale token writes. Verification: concurrency tests.
- [ ] **CONN-012** [P0; local] Implement credential key rotation.
  Acceptance: Re-encrypt credentials with resumable progress, rollback evidence and operator-visible failures. Verification: rotation drill.
- [ ] **CONN-013** [P0; local] Implement health observations.
  Acceptance: Store last attempt, last successful check, normalized error, degradation reason and next retry separately. Verification: state integration.
- [ ] **CONN-014** [P0; local] Classify provider failures.
  Acceptance: Distinguish revoked authorization, insufficient scope, missing resource, rate limit, transient outage and invalid configuration. Verification: provider contract.
- [ ] **CONN-015** [P0; local] Implement reauthorization workflow.
  Acceptance: Preserve the intended account and settings; clear stale health while reviewing any new scopes before activation. Verification: UI and integration.
- [ ] **CONN-016** [P0; local] Implement pause and resume.
  Acceptance: Stop new jobs while retaining configuration; make pending work and resume behavior explicit. Verification: worker integration.
- [ ] **CONN-017** [P0; local] Implement local block before revocation.
  Acceptance: Prevent ordinary token use immediately, retaining only the material needed to finish remote revocation. Verification: revocation fault injection.
- [ ] **CONN-018** [P0; local] Implement durable revocation retries.
  Acceptance: Retry provider removal with bounded backoff, operator visibility and a final actionable failure state. Verification: worker fault injection.
- [ ] **CONN-019** [P0; local] Implement ownership transfer and offboarding.
  Acceptance: Apply the chosen personal/shared policy when users leave or administrators change; never silently reassign grants. Verification: offboarding scenarios.
- [ ] **CONN-020** [P0; local] Implement per-connection audit events.
  Acceptance: Record actor, app, action, resource IDs and outcome with redacted payloads and correlation IDs. Verification: audit assertions.
- [ ] **CONN-021** [P0; local] Implement reusable connection actions.
  Acceptance: Centralize CSRF, fresh authentication where required, validation, timeouts and safe error translation. Verification: server action tests.
- [ ] **CONN-022** [P0; local] Implement common management UI.
  Acceptance: Reuse account identity, health, scopes, resource selection, reconnect, pause and removal surfaces across providers. Verification: FA/DE/EN browser.
- [ ] **CONN-023** [P0; local] Provide a local fake-provider harness.
  Acceptance: Simulate OAuth, refresh, paging, outages and revocation without storing real provider credentials. Verification: contract suite.
- [ ] **CONN-024** [P0; local] Document provider authoring.
  Acceptance: Include a minimal adapter, capability declaration, fixtures and acceptance checklist that use the shared lifecycle. Verification: developer walkthrough.
- [ ] **CONN-025** [P0; local] Implement API-key credential workflows.
  Acceptance: Validate declared credential fields, encrypt secrets, show masked configuration and support rotation without exposing stored values. Verification: credential and UI tests.
- [ ] **CONN-026** [P0; local] Implement custom provider handshakes.
  Acceptance: Bind signed callbacks or hosted-login results to the correct user, app, account and expiring attempt with replay protection. Verification: custom handshake contract.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="evt"></a>
## EVT: Events, rules and reliable delivery

Extend existing pg-boss and any current workflow implementation with durable events and one common integration delivery path.

Milestone: **R1**. Default priority: **P0**. Responsibility: **Platform + workflows**.
Package dependencies: CONN.

**Exit criterion:** A committed CRM event produces a traceable delivery; rollback, retries, duplicate jobs and revoked permissions have tested outcomes.

- [ ] **EVT-001** [P0; local] Reconcile workflow and event implementations.
  Acceptance: Adopt existing domain hooks and workflow ownership instead of creating a parallel rule engine or queue. Verification: source review.
- [ ] **EVT-002** [P0; local] Define the versioned event envelope.
  Acceptance: Include event ID, type, actor, workspace context, object IDs, committed timestamp and redacted change metadata. Verification: schema tests.
- [ ] **EVT-003** [P0; local] Emit events transactionally.
  Acceptance: Persist event intent with the CRM write; rolled-back mutations must never become external notifications. Verification: PostgreSQL transaction.
- [ ] **EVT-004** [P0; local] Implement the event-to-queue dispatcher.
  Acceptance: Resume safely after crashes between outbox persistence, job enqueue and acknowledgement. Verification: fault injection.
- [ ] **EVT-005** [P0; local] Define supported event taxonomy.
  Acceptance: Specify deal creation/stage changes, activity assignment/completion/due events and document event timing. Verification: domain integration.
- [ ] **EVT-006** [P0; local] Implement delivery intent records.
  Acceptance: Track rule version, event, connection, destination, attempt and outcome without copying unrestricted record content. Verification: PostgreSQL integration.
- [ ] **EVT-007** [P0; local] Implement deduplication keys.
  Acceptance: Prevent duplicate local delivery intents and define safe handling of upstream timeout ambiguity. Verification: concurrency and contract.
- [ ] **EVT-008** [P0; local] Implement retry and rate-limit policy.
  Acceptance: Honor Retry-After, provider/account budgets and bounded exponential backoff with jitter. Verification: clock and provider tests.
- [ ] **EVT-009** [P0; local] Implement job cancellation.
  Acceptance: Cancel pending work for disabled rules, revoked grants, paused apps and removed resources. Verification: worker integration.
- [ ] **EVT-010** [P0; local] Recheck permission at execution time.
  Acceptance: Validate actor state, current CRM visibility, app grant and selected destination immediately before sending. Verification: offboarding and TOCTOU tests.
- [ ] **EVT-011** [P0; local] Implement dead-letter inspection.
  Acceptance: Show sanitized failures, attempts and corrective actions with permission-gated retry or discard. Verification: UI and worker tests.
- [ ] **EVT-012** [P0; local] Define rule conditions and templates.
  Acceptance: Use typed field references and allowlisted operators, with no arbitrary expression execution in the web process. Verification: validation tests.
- [ ] **EVT-013** [P0; local] Implement rule draft and activation.
  Acceptance: Separate saved drafts, previews and active rules; activating a rule records the effective version. Verification: rule lifecycle.
- [ ] **EVT-014** [P0; local] Implement safe dry-run previews.
  Acceptance: Evaluate a specific event without delivery and explain matches, denied fields and selected destination. Verification: deterministic preview.
- [ ] **EVT-015** [P0; local] Implement rule administration UI.
  Acceptance: Include event selection, filters, destination, fields, preview, enable/disable and deletion in all locales. Verification: FA/DE/EN browser.
- [ ] **EVT-016** [P0; local] Implement time-based scheduling.
  Acceptance: Respect chosen time zone, daylight-saving transitions, due-time changes and cancellation of obsolete schedules. Verification: temporal fixtures.
- [ ] **EVT-017** [P0; local] Implement loop prevention and provenance.
  Acceptance: Mark integration-originated writes so configured sync/workflow loops stop deterministically. Verification: cyclic workflow tests.
- [ ] **EVT-018** [P0; local] Implement delivery observability.
  Acceptance: Expose correlation, queue age, latency and failure classes with bounded metric cardinality and no secrets. Verification: metrics assertions.
- [ ] **EVT-019** [P0; local] Implement bounded replay tooling.
  Acceptance: Preview a finite replay window, preserve deduplication and require an explicit replay selection. Verification: replay drill.
- [ ] **EVT-020** [P0; local] Qualify worker restart recovery.
  Acceptance: Demonstrate restart, duplicate execution, provider outage and database failure without lost event intent. Verification: operator drill.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="slk"></a>
## SLK: Slack notifications and management

Deliver the first useful vertical slice: CRM event to configurable Slack message with traceable delivery and recovery.

Milestone: **R1**. Default priority: **P0**. Responsibility: **Integrations + workflows**.
Package dependencies: EVT, UX.

**Exit criterion:** A local deal or activity change matches an active rule, produces a safe message and shows its delivery history, including outage and permission-loss cases.

- [ ] **SLK-001** [P0; local] Define the notification event set.
  Acceptance: Specify exact triggers for deal creation, stage changes, activity assignment, completion and overdue reminders. Verification: domain contract.
- [ ] **SLK-002** [P0; local] Define Slack destination and data policy.
  Acceptance: Default to generic link-only messages; require an explicit allowlist for customer names, values, notes or other sensitive fields. Verification: privacy scenarios.
- [ ] **SLK-003** [P0; local] Review current bot scopes.
  Acceptance: Verify the minimum methods/scopes needed for notifications and keep history/private-channel access out of the default grant. Verification: provider contract.
- [ ] **SLK-004** [P0; local] Support Slack token rotation.
  Acceptance: Implement rotating token refresh and revoked-family recovery through the shared connector lifecycle. Verification: refresh concurrency.
- [ ] **SLK-005** [P0; local] Implement channel resource refresh.
  Acceptance: Page joined public channels, detect removed membership or renamed channels and preserve stable IDs with current display names. Verification: provider contract.
- [ ] **SLK-006** [P0; local] Implement the Slack message renderer.
  Acceptance: Use localized, escaped text and validated CRM links; reject arbitrary URLs, raw HTML and unsupported template fields. Verification: rendering and injection tests.
- [ ] **SLK-007** [P0; local] Implement message preview.
  Acceptance: Show the exact field selection, destination, locale and redacted payload before rule activation. Verification: UI and snapshot.
- [ ] **SLK-008** [P0; local] Implement Slack notification rules.
  Acceptance: Bind events, conditions, connection and selected channel to a versioned rule with fresh administrator authorization. Verification: PostgreSQL and authorization.
- [ ] **SLK-009** [P0; local] Implement deal notifications.
  Acceptance: Emit one eligible intent for committed deal creation and stage changes, including moves back and repeated updates. Verification: event integration.
- [ ] **SLK-010** [P0; local] Implement activity notifications.
  Acceptance: Handle assignment, completion and overdue schedules without stale alerts after rescheduling or reassignment. Verification: temporal integration.
- [ ] **SLK-011** [P0; local] Implement provider delivery.
  Acceptance: Call the provider adapter with explicit timeouts, rate-limit handling and sanitized outcomes. Verification: fake-provider contract.
- [ ] **SLK-012** [P0; local] Handle ambiguous send outcomes.
  Acceptance: Distinguish confirmed, failed and unknown delivery states; reconcile or review before unsafe blind replay. Verification: timeout fault injection.
- [ ] **SLK-013** [P0; local] Implement delivery history UI.
  Acceptance: Show event, rule, destination, time, attempts and outcome with searchable correlation IDs and localized recovery. Verification: FA/DE/EN browser.
- [ ] **SLK-014** [P0; local] Implement safe test messages.
  Acceptance: Preview test content first and clearly identify the test workspace; local mode uses the fake provider only. Verification: UI and contract.
- [ ] **SLK-015** [P0; local] Implement pause and rule removal.
  Acceptance: Stop pending sends when rules or connections are paused or removed, retaining audit history under retention policy. Verification: worker integration.
- [ ] **SLK-016** [P0; local] Recheck authorization on every send.
  Acceptance: Refuse delivery after actor deactivation, permission changes, connection revocation or destination-policy changes. Verification: negative integration.
- [ ] **SLK-017** [P0; local] Protect shared-channel disclosure.
  Acceptance: Test that private CRM fields cannot leak through notification text, previews, errors or cached payloads. Verification: adversarial cases.
- [ ] **SLK-018** [P0; local] Finish reconnect and revocation recovery.
  Acceptance: Confirm new credentials reset stale health and failed remote revocation remains actionable and unusable locally. Verification: lifecycle integration.
- [ ] **SLK-019** [P0; local] Polish Slack operator onboarding.
  Acceptance: Cover provider app creation, callbacks, scopes, rotation, resource membership and error diagnosis in FA/DE/EN. Verification: operator walkthrough.
- [ ] **SLK-020** [P0; local] Qualify retry and deduplication behavior.
  Acceptance: Exercise duplicate jobs, provider 429/5xx, crashes, delayed responses and resumed workers against the local harness. Verification: fault-injection suite.
- [ ] **SLK-021** [P0; local] Demonstrate the complete local workflow.
  Acceptance: Create a deal, change its stage, inspect the matching rule, message preview, simulated send and delivery history. Verification: local end-to-end.
- [ ] **SLK-022** [P0; local] Prepare a finite live verification script.
  Acceptance: List the sandbox workspace, channel, scopes, message count, cleanup and expected evidence without sending anything yet. Verification: operator review.
- [ ] **SLK-023** [P0; live-provider] Validate the authorized Slack sandbox.
  Acceptance: Complete the approved OAuth/rotation/channel/send/revoke sequence against real Slack with bounded test messages. Verification: live provider.
- [ ] **SLK-024** [P0; local] Publish the connector support record.
  Acceptance: Record tested provider behavior, limitations, version and evidence separately from source-only readiness. Verification: release review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="slkx"></a>
## SLKX: Slack commands, actions and unfurls

Extend validated Slack notifications into user-initiated CRM actions without assuming Slack channel membership grants CRM access.

Milestone: **R5**. Default priority: **P1**. Responsibility: **Integrations + security**.
Package dependencies: SLK, API.

**Exit criterion:** Signed Slack interactions resolve to a verified CRM actor, enforce permissions and produce auditable, safely scoped results.

- [ ] **SLKX-001** [P1; local] Specify command and action workflows.
  Acceptance: Select initial search, create-activity and update-stage actions with clear field requirements and confirmation points. Verification: product scenarios.
- [ ] **SLKX-002** [P1; local] Verify inbound request signatures.
  Acceptance: Reject invalid signatures, expired timestamps, replayed requests and malformed provider payloads before processing. Verification: signature tests.
- [ ] **SLKX-003** [P1; local] Implement Slack-to-CRM identity linking.
  Acceptance: Link only verified accounts with explicit confirmation; do not infer identity from mutable display names or email alone. Verification: identity integration.
- [ ] **SLKX-004** [P1; local] Implement link and unlink management.
  Acceptance: Let users review and revoke linked identities; offboarding invalidates their actions and cached context. Verification: lifecycle tests.
- [ ] **SLKX-005** [P1; local] Implement permission-aware record search.
  Acceptance: Return only visible records and avoid leaking titles or counts through autocomplete and error states. Verification: visibility tests.
- [ ] **SLKX-006** [P1; local] Implement bounded interaction handlers.
  Acceptance: Acknowledge promptly, enqueue slow work and use provider response tokens only for their intended request. Verification: timeout and replay tests.
- [ ] **SLKX-007** [P1; local] Implement action review and commit.
  Acceptance: Review proposed field changes and recheck the actor, record version and grant immediately before mutation. Verification: TOCTOU tests.
- [ ] **SLKX-008** [P1; local] Implement permission-aware unfurls.
  Acceptance: Resolve the requesting actor and disclosure policy before returning record context; do not share-cache private previews. Verification: disclosure tests.
- [ ] **SLKX-009** [P1; local] Implement localized responses.
  Acceptance: Provide useful FA/DE/EN results, errors, time-zone clarification and natural follow-up prompts. Verification: locale contract.
- [ ] **SLKX-010** [P1; local] Implement audit and rate controls.
  Acceptance: Attribute each action to Slack user, CRM user and app, with per-user limits and redacted logs. Verification: abuse tests.
- [ ] **SLKX-011** [P1; local] Qualify the local interaction suite.
  Acceptance: Cover forged payloads, duplicate clicks, revoked users, stale records and provider retries through signed fixtures. Verification: local end-to-end.
- [ ] **SLKX-012** [P1; live-provider] Validate approved Slack interactions live.
  Acceptance: Verify the chosen commands and unfurls in a sandbox without exposing real private CRM data. Verification: live provider.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="aisec"></a>
## AISEC: MCP and application authorization

Constrain existing CRM permissions with explicit client capabilities and current-protocol authorization.

Milestone: **R2**. Default priority: **P0**. Responsibility: **Security + platform**.
Package dependencies: ARCH.

**Exit criterion:** A read-only grant cannot mutate through any tool, UI action or direct request; revoked or reduced access stops on the next request.

- [ ] **AISEC-001** [P0; local] Inventory every current MCP operation.
  Acceptance: Classify the existing tool surface by domain, read/write, outbound effect, ownership and visibility requirements. Verification: source matrix.
- [ ] **AISEC-002** [P0; local] Define granular consent scopes.
  Acceptance: Specify read, write, draft and approved outbound capabilities with understandable FA/DE/EN descriptions. Verification: consent review.
- [ ] **AISEC-003** [P0; local] Map scopes to shared policy.
  Acceptance: Use the ARCH capability vocabulary so MCP, app roles and public API grants cannot diverge. Verification: policy contract.
- [ ] **AISEC-004** [P0; local] Model versioned client grants.
  Acceptance: Store subject, verified client identity, approved capabilities, selected resources, expiry and revocation history. Verification: PostgreSQL migration.
- [ ] **AISEC-005** [P0; local] Migrate existing broad grants.
  Acceptance: Define explicit reconsent or grandfathering behavior; never silently imply an old grant is read-only. Verification: migration and UI.
- [ ] **AISEC-006** [P0; local] Enforce the permission intersection.
  Acceptance: Require both current CRM authority and the client's approved grant for every request and record lookup. Verification: authorization integration.
- [ ] **AISEC-007** [P0; local] Filter tool discovery by capability.
  Acceptance: List only usable tools while also denying unauthorized direct calls to hidden tools. Verification: MCP protocol tests.
- [ ] **AISEC-008** [P0; local] Enforce read-only at mutation boundaries.
  Acceptance: Exercise every write tool and embedded action with a read-only grant, including indirect writes. Verification: negative matrix.
- [ ] **AISEC-009** [P0; local] Validate resource request binding.
  Acceptance: Check the requested resource, audience and issuer consistently during authorization, exchange and token verification. Verification: protocol tests.
- [ ] **AISEC-010** [P0; local] Review current MCP discovery requirements.
  Acceptance: Pin the targeted specification and test protected-resource metadata and authorization-server discovery. Verification: compatibility tests.
- [ ] **AISEC-011** [P0; local] Implement verified client metadata support.
  Acceptance: Validate client identity metadata under strict retrieval and redirect policies; handle unavailable metadata safely. Verification: client metadata tests.
- [ ] **AISEC-012** [P0; local] Constrain legacy dynamic registration.
  Acceptance: Preserve explicitly supported legacy clients while applying policy, rate limits and safe self-reported naming. Verification: registration integration.
- [ ] **AISEC-013** [P0; local] Harden code and PKCE processing.
  Acceptance: Test one-use codes, exact redirect matching, S256 verification, session binding and concurrent exchanges. Verification: replay and concurrency.
- [ ] **AISEC-014** [P0; local] Harden refresh-token families.
  Acceptance: Rotate refresh tokens safely, detect reuse and revoke affected families without widening scope. Verification: token-family tests.
- [ ] **AISEC-015** [P0; local] Implement grant expiry and reconsent.
  Acceptance: Show expiry, scope changes and resource changes clearly; require new consent for broader capabilities. Verification: consent lifecycle.
- [ ] **AISEC-016** [P0; local] Implement immediate revocation.
  Acceptance: Deny access and refresh after user revocation, app disabling or security policy changes. Verification: revocation integration.
- [ ] **AISEC-017** [P0; local] Handle role changes and offboarding.
  Acceptance: Invalidate or constrain execution for disabled users, changed visibility, ownership transfer and suspended apps. Verification: offboarding matrix.
- [ ] **AISEC-018** [P0; local] Integrate fresh verification correctly.
  Acceptance: Reuse Better Auth MFA/passkey/password policy for sensitive grant administration without adding a parallel sign-in flow. Verification: native auth integration.
- [ ] **AISEC-019** [P0; local] Define outbound-action approval.
  Acceptance: Bind any future send/publish operation to explicit policy and a reviewable intent; client hints alone cannot authorize it. Verification: approval design and tests.
- [ ] **AISEC-020** [P0; local] Protect against tool-result injection.
  Acceptance: Treat CRM text, files and upstream messages as untrusted content; prevent them from expanding capabilities or redirecting credentials. Verification: adversarial tests.
- [ ] **AISEC-021** [P0; local] Isolate upstream credentials from clients.
  Acceptance: Test that provider tokens never enter MCP results, app UI payloads, tool errors or diagnostic output. Verification: leakage tests.
- [ ] **AISEC-022** [P0; local] Implement client and grant administration.
  Acceptance: Show verified versus self-reported identity, approved scope, last use and revocation without hiding refreshable grants. Verification: FA/DE/EN browser.
- [ ] **AISEC-023** [P0; local] Qualify the authorization matrix.
  Acceptance: Run admin/member, read/write, visible/hidden record, revoked/expired and stale-session combinations on real PostgreSQL. Verification: security regression.
- [ ] **AISEC-024** [P0; local] Document the supported authorization profile.
  Acceptance: Publish compatibility, legacy behavior, rotation, consent and incident procedures for self-hosters and client developers. Verification: documentation walkthrough.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="mcp"></a>
## MCP: Complete the CRM MCP capability surface

Expand supported CRM workflows deliberately while preserving existing authorization and data contracts.

Milestone: **R2**. Default priority: **P1**. Responsibility: **MCP + domain owners**.
Package dependencies: AISEC.

**Exit criterion:** The capability matrix maps every supported workflow to tools, scopes, validation, failures and tests; unsupported operations are explicit.

- [ ] **MCP-001** [P1; local] Create the domain capability matrix.
  Acceptance: Inventory contacts, organizations, leads, deals, activities, notes, files, custom fields, mail and reports, including known gaps. Verification: source review.
- [ ] **MCP-002** [P1; local] Define stable tool contracts.
  Acceptance: Specify input/output schemas, identifiers, pagination, filtering, sorting and versioning for supported domains. Verification: schema tests.
- [ ] **MCP-003** [P1; local] Complete permission-aware search.
  Acceptance: Support disambiguation and bounded search across visible records without cross-domain count leakage. Verification: visibility integration.
- [ ] **MCP-004** [P1; local] Complete contacts and organization workflows.
  Acceptance: Verify create/update/link/deduplicate behavior, relation validation and current CRM ownership rules. Verification: domain integration.
- [ ] **MCP-005** [P1; local] Complete lead and deal workflows.
  Acceptance: Cover conversion, stage moves, archive/restore and stale-version conflicts without duplicate side effects. Verification: domain integration.
- [ ] **MCP-006** [P1; local] Complete activity workflows.
  Acceptance: Cover assignment, dates, completion and recurrence capabilities only when the underlying calendar domain supports them. Verification: temporal integration.
- [ ] **MCP-007** [P1; local] Add note workflows.
  Acceptance: Enforce parent-record visibility, author policy, rich-text sanitization and revision behavior. Verification: content integration.
- [ ] **MCP-008** [P1; local] Add file and attachment workflows.
  Acceptance: Enforce file ownership, signed access, size/type limits and attachment visibility without exposing private storage credentials. Verification: file security tests.
- [ ] **MCP-009** [P1; local] Add custom-field discovery and validation.
  Acceptance: Expose permitted field metadata and validate typed values against current schema and role policy. Verification: schema integration.
- [ ] **MCP-010** [P1; local] Add useful report and pipeline summaries.
  Acceptance: Provide bounded aggregates with explicit filters, time zone and field-level permission rules. Verification: aggregate visibility.
- [ ] **MCP-011** [P1; local] Complete mailbox and draft workflows.
  Acceptance: Preserve actor mailbox ownership, unsent-draft semantics and separate any future sending capability. Verification: mailbox integration.
- [ ] **MCP-012** [P1; local] Define destructive-operation policy.
  Acceptance: Preserve existing hard limits until a documented product decision authorizes additional destructive tools and recovery behavior. Verification: policy review.
- [ ] **MCP-013** [P1; local] Implement safe mutation idempotency.
  Acceptance: Define retry keys or conflict detection for creates, updates and multi-record workflows. Verification: concurrency tests.
- [ ] **MCP-014** [P1; local] Implement consistent tool errors.
  Acceptance: Return stable error IDs, safe localized explanations and retry guidance without stack traces or secrets. Verification: protocol contract.
- [ ] **MCP-015** [P1; local] Verify annotations and structured results.
  Acceptance: Keep actual behavior aligned with schemas and read-only/destructive hints while retaining text fallback. Verification: tool metadata tests.
- [ ] **MCP-016** [P1; local] Add task cancellation and resource limits.
  Acceptance: Bound requests, pagination, batch sizes and file work, propagating AbortSignal and releasing resources. Verification: cancellation tests.
- [ ] **MCP-017** [P1; local] Build repeatable client workflow fixtures.
  Acceptance: Exercise meeting preparation, pipeline review and unsent drafts using synthetic CRM data and approved scopes. Verification: end-to-end protocol.
- [ ] **MCP-018** [P1; local] Publish the capability and limitation reference.
  Acceptance: Keep documented tools, scope requirements, unsupported actions and tested client versions synchronized with release artifacts. Verification: docs consistency.
- [ ] **MCP-019** [P1; local] Define the negotiated MCP capability profile.
  Acceptance: Specify tools, resources/templates, prompts, logging/progress, notifications and optional features per supported protocol/client version; advertise only implemented capabilities. Verification: protocol matrix.
- [ ] **MCP-020** [P1; local] Implement scoped resources and templates.
  Acceptance: Resolve visible CRM context and permitted files through resource identities with the same grant, actor and field policy as tools. Verification: resource authorization tests.
- [ ] **MCP-021** [P1; local] Implement reusable protocol prompts.
  Acceptance: Provide parameterized CRM prompts with stable identifiers, natural FA/DE/EN instructions and clear requirements without expanding execution authority. Verification: prompt conformance.
- [ ] **MCP-022** [P1; local] Implement supported MCP change notifications.
  Acceptance: Deliver only negotiated resource/tool changes through bounded authenticated connections; expiry and revocation stop delivery and private data cannot leak. Verification: event and cancellation tests.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="client"></a>
## CLIENT: ChatGPT, Claude and supporting client apps

Ship client-specific onboarding, packages, workflows and optional embedded experiences over the same authorized server.

Milestone: **R2**. Default priority: **P1**. Responsibility: **MCP + client UX**.
Package dependencies: MCP, UX.

**Exit criterion:** Local conformance passes for every claimed client profile; live installation and rich UI support are recorded separately per host.

- [ ] **CLIENT-001** [P1; local] Define the host compatibility matrix.
  Acceptance: Distinguish ChatGPT web/desktop, Codex, Claude web/desktop, Claude Code and generic MCP transports without assuming package portability proves host support. Verification: source and protocol review.
- [ ] **CLIENT-002** [P1; local] Revalidate current package specifications.
  Acceptance: Pin official manifest and configuration schemas for each target before changing generated packages. Verification: schema review.
- [ ] **CLIENT-003** [P1; local] Version the package builder.
  Acceptance: Produce reproducible client artifacts with server origin, compatibility metadata, license and no embedded credentials. Verification: package tests.
- [ ] **CLIENT-004** [P1; local] Validate the ChatGPT/Codex artifact.
  Acceptance: Check manifest, skills, MCP transport, authentication metadata and paths against the supported OpenAI package profile. Verification: package conformance.
- [ ] **CLIENT-005** [P1; local] Validate the Claude Code artifact.
  Acceptance: Check manifest, MCP configuration, skill discovery and installation layout independently of Claude's hosted connector workflow. Verification: package conformance.
- [ ] **CLIENT-006** [P1; local] Document Claude hosted connector onboarding.
  Acceptance: Cover its own authorization path, organization controls, reconnect and removal with current official instructions. Verification: onboarding review.
- [ ] **CLIENT-007** [P1; local] Complete localized workflow skills.
  Acceptance: Review meeting, pipeline and draft instructions in FA/DE/EN with explicit record matching and uncertain-date handling. Verification: workflow evaluations.
- [ ] **CLIENT-008** [P1; local] Define useful embedded CRM views.
  Acceptance: Select record summary, pipeline summary and meeting context views with text equivalents and clear action boundaries. Verification: Mobbin and host UX review.
- [ ] **CLIENT-009** [P1; local] Implement shared presentation data contracts.
  Acceptance: Use typed, minimal view models without raw database rows, private tokens or authority in browser-provided fields. Verification: schema and leakage tests.
- [ ] **CLIENT-010** [P1; local] Implement ChatGPT presentation adapter.
  Acceptance: Use the host's supported MCP UI extension, origin/CSP rules and explicit capability declarations. Verification: host harness.
- [ ] **CLIENT-011** [P1; local] Implement supported Claude presentation adapter.
  Acceptance: Verify actual supported UI capabilities and provide a functional text-only path when unavailable. Verification: host harness.
- [ ] **CLIENT-012** [P1; local] Implement authorized embedded actions.
  Acceptance: Revalidate identity, grant, resource, input and record version server-side for every action from a view. Verification: authorization integration.
- [ ] **CLIENT-013** [P1; local] Implement locale and theme adaptation.
  Acceptance: Respect FA RTL, DE labels, number/calendar choices and host light/dark settings without altering stored dates. Verification: host visual matrix.
- [ ] **CLIENT-014** [P1; local] Implement accessible host fallback.
  Acceptance: Keep all workflows usable through standard tools/text when rich UI cannot load or is unsupported. Verification: fallback tests.
- [ ] **CLIENT-015** [P1; local] Qualify package install/update/remove locally.
  Acceptance: Validate clean install, upgrade, missing files, incompatible host versions and removal without treating removal as token revocation. Verification: package lifecycle.
- [ ] **CLIENT-016** [P1; local] Qualify OAuth against local client simulators.
  Acceptance: Test discovery, consent, PKCE, expiry, refresh, reconsent and revocation with simulated hosts. Verification: protocol end-to-end.
- [ ] **CLIENT-017** [P1; local] Prepare bounded live client tests.
  Acceptance: List the HTTPS endpoint, synthetic records, allowed operations and clean-up for each host profile. Verification: operator review.
- [ ] **CLIENT-018** [P1; live-provider] Validate ChatGPT/Codex connections live.
  Acceptance: Record actual supported host versions, authentication, permitted tools and embedded-view behavior when enabled. Verification: host integration.
- [ ] **CLIENT-019** [P1; live-provider] Validate Claude connections live.
  Acceptance: Verify hosted and Code workflows separately, including refresh, revocation, locale and host fallback. Verification: host integration.
- [ ] **CLIENT-020** [P1; publication] Prepare client distribution assets.
  Acceptance: Produce accurate descriptions, screenshots, support links and versioned archives; publish only when that distribution stage is chosen. Verification: package review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="mail"></a>
## MAIL: Mail integration hardening

Preserve Gmail behavior while moving account management onto the shared lifecycle and preparing for more providers.

Milestone: **IR1**. Default priority: **P0**. Responsibility: **Email + integrations**.

The approved independent-email slice starts early after reviewed shared contracts. MAIL-012 retains its separate Gmail live-provider gate; implementation records from the ongoing email branch must be reconciled rather than duplicated.
Package dependencies: CONN.

**Exit criterion:** Existing mail flows remain intact and multi-account or shared-mailbox changes follow explicit ownership and migration rules.

- [ ] **MAIL-001** [P0; local] Inventory Gmail behavior and ownership.
  Acceptance: Record sync, drafts, send, scheduled send, tracking, domain restrictions and current single-mailbox assumptions. Verification: source review.
- [ ] **MAIL-002** [P0; local] Define the multi-account policy.
  Acceptance: Decide personal, shared and delegated mailbox ownership and duplicate-address behavior before relaxing existing constraints. Verification: design scenarios.
- [ ] **MAIL-003** [P0; local] Migrate mailbox connection metadata.
  Acceptance: Preserve account IDs, history, queued sends, ownership and credential references without duplicating messages. Verification: PostgreSQL migration.
- [ ] **MAIL-004** [P0; local] Implement account selection in mail workflows.
  Acceptance: Make the sending/sync account explicit and prevent accidental use of another member's mailbox. Verification: ownership integration.
- [ ] **MAIL-005** [P0; local] Unify Gmail reconnect and health.
  Acceptance: Surface last sync, last check, authorization failure and stale synchronization as distinct states. Verification: worker and UI tests.
- [ ] **MAIL-006** [P0; local] Preserve safe send and draft boundaries.
  Acceptance: Keep unsent drafts, scheduled sends, approval policy and permission checks consistent through integrations and MCP. Verification: send regressions.
- [ ] **MAIL-007** [P0; local] Implement import and sync controls.
  Acceptance: Define date/sender filters, historical import limits, exclusions and cancellation without leaking excluded content. Verification: sync integration.
- [ ] **MAIL-008** [P0; local] Review disconnect and retained data.
  Acceptance: Explain token revocation, queued-send cancellation and whether already imported CRM records remain. Verification: removal scenarios.
- [ ] **MAIL-009** [P0; local] Implement connection and sync diagnostics.
  Acceptance: Show actionable, localized failures without logging message bodies or credentials by default. Verification: browser and leakage tests.
- [ ] **MAIL-010** [P0; local] Qualify multi-account regressions.
  Acceptance: Exercise duplicate connections, reconnect, owner changes, partial imports and concurrent send/sync operations. Verification: real PostgreSQL suite.
- [ ] **MAIL-011** [P0; local] Update operator and user guides.
  Acceptance: Cover Google app setup, account policy, sync recovery and mailbox selection in FA/DE/EN. Verification: walkthrough.
- [ ] **MAIL-012** [P1; live-provider] Validate approved Google mail accounts.
  Acceptance: Use bounded synthetic mail to verify consent, sync, drafts, sending where authorized, refresh and revocation. Verification: live provider.

- [ ] **MAIL-013** [P0; local] Qualify independent mail protocols on Bun.
  Acceptance: Pin supported IMAP/SMTP and MIME library profiles, TLS and safe-endpoint behavior on the declared Bun runtime; preserve existing Gmail and auth boundaries. Reuse CONN policy, credentials and lifecycle contracts rather than creating another registry. Verification: Bun and controlled TLS protocol tests.
- [ ] **MAIL-014** [P0; local] Implement independent IMAP synchronization.
  Acceptance: Use account/folder/UIDVALIDITY/UID identities, explicit folder capabilities, resumable bounded history and cursor-reset recovery. Preserve ownership and reject duplicate Gmail-API/IMAP identities unless an explicit verified migration is performed. Verification: protocol and PostgreSQL integration.
- [ ] **MAIL-015** [P0; local] Implement SMTP submission and MIME authoring.
  Acceptance: Reuse the existing durable mail outbox for authorized compose/reply/forward and scheduling; qualify TLS, attachments, partial recipients and Sent copies. Preserve uncertain outcomes without blind retries or a claim of recipient delivery from submission acceptance. Verification: protocol and outbox fault tests.
- [ ] **MAIL-016** [P0; local] Qualify independent mail content and attachments.
  Acceptance: Decode Persian/German MIME headers, bodies and filenames with bounded resources and safe HTML; downloads retain actor/mailbox/attachment visibility checks and use provider-neutral locators. Verification: MIME, leakage and attachment integration.
- [ ] **MAIL-017** [P0; local] Qualify remote mail capabilities and local archive.
  Acceptance: Expose read-only and supported flag/move/trash/Sent operations accurately, reject unsupported writes server-side and keep local CRM archive distinct from remote deletion. Verification: mailbox and capability integration.
- [ ] **MAIL-018** [P0; local] Qualify independent mail offboarding and recovery.
  Acceptance: Fence old sync/send/refresh jobs on pause, disconnect, suspension or credential replacement; reuse CONN/offboarding workers. Show any provider-side manual revocation action, since local password deletion does not revoke the remote credential. Verification: concurrency and offboarding fault tests.
- [ ] **MAIL-019** [P0; local] Complete independent mail UI and operator flows.
  Acceptance: Retain the current UI and CONN management patterns; include multiple personal mailboxes, explicit default sender, editable Inbox/Sent 90-day history defaults and complete FA/DE/EN setup, error, recovery and keyboard/mobile states. Shared/delegated policy remains separately qualified. Verification: FA/DE/EN browser and workflow tests.
- [ ] **MAIL-020** [P0; live-provider] Validate approved independent mail installations.
  Acceptance: On approved test resources, verify Google-free core login and customer email, initial/history sync, sending, recovery and restore. Record self-hosted and external-service evidence separately; no unapproved customer account or live message is authorized by this planning task. Verification: finite authorized provider acceptance.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="cal"></a>
## CAL: Calendar domain and event workflow

Implement the existing Google Calendar workflow specification in a provider-neutral event domain with Iranian-calendar correctness.

Milestone: **R3**. Default priority: **P0**. Responsibility: **Calendar + localization**.
Package dependencies: ARCH, UX.

**Exit criterion:** Event creation/editing, recurrence, permissions and communication decisions have explicit semantics and round-trip correctly across calendars and time zones.

- [ ] **CAL-001** [P0; local] Map the existing calendar workflow specification.
  Acceptance: Turn each section of google-calendar-event-workflow.md into supported, conditional, later or unsupported acceptance cases. Verification: requirements trace.
- [ ] **CAL-002** [P0; local] Define event identities and provider bindings.
  Acceptance: Distinguish CRM activity, event, series, occurrence, provider copy, organizer and calendar ownership. Verification: domain model review.
- [ ] **CAL-003** [P0; local] Define time and all-day storage.
  Acceptance: Use instants for timed events and explicit local dates for all-day events; preserve source time zone and original identifiers. Verification: temporal contract.
- [ ] **CAL-004** [P0; local] Define Iranian recurrence semantics.
  Acceptance: Decide how Solar Hijri recurrence is represented and what cannot round-trip to a provider's supported recurrence model. Verification: recurrence spike.
- [ ] **CAL-005** [P0; local] Implement ordinary event fields.
  Acceptance: Cover title, description, location, start/end, all-day, calendar, color, visibility and availability from the existing spec. Verification: domain and UI.
- [ ] **CAL-006** [P0; local] Implement attendee and RSVP models.
  Acceptance: Distinguish organizer, guests, optional attendance, response state and guest permission controls. Verification: role and attendee tests.
- [ ] **CAL-007** [P0; local] Implement recurrence rules and exceptions.
  Acceptance: Cover intervals, weekdays, end conditions, single-instance changes, cancellations and series identity. Verification: recurrence fixtures.
- [ ] **CAL-008** [P0; local] Implement recurring edit scopes.
  Acceptance: Distinguish this occurrence, following occurrences and entire series with reviewable consequences. Verification: domain and browser.
- [ ] **CAL-009** [P0; local] Implement date and time validation.
  Acceptance: Handle end-before-start, invalid dates, ambiguous/nonexistent local times and explicit time-zone changes. Verification: temporal boundary tests.
- [ ] **CAL-010** [P0; local] Implement reminders separately from invitations.
  Acceptance: Preserve personal reminder settings and model invitation/update delivery decisions independently. Verification: communication scenarios.
- [ ] **CAL-011** [P0; local] Implement save and update review.
  Acceptance: Review guest changes, conference changes, attachment access and outgoing update choices before committing. Verification: FA/DE/EN browser.
- [ ] **CAL-012** [P0; local] Implement privacy and visibility enforcement.
  Acceptance: Prevent hidden event, guest, location or file information leaking through calendars, APIs, tools and notifications. Verification: visibility matrix.
- [ ] **CAL-013** [P0; local] Implement attachment linking.
  Acceptance: Verify current file access and provider sharing constraints before linking files to an event. Verification: file permission tests.
- [ ] **CAL-014** [P0; local] Implement conflict and availability views.
  Acceptance: Surface known conflicts and freshness, without claiming unavailable resource or guest availability is verified. Verification: stale-data scenarios.
- [ ] **CAL-015** [P0; local] Implement cancellation and recovery.
  Acceptance: Preserve organizer/guest distinctions, recurring scope, update notifications and supported recovery paths. Verification: deletion/recovery tests.
- [ ] **CAL-016** [P0; local] Define special event-type capability flags.
  Acceptance: Treat tasks, appointments, focus time, out-of-office, working location and birthdays as separate entitled workflows. Verification: capability review.
- [ ] **CAL-017** [P0; local] Implement the supported special event types.
  Acceptance: Deliver each type only when its native domain and selected provider can preserve the required fields; mark the rest explicitly. Verification: domain and browser.
- [ ] **CAL-018** [P0; local] Implement calendar UI state coverage.
  Acceptance: Review create/edit/view, guest search, recurrence, reminders, permission denial and connection failures using Mobbin references. Verification: visual matrix.
- [ ] **CAL-019** [P0; local] Implement calendar search and export boundaries.
  Acceptance: Define ICS import/export and a CalDAV feasibility decision, with bounded parsing and safe external URL policy. Verification: parser and design tests.
- [ ] **CAL-020** [P0; local] Qualify locale and time-zone round trips.
  Acceptance: Test FA/DE with Gregorian and Iranian display, Tehran/Berlin zones, historical transitions, all-day events and recurrence boundaries. Verification: temporal regression.
- [ ] **CAL-021** [P0; local] Qualify keyboard and mobile event editing.
  Acceptance: Test focus, date pickers, dialogs, long labels, RTL guest lists and narrow conference controls. Verification: browser accessibility.
- [ ] **CAL-022** [P0; local] Publish the calendar capability map.
  Acceptance: Link each promised field and workflow to evidence, provider support and documented limitations. Verification: documentation trace.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="goog"></a>
## GOOG: Google Calendar and Google Meet

Provide selected-calendar synchronization and meeting creation through the shared connection and calendar contracts.

Milestone: **R3**. Default priority: **P1**. Responsibility: **Google integrations**.
Package dependencies: CAL, CONN, EVT.

**Exit criterion:** Synthetic changes converge between CRM and a local Google simulator; a separate live gate verifies the claimed account capabilities.

- [ ] **GOOG-001** [P1; local] Audit current Google API requirements.
  Acceptance: Verify current scopes, event/conference methods, account entitlements, quotas and verification requirements from official documentation. Verification: provider review.
- [ ] **GOOG-002** [P1; local] Implement Google calendar authorization.
  Acceptance: Use the shared OAuth lifecycle and review additional calendar scopes separately from Gmail authorization. Verification: OAuth contract.
- [ ] **GOOG-003** [P1; local] Implement calendar discovery and selection.
  Acceptance: Show ownership/access role, allow multiple selected calendars and refuse writes to read-only resources. Verification: provider and UI.
- [ ] **GOOG-004** [P1; local] Implement bounded initial synchronization.
  Acceptance: Import a selected time range with progress, cancellation, pagination and duplicate protection. Verification: sync integration.
- [ ] **GOOG-005** [P1; local] Implement incremental synchronization.
  Acceptance: Persist cursors and resume safely; recover expired/invalid cursors without losing bindings or duplicating events. Verification: cursor fault injection.
- [ ] **GOOG-006** [P1; local] Implement authenticated change notifications.
  Acceptance: Validate provider channel identity, renew expiring subscriptions and fall back to safe polling when needed. Verification: webhook contract.
- [ ] **GOOG-007** [P1; local] Implement outbound event creation.
  Acceptance: Preserve title, timing, all-day dates, guests, privacy and organizer policy through the supported provider fields. Verification: event round trip.
- [ ] **GOOG-008** [P1; local] Implement outbound event update and cancel.
  Acceptance: Use version/conflict checks and explicit attendee-update policy instead of silent overwrite. Verification: conflict integration.
- [ ] **GOOG-009** [P1; local] Implement inbound change reconciliation.
  Acceptance: Process external edits, deletions and RSVP changes with source provenance and loop prevention. Verification: sync scenarios.
- [ ] **GOOG-010** [P1; local] Implement recurring event mapping.
  Acceptance: Round-trip series IDs, exceptions and supported edit scopes; refuse or explain unsupported Solar Hijri recurrence mappings. Verification: recurrence fixtures.
- [ ] **GOOG-011** [P1; local] Implement Google Meet provisioning.
  Acceptance: Create, replace and remove conference data only through authorized provider operations, with pending/failure states. Verification: conference contract.
- [ ] **GOOG-012** [P1; local] Implement supported Meet options.
  Acceptance: Expose only verified account-entitled pre-meeting controls from the calendar spec and keep unsupported controls out of active forms. Verification: capability tests.
- [ ] **GOOG-013** [P1; local] Implement attachment and sharing checks.
  Acceptance: Validate Drive attachment access and explain required provider-side sharing without implying a link grants access. Verification: sharing scenarios.
- [ ] **GOOG-014** [P1; local] Implement sync conflict resolution UI.
  Acceptance: Show changed fields, source timestamps and a reviewable resolution for simultaneous CRM/provider edits. Verification: FA/DE/EN browser.
- [ ] **GOOG-015** [P1; local] Implement sync health and repair.
  Acceptance: Provide last success, pending changes, failed items, scoped retry and full-resync preview. Verification: repair drill.
- [ ] **GOOG-016** [P1; local] Implement calendar deselection and disconnect.
  Acceptance: Stop jobs, subscriptions and writes while applying an explicit imported-data retention policy. Verification: lifecycle tests.
- [ ] **GOOG-017** [P1; local] Qualify Google failure cases locally.
  Acceptance: Cover rate limits, expired tokens, forbidden calendars, deleted resources, cursor loss and duplicate notifications. Verification: provider simulator.
- [ ] **GOOG-018** [P1; local] Prepare Google account qualification matrix.
  Acceptance: Separate consumer and Workspace capabilities; select finite synthetic events, guests and conference tests. Verification: operator review.
- [ ] **GOOG-019** [P1; live-provider] Validate authorized Google calendars live.
  Acceptance: Verify create/edit/RSVP/recurrence/sync/Meet/revoke behavior for the supported account profiles. Verification: live provider.
- [ ] **GOOG-020** [P1; local] Publish Google support and migration notes.
  Acceptance: Record verified controls, limitations, recovery and provider changes independently of the target Google workflow inventory. Verification: release review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="ms"></a>
## MS: Microsoft 365, Outlook and Teams

Add Microsoft account, tenant, mail, calendar and Teams workflows without assuming Google behavior transfers directly.

Milestone: **R4**. Default priority: **P1**. Responsibility: **Microsoft integrations**.
Package dependencies: MAIL, CAL, CONN, EVT.

Task-level exception: MS-001 through MS-005 are the approved independent mail subtrack (IR3) and depend on MAIL/CONN/EVT local foundations. CAL remains a prerequisite for calendar/Teams/shared-resource work, not a blocker for mail-only engineering.

**Exit criterion:** Selected Microsoft resources use the common lifecycle and show tenant/permission constraints with documented synchronization semantics.

- [ ] **MS-001** [P1; local] Audit Microsoft account and tenant policy.
  Acceptance: Verify supported account types, consent modes, current Graph permissions and administrative restrictions. Verification: official provider review.
- [ ] **MS-002** [P1; local] Implement Microsoft OAuth and refresh.
  Acceptance: Use verified authority/tenant boundaries, stable account identity and the shared credential lifecycle. Verification: OAuth contract.
- [ ] **MS-003** [P1; local] Implement account and resource selection.
  Acceptance: Distinguish tenant, user, mailbox and calendar and expose actual delegated resource permissions. Verification: ownership and UI.
- [ ] **MS-004** [P1; local] Implement Outlook mail adapter.
  Acceptance: Preserve thread/message identity, ownership, drafts and send/scheduled-send policy through the existing mail domain. Verification: mailbox integration.
- [ ] **MS-005** [P1; local] Implement mail synchronization recovery.
  Acceptance: Handle paging, incremental cursors, provider changes and duplicate delivery without importing excluded content. Verification: sync fault injection.
- [ ] **MS-006** [P1; local] Implement Outlook calendar adapter.
  Acceptance: Map ordinary fields, all-day dates, attendee roles, privacy and recurrence through the CAL contract. Verification: calendar round trip.
- [ ] **MS-007** [P1; local] Implement calendar subscriptions and recovery.
  Acceptance: Verify inbound notifications, renew subscriptions and recover gaps through bounded synchronization. Verification: webhook and cursor tests.
- [ ] **MS-008** [P1; local] Implement Microsoft conflict resolution.
  Acceptance: Preserve concurrent edits and organizer distinctions rather than silently overwriting one source. Verification: conflict scenarios.
- [ ] **MS-009** [P1; local] Implement Teams meeting lifecycle.
  Acceptance: Create/update/cancel supported online meetings with proper organizer permissions and clear provider errors. Verification: conference contract.
- [ ] **MS-010** [P1; local] Implement entitled Teams options.
  Acceptance: Show only supported options for the selected tenant/account; document limits instead of presenting universal controls. Verification: capability matrix.
- [ ] **MS-011** [P1; local] Implement delegated and shared-resource policy.
  Acceptance: Support only explicitly permitted shared mailboxes/calendars and reject scope or tenant mismatches. Verification: authorization tests.
- [ ] **MS-012** [P1; local] Implement tenant-policy and consent recovery UI.
  Acceptance: Explain admin approval, denied permissions, expired authorization and unavailable resources in FA/DE/EN. Verification: browser scenarios.
- [ ] **MS-013** [P1; local] Qualify mail/calendar/Teams failures locally.
  Acceptance: Cover revoked grants, tenant mismatch, duplicate notifications, resource removal and rate limits. Verification: provider simulator.
- [ ] **MS-014** [P1; local] Prepare a finite Microsoft live matrix.
  Acceptance: Select test tenant/accounts, admin-consent steps, synthetic data and cleanup boundaries. Verification: operator review.
- [ ] **MS-015** [P1; live-provider] Validate authorized Microsoft resources live.
  Acceptance: Verify supported mail, event, sync, Teams, refresh and revocation workflows against actual test resources. Verification: live provider.
- [ ] **MS-016** [P1; local] Publish Microsoft operational guidance.
  Acceptance: Document tenant setup, permissions, account limitations, troubleshooting and tested capabilities. Verification: release review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="zoom"></a>
## ZOOM: Zoom conferencing

Manage authorized Zoom meetings as part of CRM event workflows using the same provider-neutral conference contract.

Milestone: **R4**. Default priority: **P1**. Responsibility: **Conferencing integrations**.
Package dependencies: CAL, CONN, EVT.

**Exit criterion:** Meeting creation, update and cancellation are tied to the correct host account and remain consistent with the CRM event.

- [ ] **ZOOM-001** [P1; local] Audit Zoom application and account requirements.
  Acceptance: Verify current OAuth app types, scopes, host entitlements, provider review and supported meeting settings. Verification: official provider review.
- [ ] **ZOOM-002** [P1; local] Implement Zoom OAuth and token refresh.
  Acceptance: Bind the verified host account, handle rotation and revoked authorization through the shared lifecycle. Verification: OAuth contract.
- [ ] **ZOOM-003** [P1; local] Define conference ownership and settings.
  Acceptance: Separate organizer, host, join link, passcode and provider-private fields with an explicit disclosure policy. Verification: permission design.
- [ ] **ZOOM-004** [P1; local] Implement meeting creation.
  Acceptance: Validate event timing and host authority and persist provider identity only after a confirmed response. Verification: conference contract.
- [ ] **ZOOM-005** [P1; local] Implement update and cancellation.
  Acceptance: Reconcile time, recurrence and cancellation changes with explicit failure and retry states. Verification: round-trip tests.
- [ ] **ZOOM-006** [P1; local] Implement supported meeting controls.
  Acceptance: Expose verified host/account-entitled options without displaying unsupported provider fields. Verification: capability and UI.
- [ ] **ZOOM-007** [P1; local] Handle provider-event synchronization.
  Acceptance: Validate signed inbound events and reconcile externally changed or removed meetings without loops. Verification: webhook tests.
- [ ] **ZOOM-008** [P1; local] Implement conference recovery UI.
  Acceptance: Show pending creation, expired authorization, failed update and orphaned meeting repair with localized actions. Verification: FA/DE/EN browser.
- [ ] **ZOOM-009** [P1; local] Qualify recurrence and time-zone behavior.
  Acceptance: Test recurring and one-off meetings against the CAL contract, including unsupported combinations. Verification: temporal and provider tests.
- [ ] **ZOOM-010** [P1; local] Qualify failure and duplicate creation cases.
  Acceptance: Exercise timeout ambiguity, retries, lost responses and deleted host resources without blind duplicate creation. Verification: fault injection.
- [ ] **ZOOM-011** [P1; live-provider] Validate authorized Zoom host accounts live.
  Acceptance: Verify a finite create/update/cancel/refresh/revoke sequence with synthetic meetings. Verification: live provider.
- [ ] **ZOOM-012** [P1; local] Publish Zoom support boundaries.
  Acceptance: Record account requirements, verified options, failure recovery and what the CRM cannot provision. Verification: release review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="api"></a>
## API: Public API and signed webhooks

Provide supported external integration APIs and events using the same domain commands and permission evaluator as the application.

Milestone: **R5**. Default priority: **P1**. Responsibility: **Platform + developer experience**.
Package dependencies: ARCH, AISEC, EVT.

**Exit criterion:** Scoped API clients can perform documented operations and consume authenticated, retryable events without bypassing CRM visibility.

- [ ] **API-001** [P1; local] Define the public API compatibility contract.
  Acceptance: Specify stable resources, identifiers, pagination, errors, filters, temporal values, numeric precision and versioning. Verification: schema review.
- [ ] **API-002** [P1; local] Implement API client and service grants.
  Acceptance: Separate interactive users and approved service identities, with minimal capabilities, expiry and revocation. Verification: authorization integration.
- [ ] **API-003** [P1; local] Expose supported CRM read endpoints.
  Acceptance: Reuse current visibility/field policy for contacts, organizations, leads, deals, activities and metadata. Verification: endpoint tests.
- [ ] **API-004** [P1; local] Expose supported CRM mutation endpoints.
  Acceptance: Reuse domain validation, idempotency and audit attribution rather than writing directly through unrestricted database access. Verification: domain integration.
- [ ] **API-005** [P1; local] Generate OpenAPI documentation and examples.
  Acceptance: Validate examples against actual routes and include scope requirements, paging, safe errors and locale-independent wire formats. Verification: schema conformance.
- [ ] **API-006** [P1; local] Define GraphQL parity requirements.
  Acceptance: Specify the supported GraphQL surface and shared authorization/validation rules, with explicit complexity and pagination bounds. Verification: design review.
- [ ] **API-007** [P1; local] Implement authorized GraphQL resolvers.
  Acceptance: Resolve through the same domain policy and enforce depth, cost, batch and field-access limits. Verification: GraphQL negative tests.
- [ ] **API-008** [P1; local] Qualify REST and GraphQL consistency.
  Acceptance: Equivalent requests must have matching authorization, filters, data types and mutation outcomes. Verification: cross-interface contract.
- [ ] **API-009** [P1; local] Implement external API rate and concurrency limits.
  Acceptance: Apply per-client quotas and bounded request sizes without leaking credential or user information through errors. Verification: abuse tests.
- [ ] **API-010** [P1; local] Implement webhook subscriptions.
  Acceptance: Store event selection, owner, destination, secret version and resource/data policy with administrator controls. Verification: PostgreSQL and UI.
- [ ] **API-011** [P1; local] Implement signed outbound delivery.
  Acceptance: Sign canonical payloads with timestamps and IDs, retaining secret rotation metadata and explicit replay guidance. Verification: signature tests.
- [ ] **API-012** [P1; local] Implement safe endpoint registration.
  Acceptance: Validate URLs, DNS, redirects and egress policy, including explicit administrator-managed intranet exceptions. Verification: SSRF tests.
- [ ] **API-013** [P1; local] Implement delivery retries and rotation.
  Acceptance: Reuse EVT scheduling, backoff, deduplication and failure history, with overlapping signing-key rotation. Verification: fault injection.
- [ ] **API-014** [P1; local] Implement webhook management UI.
  Acceptance: Include test preview, enable/disable, delivery logs, retry and secret rotation without revealing stored secrets. Verification: FA/DE/EN browser.
- [ ] **API-015** [P1; local] Implement inbound integration endpoints.
  Acceptance: Validate provider signatures or scoped credentials and replay bounds before producing domain commands. Verification: replay and validation.
- [ ] **API-016** [P1; local] Implement bounded exports and bulk operations.
  Acceptance: Enforce scope, record visibility, cancellation, limits and partial-failure reporting. Verification: batch integration.
- [ ] **API-017** [P1; local] Publish a typed Bun/TypeScript client.
  Acceptance: Generate supported types and examples with AbortSignal and Result-style operational failures. Verification: client conformance.
- [ ] **API-018** [P1; local] Publish API and webhook examples.
  Acceptance: Provide local examples for record creation, pagination, signed events, retries and revocation without embedding credentials. Verification: developer walkthrough.
- [ ] **API-019** [P1; local] Qualify local external-consumer scenarios.
  Acceptance: Exercise the API from a separate local client with restricted grants, failures and key rotation. Verification: end-to-end contract.
- [ ] **API-020** [P1; live-provider] Validate approved external consumers.
  Acceptance: Verify finite requests and webhook delivery against explicitly configured live endpoints before claiming production compatibility. Verification: external consumer test.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="auto"></a>
## AUTO: Workflow and automation integrations

Connect native workflows and automation providers through reusable triggers/actions and the authorized API.

Milestone: **R5**. Default priority: **P2**. Responsibility: **Workflows + integrations**.
Package dependencies: API, EVT.

**Exit criterion:** A workflow can react to a CRM event and call an integration action with traceable permissions, variables, retries and cancellation.

- [ ] **AUTO-001** [P2; local] Inventory the actual workflow engine.
  Acceptance: Reconcile merged and parallel implementations and adopt one source of truth for triggers, steps, runs and permissions. Verification: source review.
- [ ] **AUTO-002** [P2; local] Register integration triggers and actions.
  Acceptance: Use stable schemas and capability declarations that can later be exposed through the app SDK. Verification: contract tests.
- [ ] **AUTO-003** [P2; local] Implement data mapping and validation.
  Acceptance: Type-check step inputs, outputs and missing/deleted field references with useful localized errors. Verification: mapping tests.
- [ ] **AUTO-004** [P2; local] Implement conditions and iteration contracts.
  Acceptance: Bound branching and array iteration and preserve explicit per-step permission checks. Verification: execution tests.
- [ ] **AUTO-005** [P2; local] Implement delays and schedules.
  Acceptance: Reuse pg-boss with cancel/resume semantics, time zones and changed-record handling. Verification: temporal tests.
- [ ] **AUTO-006** [P2; local] Constrain HTTP, code and AI actions.
  Acceptance: Apply egress/capability policy and route untrusted code to the isolated runtime; prohibit web-process evaluation. Verification: isolation and policy tests.
- [ ] **AUTO-007** [P2; local] Implement run inspection and repair.
  Acceptance: Show step status, redacted inputs/outputs, failure cause and safe finite retry without silently re-running completed side effects. Verification: browser and replay tests.
- [ ] **AUTO-008** [P2; local] Build the n8n connector.
  Acceptance: Provide documented credentials, record triggers/actions and local fixtures against the supported public API. Verification: connector contract.
- [ ] **AUTO-009** [P2; local] Build the Make integration profile.
  Acceptance: Define supported modules, authentication and webhook behavior, with a local end-to-end example. Verification: connector contract.
- [ ] **AUTO-010** [P2; local] Build the Zapier integration profile.
  Acceptance: Define supported triggers/actions, authorization and pagination with a local test project. Verification: connector contract.
- [ ] **AUTO-011** [P2; local] Create localized automation recipes.
  Acceptance: Include deal-stage alerts, overdue reminders and meeting preparation with permissions and failure behavior explained. Verification: FA/DE/EN walkthrough.
- [ ] **AUTO-012** [P2; publication] Validate and distribute approved automation packages.
  Acceptance: Record live compatibility and provider publication/review separately for n8n, Make and Zapier. Verification: provider review and install.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="exp"></a>
## EXP: Additional provider delivery tracks

Deliver each additional named provider independently; telephony, accounting and e-signature vendor selection remain product decisions.

Milestone: **R6**. Default priority: **P2**. Responsibility: **Provider owners**.
Package dependencies: CONN, EVT, API, UX.

Task-level exception: EXP-041 through EXP-048 are the approved P1 / IR3 PBX and conditional accounting tracks. They consume CONN/EVT/UX foundations and applicable ingress/security contracts, rather than waiting for the entire public API or marketplace. The other EXP tracks keep their original priorities and dependencies.

**Exit criterion:** Every released provider has its own supported workflows, local contract tests, localized management flow and live qualification record.

- [ ] **EXP-001** [P2; local] Specify Google Drive workflows.
  Acceptance: Select accessible files/folders, link documents to CRM records and preserve source-file sharing and revocation semantics. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-002** [P2; local] Implement Google Drive adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-003** [P2; local] Qualify Google Drive locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-004** [P2; live-provider] Validate approved Google Drive resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-005** [P2; local] Specify OneDrive workflows.
  Acceptance: Select the supported personal/business resource types and link files without treating all SharePoint resources as automatically supported. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-006** [P2; local] Implement OneDrive adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-007** [P2; local] Qualify OneDrive locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-008** [P2; live-provider] Validate approved OneDrive resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-009** [P2; local] Specify Dropbox workflows.
  Acceptance: Resolve personal/shared namespaces and link or copy files only under explicit access and retention policy. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-010** [P2; local] Implement Dropbox adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-011** [P2; local] Qualify Dropbox locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-012** [P2; live-provider] Validate approved Dropbox resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-013** [P2; local] Specify GitHub workflows.
  Acceptance: Link customer requests to authorized repositories/issues and synchronize selected status changes without leaking private issue metadata. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-014** [P2; local] Implement GitHub adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-015** [P2; local] Qualify GitHub locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-016** [P2; live-provider] Validate approved GitHub resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-017** [P2; local] Specify Linear workflows.
  Acceptance: Select allowed teams/projects and link issues to visible CRM records with explicit update direction and loop prevention. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-018** [P2; local] Implement Linear adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-019** [P2; local] Qualify Linear locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-020** [P2; live-provider] Validate approved Linear resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-021** [P2; local] Specify Jira workflows.
  Acceptance: Select permitted sites/projects and map issue states, users and fields through the supported provider API. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-022** [P2; local] Implement Jira adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-023** [P2; local] Qualify Jira locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-024** [P2; live-provider] Validate approved Jira resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-025** [P2; local] Specify Calendly workflows.
  Acceptance: Map booking, reschedule and cancellation events to the correct CRM contact/activity with time-zone and identity checks. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-026** [P2; local] Implement Calendly adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-027** [P2; local] Qualify Calendly locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-028** [P2; live-provider] Validate approved Calendly resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-029** [P2; local] Specify Cal.com workflows.
  Acceptance: Map booking lifecycle and selected calendars to CRM activities, including self-hosted endpoint policy. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-030** [P2; local] Implement Cal.com adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-031** [P2; local] Qualify Cal.com locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-032** [P2; live-provider] Validate approved Cal.com resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-033** [P3; local] Specify WhatsApp Business workflows.
  Acceptance: Define authorized messaging and consent policy, verified sender ownership, signed inbound events and conversation visibility. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-034** [P3; local] Implement WhatsApp Business adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-035** [P3; local] Qualify WhatsApp Business locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-036** [P3; live-provider] Validate approved WhatsApp Business resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-037** [P3; local] Specify Stripe workflows.
  Acceptance: Start with authorized customer/payment-status synchronization and read-only CRM context; exclude money-moving actions from this initial connector. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-038** [P3; local] Implement Stripe adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-039** [P3; local] Qualify Stripe locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-040** [P3; live-provider] Validate approved Stripe resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-041** [P1; decision] Specify Telephony provider workflows.
  Acceptance: Select a provider and initial call/logging workflow based on target users, supported regions, licensing and current API capabilities. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-042** [P1; local] Implement Telephony provider adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-043** [P1; local] Qualify Telephony provider locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-044** [P1; live-provider] Validate approved Telephony provider resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-045** [P1; decision] Specify Accounting provider workflows.
  Acceptance: Select a provider and initial customer/invoice-status workflow with explicit source authority and no unsupported financial operations. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-046** [P1; local] Implement Accounting provider adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-047** [P1; local] Qualify Accounting provider locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-048** [P1; live-provider] Validate approved Accounting provider resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.
- [ ] **EXP-049** [P3; decision] Specify E-signature provider workflows.
  Acceptance: Select a provider and proposal/signature-status workflow with explicit document access and signer/event verification. Produce a provider capability and ownership contract before implementation. Verification: provider/design review.
- [ ] **EXP-050** [P3; local] Implement E-signature provider adapter and configuration.
  Acceptance: Use CONN, EVT and API contracts for account/resource selection, refresh, health, reconnect and removal. Verification: adapter and PostgreSQL tests.
- [ ] **EXP-051** [P3; local] Qualify E-signature provider locally.
  Acceptance: Exercise the stated workflow, permissions, duplicates, provider outages and FA/DE/EN screens using synthetic fixtures. Verification: provider contract and browser.
- [ ] **EXP-052** [P3; live-provider] Validate approved E-signature provider resources live.
  Acceptance: Record the selected vendor/account, finite actions, cleanup, verified limitations and release evidence before listing the connector as supported. Verification: live provider.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="sms"></a>
## SMS: Verified Iranian SMS provider coverage

User-requested expansion: deliver as many independently verifiable Iranian SMS providers as practical. Initial qualified SMS follows independent email; broad candidate delivery runs at the end of the approved P1 tranche.

Milestone: **IR2 / IR3**. Default priority: **P0** for shared foundations and the initial provider; **P1** for expansion. Responsibility: **SMS domain + provider owners**.
Package dependencies: CONN, EVT, UX (reviewed local foundations only).

**Exit criterion:** Each selected provider closes its own specification, implementation, local and authorized live qualification before supported claims. Discovery leads can be excluded with evidence; one provider's unavailable API/account does not block others. Existing UI, Better Auth and FA/DE/EN requirements apply throughout.

The 30-provider inventory is a dated discovery set, not an exhaustive national register, 30 independent backends or a guarantee that 30 connectors ship. Shared API-family reuse requires compatibility evidence. Full details and stage IDs are in [the provider inventory](integration-sms-providers.md).

- [ ] **SMS-001** [P0; local] Record SMS ownership and handoff boundaries.
  Acceptance: Map SMS-domain files and migration responsibility to actual current writers under BASE-001/002. CONN owns the shared lifecycle and EVT owns delivery/rule infrastructure; preserve ongoing email, calendar, auth and platform work. Verification: ownership review.
- [ ] **SMS-002** [P0; local] Define the SMS domain capability contract.
  Acceptance: Extend the common provider contract with explicit send, template, receipt, inbound, sender and balance capabilities. Avoid another provider SDK, registry or permission evaluator; declarations are limited to verified API/version/account support. Verification: domain and capability design review.
- [ ] **SMS-003** [P0; local] Connect SMS intent to shared delivery infrastructure.
  Acceptance: Use existing pg-boss/outbox and EVT intent, correlation, retries, deduplication and cancellation contracts. Do not create another queue or workflow engine; uncertain upstream effects remain distinguishable from safe retry. Verification: transaction and delivery fault tests.
- [ ] **SMS-004** [P0; local] Reuse regional recipient and text handling.
  Acceptance: Reuse the approved Iranian/German phone, original-input and locale helpers. Preserve recipient country, message bytes, Persian/German text and template parameters; expose provider-based segment/cost estimates without inventing billing guarantees. Verification: FA/DE domain and encoding tests.
- [ ] **SMS-005** [P0; local] Enforce sender, recipient and spending policy.
  Acceptance: Apply current actor/record visibility, sender-line entitlement, suppression, explicit send confirmation and account budgets before dispatch. Preview and dry-run do not send messages or incur provider charges. Verification: authorization, budget and preview tests.
- [ ] **SMS-006** [P0; local] Define receipt and inbound reconciliation.
  Acceptance: Validate provider payloads and replay/ordering behavior. Use verified signatures where supported; otherwise treat callbacks as untrusted hints and reconcile authoritative provider state before applying changes. Account for lookup retention and inbound read-state effects. Verification: callback, replay and reconciliation tests.
- [ ] **SMS-007** [P0; local] Compose SMS management into the common UI.
  Acceptance: Reuse CONN-022 setup, ownership, status, credential rotation and removal. Add SMS-specific compose/review/history controls without replacing the current shell or creating another Connections page. Verification: FA/DE/EN browser and permission tests.
- [ ] **SMS-008** [P0; local] Build shared SMS fault and restart fixtures.
  Acceptance: Exercise actual adapter boundaries with explicit contract fixtures: partial failures, throttling, ambiguous sends, duplicate jobs/receipts, offline recovery and suspension. Local contract tests do not establish live provider compatibility. Verification: provider contracts and PostgreSQL faults.
- [ ] **SMS-009** [P0; local] Review SMS copy, accessibility and operations.
  Acceptance: Cover all SMS setup/send/receipt/inbound/error/recovery states and operator instructions in natural FA/DE/EN, using the shared UX glossary and QA evidence. Preserve current RTL/LTR, mobile, themes and focus behavior. Verification: localized UI, keyboard and operator review.
- [ ] **SMS-010** [P0; local] Maintain the broad provider qualification inventory.
  Acceptance: Record the 30 discovery candidates with source, API version, account requirements, API-family reuse and selected/excluded reasons. Qualify as many providers as verifiable, add future candidates without renumbering IDs, and never equate a catalog entry with support. Verification: provider inventory review.
- [ ] **SMS-011** [P0; local] Maintain per-provider capability and evidence records.
  Acceptance: Track specification, implementation, local and live evidence independently for every selected provider. Unverifiable candidates remain excluded or pending with reasons and do not block others; shared backends require demonstrated compatibility. Verification: capability and evidence audit.
- [ ] **SMS-012** [P0; local] Reconcile SMS progress with the master goal and register.
  Acceptance: Keep one execution record and ownership map; link original IG-07/15 to SMS work instead of duplicate tasks. Deliver initial qualified SMS after independent email; expand remaining verified providers at the end of the approved P1 tranche. This file does not activate a persistent goal. Verification: planning and handoff review.
- [ ] **SMS-013** [P0; local] Qualify Kavenegar / کاوه نگار API and scope.
  Acceptance: Provider ID kavenegar: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://kavenegar.com/rest.html. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-014** [P0; local] Implement qualified Kavenegar / کاوه نگار adapter.
  Acceptance: For kavenegar only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-015** [P0; local] Qualify Kavenegar / کاوه نگار locally.
  Acceptance: For kavenegar, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-016** [P0; live-provider] Validate authorized Kavenegar / کاوه نگار profile live.
  Acceptance: For kavenegar, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-017** [P1; local] Qualify Melipayamak / ملی پیامک API and scope.
  Acceptance: Provider ID melipayamak: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://www.melipayamak.com/api/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-018** [P1; local] Implement qualified Melipayamak / ملی پیامک adapter.
  Acceptance: For melipayamak only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-019** [P1; local] Qualify Melipayamak / ملی پیامک locally.
  Acceptance: For melipayamak, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-020** [P1; live-provider] Validate authorized Melipayamak / ملی پیامک profile live.
  Acceptance: For melipayamak, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-021** [P1; local] Qualify SMS.ir API and scope.
  Acceptance: Provider ID sms_ir: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://github.com/ipecompany/SmsPanelV2.nodejs. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-022** [P1; local] Implement qualified SMS.ir adapter.
  Acceptance: For sms_ir only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-023** [P1; local] Qualify SMS.ir locally.
  Acceptance: For sms_ir, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-024** [P1; live-provider] Validate authorized SMS.ir profile live.
  Acceptance: For sms_ir, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-025** [P1; local] Qualify IPPanel API and scope.
  Acceptance: Provider ID ippanel: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://ippanelcom.github.io/Edge-Document/docs/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-026** [P1; local] Implement qualified IPPanel adapter.
  Acceptance: For ippanel only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-027** [P1; local] Qualify IPPanel locally.
  Acceptance: For ippanel, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-028** [P1; live-provider] Validate authorized IPPanel profile live.
  Acceptance: For ippanel, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-029** [P1; local] Qualify Faraz SMS / فراز اس ام اس API and scope.
  Acceptance: Provider ID farazsms: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://farazsms.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-030** [P1; local] Implement qualified Faraz SMS / فراز اس ام اس adapter.
  Acceptance: For farazsms only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-031** [P1; local] Qualify Faraz SMS / فراز اس ام اس locally.
  Acceptance: For farazsms, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-032** [P1; live-provider] Validate authorized Faraz SMS / فراز اس ام اس profile live.
  Acceptance: For farazsms, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-033** [P1; local] Qualify Mediana / مدیانا API and scope.
  Acceptance: Provider ID mediana: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://apidoc.mediana.ir/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-034** [P1; local] Implement qualified Mediana / مدیانا adapter.
  Acceptance: For mediana only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-035** [P1; local] Qualify Mediana / مدیانا locally.
  Acceptance: For mediana, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-036** [P1; live-provider] Validate authorized Mediana / مدیانا profile live.
  Acceptance: For mediana, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-037** [P1; local] Qualify Ghasedak / قاصدک API and scope.
  Acceptance: Provider ID ghasedak: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://ghasedak.me/docs. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-038** [P1; local] Implement qualified Ghasedak / قاصدک adapter.
  Acceptance: For ghasedak only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-039** [P1; local] Qualify Ghasedak / قاصدک locally.
  Acceptance: For ghasedak, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-040** [P1; live-provider] Validate authorized Ghasedak / قاصدک profile live.
  Acceptance: For ghasedak, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-041** [P1; local] Qualify NikSMS / نیک اس ام اس API and scope.
  Acceptance: Provider ID niksms: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://niksms.com/fa/api-sms. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-042** [P1; local] Implement qualified NikSMS / نیک اس ام اس adapter.
  Acceptance: For niksms only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-043** [P1; local] Qualify NikSMS / نیک اس ام اس locally.
  Acceptance: For niksms, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-044** [P1; live-provider] Validate authorized NikSMS / نیک اس ام اس profile live.
  Acceptance: For niksms, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-045** [P1; local] Qualify ParsGreen / پارس گرین API and scope.
  Acceptance: Provider ID parsgreen: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://www.parsgreen.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-046** [P1; local] Implement qualified ParsGreen / پارس گرین adapter.
  Acceptance: For parsgreen only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-047** [P1; local] Qualify ParsGreen / پارس گرین locally.
  Acceptance: For parsgreen, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-048** [P1; live-provider] Validate authorized ParsGreen / پارس گرین profile live.
  Acceptance: For parsgreen, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-049** [P1; local] Qualify Payam Resan / پیام رسان API and scope.
  Acceptance: Provider ID payam_resan: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://payam-resan.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-050** [P1; local] Implement qualified Payam Resan / پیام رسان adapter.
  Acceptance: For payam_resan only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-051** [P1; local] Qualify Payam Resan / پیام رسان locally.
  Acceptance: For payam_resan, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-052** [P1; live-provider] Validate authorized Payam Resan / پیام رسان profile live.
  Acceptance: For payam_resan, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-053** [P1; local] Qualify Farapayamak / فراپیامک API and scope.
  Acceptance: Provider ID farapayamak: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://farapayamak.ir/content/webservice/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-054** [P1; local] Implement qualified Farapayamak / فراپیامک adapter.
  Acceptance: For farapayamak only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-055** [P1; local] Qualify Farapayamak / فراپیامک locally.
  Acceptance: For farapayamak, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-056** [P1; live-provider] Validate authorized Farapayamak / فراپیامک profile live.
  Acceptance: For farapayamak, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-057** [P1; local] Qualify RayganSMS / رایگان اس ام اس API and scope.
  Acceptance: Provider ID raygansms: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://raygansms.com/webservice/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-058** [P1; local] Implement qualified RayganSMS / رایگان اس ام اس adapter.
  Acceptance: For raygansms only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-059** [P1; local] Qualify RayganSMS / رایگان اس ام اس locally.
  Acceptance: For raygansms, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-060** [P1; live-provider] Validate authorized RayganSMS / رایگان اس ام اس profile live.
  Acceptance: For raygansms, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-061** [P1; local] Qualify SunWay / سان وی API and scope.
  Acceptance: Provider ID sunway: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://sunwaysms.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-062** [P1; local] Implement qualified SunWay / سان وی adapter.
  Acceptance: For sunway only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-063** [P1; local] Qualify SunWay / سان وی locally.
  Acceptance: For sunway, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-064** [P1; live-provider] Validate authorized SunWay / سان وی profile live.
  Acceptance: For sunway, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-065** [P1; local] Qualify Behresaan / به رسان API and scope.
  Acceptance: Provider ID behresaan: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://www.behresaan.ir/مستند-وب-سرویس/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-066** [P1; local] Implement qualified Behresaan / به رسان adapter.
  Acceptance: For behresaan only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-067** [P1; local] Qualify Behresaan / به رسان locally.
  Acceptance: For behresaan, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-068** [P1; live-provider] Validate authorized Behresaan / به رسان profile live.
  Acceptance: For behresaan, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-069** [P1; local] Qualify Asanak / آسانک API and scope.
  Acceptance: Provider ID asanak: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://www.asanak.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-070** [P1; local] Implement qualified Asanak / آسانک adapter.
  Acceptance: For asanak only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-071** [P1; local] Qualify Asanak / آسانک locally.
  Acceptance: For asanak, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-072** [P1; live-provider] Validate authorized Asanak / آسانک profile live.
  Acceptance: For asanak, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-073** [P1; local] Qualify Modir Payamak / مدیر پیامک API and scope.
  Acceptance: Provider ID modirpayamak: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://modirpayamak.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-074** [P1; local] Implement qualified Modir Payamak / مدیر پیامک adapter.
  Acceptance: For modirpayamak only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-075** [P1; local] Qualify Modir Payamak / مدیر پیامک locally.
  Acceptance: For modirpayamak, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-076** [P1; live-provider] Validate authorized Modir Payamak / مدیر پیامک profile live.
  Acceptance: For modirpayamak, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-077** [P1; local] Qualify Taban SMS / تابان اس ام اس API and scope.
  Acceptance: Provider ID tabansms: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://tabansms.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-078** [P1; local] Implement qualified Taban SMS / تابان اس ام اس adapter.
  Acceptance: For tabansms only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-079** [P1; local] Qualify Taban SMS / تابان اس ام اس locally.
  Acceptance: For tabansms, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-080** [P1; live-provider] Validate authorized Taban SMS / تابان اس ام اس profile live.
  Acceptance: For tabansms, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-081** [P1; local] Qualify TSMS / طوبی API and scope.
  Acceptance: Provider ID tsms: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://tsms.ir/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-082** [P1; local] Implement qualified TSMS / طوبی adapter.
  Acceptance: For tsms only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-083** [P1; local] Qualify TSMS / طوبی locally.
  Acceptance: For tsms, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-084** [P1; live-provider] Validate authorized TSMS / طوبی profile live.
  Acceptance: For tsms, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-085** [P1; local] Qualify Iran Payamak / ایران پیامک API and scope.
  Acceptance: Provider ID iranpayamak: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://iranpayamak.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-086** [P1; local] Implement qualified Iran Payamak / ایران پیامک adapter.
  Acceptance: For iranpayamak only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-087** [P1; local] Qualify Iran Payamak / ایران پیامک locally.
  Acceptance: For iranpayamak, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-088** [P1; live-provider] Validate authorized Iran Payamak / ایران پیامک profile live.
  Acceptance: For iranpayamak, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-089** [P1; local] Qualify Samaneh Payamak Melli / سامانه پیامک ملی API and scope.
  Acceptance: Provider ID sms_meli: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://www.sms-meli.com/webservice/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-090** [P1; local] Implement qualified Samaneh Payamak Melli / سامانه پیامک ملی adapter.
  Acceptance: For sms_meli only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-091** [P1; local] Qualify Samaneh Payamak Melli / سامانه پیامک ملی locally.
  Acceptance: For sms_meli, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-092** [P1; live-provider] Validate authorized Samaneh Payamak Melli / سامانه پیامک ملی profile live.
  Acceptance: For sms_meli, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-093** [P1; local] Qualify KPanel / کاپنل API and scope.
  Acceptance: Provider ID kpanel: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://kpanel.ir/lab/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-094** [P1; local] Implement qualified KPanel / کاپنل adapter.
  Acceptance: For kpanel only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-095** [P1; local] Qualify KPanel / کاپنل locally.
  Acceptance: For kpanel, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-096** [P1; live-provider] Validate authorized KPanel / کاپنل profile live.
  Acceptance: For kpanel, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-097** [P1; local] Qualify Yekta Payamak / یکتا پیامک API and scope.
  Acceptance: Provider ID yektapayamak: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://yektapayamak.com/wp-content/uploads/2024/02/api_docs.pdf. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-098** [P1; local] Implement qualified Yekta Payamak / یکتا پیامک adapter.
  Acceptance: For yektapayamak only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-099** [P1; local] Qualify Yekta Payamak / یکتا پیامک locally.
  Acceptance: For yektapayamak, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-100** [P1; live-provider] Validate authorized Yekta Payamak / یکتا پیامک profile live.
  Acceptance: For yektapayamak, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-101** [P1; local] Qualify Arad ITC / آراد API and scope.
  Acceptance: Provider ID arad: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://github.com/araditc/arad.sms.core.api.document/wiki. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-102** [P1; local] Implement qualified Arad ITC / آراد adapter.
  Acceptance: For arad only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-103** [P1; local] Qualify Arad ITC / آراد locally.
  Acceptance: For arad, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-104** [P1; live-provider] Validate authorized Arad ITC / آراد profile live.
  Acceptance: For arad, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-105** [P1; local] Qualify Najva / نجوا API and scope.
  Acceptance: Provider ID najva: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://www.najva.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-106** [P1; local] Implement qualified Najva / نجوا adapter.
  Acceptance: For najva only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-107** [P1; local] Qualify Najva / نجوا locally.
  Acceptance: For najva, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-108** [P1; live-provider] Validate authorized Najva / نجوا profile live.
  Acceptance: For najva, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-109** [P1; local] Qualify WebOne SMS / وب وان API and scope.
  Acceptance: Provider ID webone: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://webone-sms.ir/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-110** [P1; local] Implement qualified WebOne SMS / وب وان adapter.
  Acceptance: For webone only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-111** [P1; local] Qualify WebOne SMS / وب وان locally.
  Acceptance: For webone, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-112** [P1; live-provider] Validate authorized WebOne SMS / وب وان profile live.
  Acceptance: For webone, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-113** [P1; local] Qualify Novin Pardaz / نوین پرداز API and scope.
  Acceptance: Provider ID npsms: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://npsms.ir/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-114** [P1; local] Implement qualified Novin Pardaz / نوین پرداز adapter.
  Acceptance: For npsms only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-115** [P1; local] Qualify Novin Pardaz / نوین پرداز locally.
  Acceptance: For npsms, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-116** [P1; live-provider] Validate authorized Novin Pardaz / نوین پرداز profile live.
  Acceptance: For npsms, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-117** [P1; local] Qualify Magfa / مگفا API and scope.
  Acceptance: Provider ID magfa: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://messaging.magfa.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-118** [P1; local] Implement qualified Magfa / مگفا adapter.
  Acceptance: For magfa only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-119** [P1; local] Qualify Magfa / مگفا locally.
  Acceptance: For magfa, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-120** [P1; live-provider] Validate authorized Magfa / مگفا profile live.
  Acceptance: For magfa, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-121** [P1; local] Qualify Amoot SMS / آموت API and scope.
  Acceptance: Provider ID amoot: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://portal.amootsms.com/. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-122** [P1; local] Implement qualified Amoot SMS / آموت adapter.
  Acceptance: For amoot only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-123** [P1; local] Qualify Amoot SMS / آموت locally.
  Acceptance: For amoot, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-124** [P1; live-provider] Validate authorized Amoot SMS / آموت profile live.
  Acceptance: For amoot, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-125** [P1; local] Qualify Kandoo / کندو API and scope.
  Acceptance: Provider ID kandoo: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://techrasa.com/fa/wp-content/uploads/2024/11/TechRasa-Insight-Iran-MarTech-2024-Report.pdf. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-126** [P1; local] Implement qualified Kandoo / کندو adapter.
  Acceptance: For kandoo only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-127** [P1; local] Qualify Kandoo / کندو locally.
  Acceptance: For kandoo, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-128** [P1; live-provider] Validate authorized Kandoo / کندو profile live.
  Acceptance: For kandoo, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.
- [ ] **SMS-129** [P1; local] Qualify SMSFA / اس ام اس فا API and scope.
  Acceptance: Provider ID smsfa: verify current official API/version, supplier/account identity, sender and inbound/receipt entitlements, pricing units, callback authenticity and licensing. Source lead: https://dev.to/smsfa/sms-2j2i. Record selected, pending or excluded with reasons. A failed specification does not authorize implementation or a supported listing. Verification: official contract and scope review.
- [ ] **SMS-130** [P1; local] Implement qualified SMSFA / اس ام اس فا adapter.
  Acceptance: For smsfa only after successful specification, implement the verified capability subset through CONN, EVT and the SMS domain. Reuse an API-family adapter only after contract compatibility is demonstrated. Preserve security, uncertainty and FA/DE/EN management semantics. Verification: adapter and PostgreSQL integration.
- [ ] **SMS-131** [P1; local] Qualify SMSFA / اس ام اس فا locally.
  Acceptance: For smsfa, exercise its actual adapter contract, credentials and error mapping with synthetic fixtures; cover duplicates, quotas, receipts/inbound where supported, unknown outcomes, offboarding and FA/DE/EN workflows. Local success is not live compatibility. Verification: contract, fault and localized workflow suite.
- [ ] **SMS-132** [P1; live-provider] Validate authorized SMSFA / اس ام اس فا profile live.
  Acceptance: For smsfa, require separately authorized account, sender/test numbers and finite actions. Record API/account profile, observed send and supported receipt/inbound behavior, cleanup, costs and limitations before advertising that profile as supported. Unavailable authorization leaves this gate open. Verification: finite authorized live-provider matrix.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="sdk"></a>
## SDK: Application SDK and isolated extension runtime

Build the reusable extension platform needed for privately installed apps and a later public marketplace.

Milestone: **R6**. Default priority: **P1**. Responsibility: **Platform + security + developer experience**.
Package dependencies: ARCH, CONN, EVT, API, AISEC.

**Exit criterion:** A private example app can add authorized data/UI/workflow capabilities, run in real isolation, update and uninstall without bypassing core policy.

- [ ] **SDK-001** [P1; local] Define a versioned application manifest.
  Acceptance: Declare stable IDs, publisher identity, compatibility, capabilities, providers, routes, jobs, UI points and translations. Verification: schema conformance.
- [ ] **SDK-002** [P1; local] Define app registration and ownership.
  Acceptance: Distinguish package identity, publisher, server registration and installed instance; prevent identifier squatting and unauthorized takeover. Verification: ownership scenarios.
- [ ] **SDK-003** [P1; local] Implement app-role capability evaluation.
  Acceptance: Scope all app API calls to the intersection of app permissions, installation policy and acting-user authority. Verification: negative authorization.
- [ ] **SDK-004** [P1; local] Define the data-extension model.
  Acceptance: Specify application-owned objects, namespaced fields and references while preserving existing custom-field and database conventions. Verification: schema design.
- [ ] **SDK-005** [P1; local] Implement extension metadata validation.
  Acceptance: Reject conflicting identifiers, invalid field definitions, incompatible schema versions and unsupported capabilities. Verification: validation tests.
- [ ] **SDK-006** [P1; local] Implement safe schema migrations.
  Acceptance: Apply app metadata/data migrations transactionally where possible with backups, progress and documented rollback limits. Verification: PostgreSQL migration.
- [ ] **SDK-007** [P1; local] Generate a typed developer client.
  Acceptance: Keep record schemas, capability types and error contracts aligned with the public API and installed metadata. Verification: SDK contract.
- [ ] **SDK-008** [P1; local] Spike Bun-compatible isolation backends.
  Acceptance: Compare real OS/container boundaries, resource controls and supported self-hosting environments; a worker or VM alone is not sufficient. Verification: adversarial spike.
- [ ] **SDK-009** [P1; local] Implement isolated function execution.
  Acceptance: Run untrusted code outside the web process with bounded CPU, memory, wall time, filesystem and process permissions. Verification: isolation tests.
- [ ] **SDK-010** [P1; local] Implement secret and credential brokering.
  Acceptance: Expose only declared secret capabilities or brokered provider operations, never a shared host environment or unrestricted token access. Verification: leakage tests.
- [ ] **SDK-011** [P1; local] Implement egress and network policy.
  Acceptance: Deny undeclared destinations and internal control-plane access, including redirect/DNS-rebinding cases. Verification: network isolation tests.
- [ ] **SDK-012** [P1; local] Implement jobs, events and HTTP hooks.
  Acceptance: Register versioned extension handlers through EVT with cancellation, retry and attribution under the installation's role. Verification: runtime integration.
- [ ] **SDK-013** [P1; local] Choose the UI isolation contract.
  Acceptance: Evaluate sandboxed iframe versus worker/remote-rendering approaches against accessibility, CSP and host compatibility. Verification: design and threat review.
- [ ] **SDK-014** [P1; local] Implement safe UI extension points.
  Acceptance: Support declared record panels, widgets, navigation and command actions through typed host messages. Verification: UI contract.
- [ ] **SDK-015** [P1; local] Implement host bridge authorization.
  Acceptance: Validate origins, schemas, action capabilities, resource references and response data at both sides of the bridge. Verification: adversarial bridge tests.
- [ ] **SDK-016** [P1; local] Implement theme and locale context.
  Acceptance: Supply FA/DE/EN, direction, numbering, selected calendar and time zone without exposing account secrets. Verification: extension visual matrix.
- [ ] **SDK-017** [P1; local] Implement scoped MCP extension tools.
  Acceptance: Register app tools with stable namespaces, schemas and installation permissions; disabling the app removes execution access. Verification: MCP authorization.
- [ ] **SDK-018** [P1; local] Implement install/configure/enable lifecycle.
  Acceptance: Validate compatibility, configuration and granted capabilities before starting any app code or jobs. Verification: lifecycle integration.
- [ ] **SDK-019** [P1; local] Implement update and permission diffs.
  Acceptance: Review changed capabilities and migrations, keeping an installed version active or safely paused during failure. Verification: upgrade fault injection.
- [ ] **SDK-020** [P1; local] Implement disable/uninstall semantics.
  Acceptance: Stop code/jobs, revoke or retain provider grants under explicit ownership policy and offer reviewable data-retention choices. Verification: removal and rollback tests.
- [ ] **SDK-021** [P1; local] Implement quotas, audit and diagnostics.
  Acceptance: Attribute execution and resource usage per app with bounded logs, redaction, failure history and emergency suspension. Verification: operational tests.
- [ ] **SDK-022** [P1; local] Build SDK scaffolding and local development commands.
  Acceptance: Generate a minimal Bun/TypeScript app, test fixtures and a reproducible package without running untrusted install scripts on the host. Verification: developer walkthrough.
- [ ] **SDK-023** [P1; local] Ship reference private apps.
  Acceptance: Demonstrate a record panel, a workflow action and a scoped MCP tool that all use the same permissions and locale context. Verification: example conformance.
- [ ] **SDK-024** [P1; local] Qualify the app isolation and lifecycle suite.
  Acceptance: Test hostile code, forged bridge messages, unauthorized data, runaway jobs, upgrade failure and uninstall cleanup. Verification: adversarial end-to-end.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="store"></a>
## STORE: Marketplace and app management

Distribute compatible, permission-reviewed extensions with a reliable private and public installation lifecycle.

Milestone: **R7**. Default priority: **P2**. Responsibility: **App platform + product**.
Package dependencies: SDK, UX.

**Exit criterion:** A private app can be discovered, reviewed, installed, configured, updated and removed; public listing adds verified ownership and publication operations.

- [ ] **STORE-001** [P2; local] Define marketplace taxonomy and metadata.
  Acceptance: Separate provider connections, workflow packages, AI clients and full CRM apps while keeping one coherent discovery model. Verification: catalog design.
- [ ] **STORE-002** [P2; local] Define publisher identity and trust labels.
  Acceptance: Specify what ownership, provenance, review and support labels actually mean; never infer approval from a logo or package name. Verification: trust review.
- [ ] **STORE-003** [P2; local] Implement app catalog indexing.
  Acceptance: Index versioned metadata, compatibility, locales, capabilities and distribution scope with bounded refresh and failure handling. Verification: catalog integration.
- [ ] **STORE-004** [P2; local] Implement search and category discovery.
  Acceptance: Support provider/workflow/business categories, localized names, Persian search normalization and truthful availability. Verification: search and browser.
- [ ] **STORE-005** [P2; local] Implement app detail pages.
  Acceptance: Show publisher, supported versions, capabilities, screenshots, documentation, changelog and known limits with local assets. Verification: FA/DE/EN browser.
- [ ] **STORE-006** [P2; local] Implement permission and data-access review.
  Acceptance: Explain requested capabilities, destinations, retained data and changes from an installed version before activation. Verification: consent and authorization.
- [ ] **STORE-007** [P2; local] Implement installation orchestration.
  Acceptance: Validate identity, artifact integrity, compatibility, configuration and permissions before migrations or code execution. Verification: lifecycle fault injection.
- [ ] **STORE-008** [P2; local] Implement provider prerequisite setup.
  Acceptance: Explain missing server credentials and account grants separately from whether the app itself is installed. Verification: admin/member UI.
- [ ] **STORE-009** [P2; local] Implement app configuration and resource selection.
  Acceptance: Use typed secret/public settings and accessible controls; never send stored secret values back to browsers. Verification: config and leakage tests.
- [ ] **STORE-010** [P2; local] Implement enable/disable management.
  Acceptance: Stop execution and pending jobs consistently while preserving reviewable app state and diagnostics. Verification: runtime integration.
- [ ] **STORE-011** [P2; local] Implement version and update management.
  Acceptance: Show compatibility, permission diffs and migration requirements; stage updates and recover failures without hidden scope expansion. Verification: upgrade scenarios.
- [ ] **STORE-012** [P2; local] Implement safe removal and retention.
  Acceptance: Preview app-owned data, credential ownership and pending work, with explicit retention/removal choices and documented recovery limits. Verification: uninstall scenarios.
- [ ] **STORE-013** [P2; local] Implement private distribution.
  Acceptance: Support administrator-managed private artifacts and controlled sharing within the intended instance scope. Verification: private install tests.
- [ ] **STORE-014** [P2; local] Implement public artifact intake.
  Acceptance: Validate immutable versions, ownership, checksums, supported package format and archive limits without executing host-side install hooks. Verification: supply-chain tests.
- [ ] **STORE-015** [P2; local] Implement publisher submission workflow.
  Acceptance: Collect identity, source, documentation, permissions, support and required evidence with review states and appeals. Verification: workflow tests.
- [ ] **STORE-016** [P2; local] Implement review and quarantine tooling.
  Acceptance: Flag policy or integrity failures, suspend affected versions and preserve an auditable review history. Verification: abuse and operator tests.
- [ ] **STORE-017** [P2; local] Implement deprecation and emergency disabling.
  Acceptance: Notify affected installations, stop risky execution and offer reviewed update/removal paths without deleting user data silently. Verification: incident drill.
- [ ] **STORE-018** [P2; local] Implement community feedback and reporting.
  Acceptance: Add bounded reviews/reporting with anti-abuse controls and publisher response policy when community operation is staffed. Verification: moderation scenarios.
- [ ] **STORE-019** [P2; local] Build publisher/developer tooling.
  Acceptance: Provide package validation, compatibility checks, local submission simulation and update guidance using the SDK. Verification: developer walkthrough.
- [ ] **STORE-020** [P2; local] Qualify the local marketplace lifecycle.
  Acceptance: Run private example apps through discovery, consent, install, configure, update, disable and uninstall with failure injection. Verification: end-to-end lifecycle.
- [ ] **STORE-021** [P2; public-hosting] Qualify the selected public registry path.
  Acceptance: Verify hosting, publisher identity, operational support and finite external install/update behavior after deployment is authorized. Verification: live registry test.
- [ ] **STORE-022** [P2; publication] Publish the first reviewed app set.
  Acceptance: Release only versions with ownership, compatibility, permission, localization and operational evidence attached. Verification: publication checklist.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="ops"></a>
## OPS: Self-hosting, observability and operations

Make the integration system operable locally and in a later authorized deployment, including failure and recovery.

Milestone: **CROSS**. Default priority: **P0**. Responsibility: **Operations + platform**.
Package dependencies: BASE.

**Exit criterion:** Operators can start required services, diagnose failures, rotate secrets, restore data and suspend delivery with documented evidence.

- [ ] **OPS-001** [P0; local] Define supported deployment profiles.
  Acceptance: Specify local developer and self-hosted server profiles, required services and explicitly unqualified environments. Verification: operator review.
- [ ] **OPS-002** [P0; local] Package isolated local service startup.
  Acceptance: Start app, PostgreSQL, worker, realtime and storage under a reproducible Bun-based profile without sharing private state. Verification: local service smoke.
- [ ] **OPS-003** [P0; local] Implement readiness and health reporting.
  Acceptance: Distinguish app readiness, worker liveness, queue delay, provider health and credential failures. Verification: health integration.
- [ ] **OPS-004** [P0; local] Implement structured operational logs.
  Acceptance: Use stable errors and correlation IDs while excluding tokens, client secrets, message bodies and unnecessary personal data. Verification: redaction tests.
- [ ] **OPS-005** [P0; local] Implement operational metrics.
  Acceptance: Measure queue age, delivery outcomes, refresh failures, subscription renewal and sandbox resource use with bounded dimensions. Verification: metric assertions.
- [ ] **OPS-006** [P0; local] Define alert routing and quiet behavior.
  Acceptance: Alert on actionable failures or recovery thresholds, with explicit recipients and no background messaging enabled by default. Verification: alert contract.
- [ ] **OPS-007** [P0; local] Define retention and deletion jobs.
  Acceptance: Set reviewable policies for audit logs, delivery payloads, OAuth attempts, tombstones and removed app data. Verification: retention tests.
- [ ] **OPS-008** [P0; local] Implement secret provisioning guidance.
  Acceptance: Document environment/file secrets, key identifiers, provider setup and recovery without committing private values. Verification: operator walkthrough.
- [ ] **OPS-009** [P0; local] Qualify encryption and signing-key rotation.
  Acceptance: Demonstrate credential re-encryption, OAuth signing changes and webhook secret overlap without unintended access widening. Verification: rotation drill.
- [ ] **OPS-010** [P0; local] Qualify backup and restore.
  Acceptance: Restore schema, installation state, encrypted credentials and queue recovery into an isolated environment using the correct keys. Verification: restore drill.
- [ ] **OPS-011** [P0; local] Qualify deploy and migration recovery.
  Acceptance: Test upgrade interruption, incompatible app versions, migration failure and documented rollback boundaries. Verification: migration drill.
- [ ] **OPS-012** [P0; local] Implement bounded repair commands.
  Acceptance: Provide previewable retry, resync, subscription renewal and revocation repair with scopes and limits. Verification: operator CLI tests.
- [ ] **OPS-013** [P0; local] Prepare incident runbooks.
  Acceptance: Cover leaked credentials, malicious apps, provider outage, stuck revocation and duplicate/unknown delivery outcomes. Verification: incident exercise.
- [ ] **OPS-014** [P0; public-hosting] Prepare the public-hosting configuration.
  Acceptance: Record the chosen domain, TLS, trusted origins, callback URLs and reverse-proxy settings when a deployment target is supplied. Verification: deployment review.
- [ ] **OPS-015** [P0; public-hosting] Validate an authorized deployment profile.
  Acceptance: Verify health, worker, realtime, egress, OAuth discovery and rate limits on the selected non-local environment. Verification: deployed smoke.
- [ ] **OPS-016** [P0; live-provider] Qualify provider and client live gates.
  Acceptance: Coordinate finite sandbox tests with recorded scopes, synthetic data, actions, cleanup and attributable evidence. Verification: provider qualification.
- [ ] **OPS-017** [P0; local] Maintain operator docs in FA/DE/EN.
  Acceptance: Keep service startup, configuration, failures, rotation and recovery instructions usable in supported languages. Verification: documentation walkthrough.
- [ ] **OPS-018** [P0; local] Define release support and incident ownership.
  Acceptance: Assign maintainers, response expectations, escalation channels and unsupported-environment behavior before public support claims. Verification: operational review.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="qa"></a>
## QA: Shared verification and release acceptance

Create a repeatable quality gate applied to every vertical slice rather than postponing localization and security testing until the end.

Milestone: **CROSS**. Default priority: **P0**. Responsibility: **QA + security + domain owners**.
Package dependencies: BASE.

**Exit criterion:** Every released capability has reproducible source, runtime, authorization, localization and provider evidence appropriate to its claimed support level.

- [ ] **QA-001** [P0; local] Define the test and evidence taxonomy.
  Acceptance: Separate source review, unit, real-PostgreSQL, local provider simulation, browser review, live provider and deployed qualification. Verification: quality review.
- [ ] **QA-002** [P0; local] Build reusable synthetic CRM fixtures.
  Acceptance: Include visible/hidden records, admin/member roles, stale grants, multiple accounts and known calendar boundaries without real customer data. Verification: fixture validation.
- [ ] **QA-003** [P0; local] Build provider contract simulators.
  Acceptance: Cover OAuth, refresh, cursors, webhooks, rate limits, outages and revocation for each adapter using deterministic fixtures. Verification: contract harness.
- [ ] **QA-004** [P0; local] Maintain real PostgreSQL migration tests.
  Acceptance: Exercise clean install, upgrade, concurrent ownership/grant updates and failed transactions without database mocks. Verification: PostgreSQL suite.
- [ ] **QA-005** [P0; local] Maintain authorization negative matrices.
  Acceptance: Test current role, record visibility, grant scope, app role, offboarding and direct endpoint/tool access. Verification: security regression.
- [ ] **QA-006** [P0; local] Maintain concurrency and idempotency tests.
  Acceptance: Exercise simultaneous refresh, callback replay, duplicate events, repeated actions and stale record versions. Verification: concurrency suite.
- [ ] **QA-007** [P0; local] Maintain temporal regression fixtures.
  Acceptance: Test all-day dates, Tehran/Berlin zones, historical transitions, Iranian/Gregorian display and recurring edits. Verification: temporal suite.
- [ ] **QA-008** [P0; local] Maintain FA/DE/EN workflow checks.
  Acceptance: Cover natural copy, validation, backend errors, counters, mixed-direction values and provider setup in each release. Verification: locale audit and browser.
- [ ] **QA-009** [P0; local] Maintain responsive and theme checks.
  Acceptance: Verify meaningful layouts at 320/390/768/1440 pixels with light/dark and reduced motion. Verification: browser geometry.
- [ ] **QA-010** [P0; local] Run keyboard and screen-reader checks.
  Acceptance: Verify labels, reading order, status announcements, dialogs, selectors, focus return and every primary action. Verification: accessibility session.
- [ ] **QA-011** [P0; local] Run app and UI-bridge adversarial tests.
  Acceptance: Attempt capability bypass, secret exfiltration, forged messages, prohibited network access and runaway code. Verification: isolation suite.
- [ ] **QA-012** [P0; local] Run provider failure and restart drills.
  Acceptance: Exercise suspended apps, lost workers, database interruption, expired subscriptions and remote revocation failure. Verification: fault injection.
- [ ] **QA-013** [P0; local] Evaluate AI workflows for accuracy and safety.
  Acceptance: Check record disambiguation, grounded summaries, hidden records, untrusted text and draft-versus-send behavior. Verification: workflow evaluations.
- [ ] **QA-014** [P0; local] Maintain a cross-client compatibility suite.
  Acceptance: Record supported protocol/host versions and test text fallback, consent, refresh and revoke for each claimed client profile. Verification: client conformance.
- [ ] **QA-015** [P0; local] Require full relevant build and code checks.
  Acceptance: Run declared Bun builds, type checks, lint, i18n and UI registry checks on the exact release head. Verification: CI/local gate.
- [ ] **QA-016** [P0; local] Attach evidence to feature completion.
  Acceptance: Record head, commands, results, provider/account profile and known limits; a checkbox requires evidence, not just a commit. Verification: release review.
- [ ] **QA-017** [P0; live-provider] Qualify approved provider workflows live.
  Acceptance: Validate only the selected finite sandbox scenarios after local gates pass, keeping credentials and private data out of artifacts. Verification: live acceptance.
- [ ] **QA-018** [P0; public-hosting] Run release-candidate restoration and acceptance.
  Acceptance: Reproduce the selected capability set from a clean install and verify operator recovery before production support claims. Verification: release acceptance.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).

<a id="oss"></a>
## OSS: Open-source distribution and maintenance

Maintain the project as an open-source distribution with clear contribution, packaging, support and security boundaries.

Milestone: **CROSS**. Default priority: **P1**. Responsibility: **Maintainers + developer experience**.
Package dependencies: BASE.

**Exit criterion:** A contributor can reproduce the local setup, add a provider safely and understand which releases and integrations are actually supported.

- [ ] **OSS-001** [P1; local] Define distribution and upstream policy.
  Acceptance: Preserve intended upstream relationships and document branch ownership, merge strategy and release maintenance. Verification: maintainer review.
- [ ] **OSS-002** [P1; local] Review software and asset licenses.
  Acceptance: Inventory dependencies, provider marks and redistributed assets and retain required notices and provenance. Verification: license inventory.
- [ ] **OSS-003** [P1; local] Document contribution and code ownership.
  Acceptance: Explain feature boundaries, TDD, real-PostgreSQL tests, Bun, design-system use and localized feature requirements. Verification: contributor walkthrough.
- [ ] **OSS-004** [P1; local] Publish provider and app contribution templates.
  Acceptance: Require capability, auth, resource, test, localization and operational evidence for proposed integrations. Verification: template review.
- [ ] **OSS-005** [P1; local] Define API/SDK compatibility policy.
  Acceptance: State supported versions, deprecation timing, migration expectations and issue-reporting requirements. Verification: compatibility review.
- [ ] **OSS-006** [P1; local] Create reproducible source and package artifacts.
  Acceptance: Pin dependencies, generate manifests/checksums and exclude private configuration, dumps and build caches from source handoffs. Verification: artifact inspection.
- [ ] **OSS-007** [P1; local] Implement CI qualification profiles.
  Acceptance: Run finite lint/type/unit/DB/contract checks and separate optional live-provider jobs from ordinary pull requests. Verification: CI validation.
- [ ] **OSS-008** [P1; local] Define vulnerability reporting and response.
  Acceptance: Publish a private reporting route, maintainer triage and coordinated fix/release process before public extension intake. Verification: incident walkthrough.
- [ ] **OSS-009** [P1; local] Create self-host quickstart and upgrade guides.
  Acceptance: Include local mode, provider prerequisites, backup/restore and truthful support limitations in FA/DE/EN. Verification: clean setup walkthrough.
- [ ] **OSS-010** [P1; local] Create release notes and support matrix.
  Acceptance: List implemented, locally tested, provider-validated and deployed capabilities with compatible client/app versions. Verification: release documentation.
- [ ] **OSS-011** [P1; local] Prepare tagged distribution and publisher assets.
  Acceptance: Produce a reviewable release, source bundle, client packages and registry metadata without publishing automatically. Verification: packaging verification.
- [ ] **OSS-012** [P1; publication] Publish and maintain authorized releases.
  Acceptance: Publish only the selected reviewed artifacts, then record destinations, version, support ownership and rollback information. Verification: release publication.

All tasks also require the shared [definition of done](integration-project-plan.md#definition-of-done).
