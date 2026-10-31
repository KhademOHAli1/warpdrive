# Integration platform overview and legacy work packages

Updated 2026-10-31. The full [project plan](integration-project-plan.md) now defines the
delivery milestones and shared acceptance gates. Its [detailed task register](integration-platform-tasks.md)
contains 446 planned tasks across 23 packages, with a matching [CSV export](integration-platform-tasks.csv).
This overview preserves the earlier identifiers used by existing handoffs. It is not a claim
of feature parity. The current delivery remains a local preview; live authorization,
public endpoints, publication and marketplace installation are separate stages.

## Product boundaries

The connections hub owns discovering providers, account authorization, configuration,
health, reconnecting, and revocation. The MCP server exposes permitted CRM operations to
AI clients. Client packages add reusable workflows. The later marketplace distributes
versioned extensions, including providers and workflow actions, through the same registry.

Keep the existing Warpdrive shell, settings navigation, tokens, controls, and account
preferences. Farsi, German, and English are required across copy, errors, keyboard flows,
notifications, dates, and provider setup. Calendar and language remain independent.

## Current preview

| ID        | Deliverable                                  | Status / acceptance                                                                              |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| HUB-01    | Searchable provider directory and categories | Implemented; localized search, available/setup/planned states                                    |
| HUB-02    | Focused provider detail dialogs              | Implemented; existing design-system Dialog with focus restoration                                |
| HUB-03    | Unified personal connections                 | Implemented; existing Gmail controls and AI grants remain reachable                              |
| HUB-04    | Client-specific AI onboarding                | Implemented; ChatGPT, Claude, and generic remote MCP instructions; disabled server is explained  |
| HUB-05    | Slack operator setup guidance                | Implemented; app settings link, exact callback, bot scopes, server configuration                 |
| SLACK-01  | Workspace OAuth installation                 | Implemented in source; admin-only, fresh session, CSRF, hashed single-use state, session binding |
| SLACK-02  | Credential storage and channel selection     | Implemented; encrypted token, public channels the bot has joined, backend channel validation     |
| SLACK-03  | Test and disconnect                          | Implemented; local use blocked before remote revocation, retry state on provider outage          |
| MCP-01    | Structured results and action annotations    | Implemented for the existing 35-tool surface; annotations do not enforce permissions             |
| MCP-02    | Bind JWT audience to the MCP endpoint        | Implemented; other audiences rejected                                                            |
| MCP-03    | Keep refreshable connections visible         | Implemented; valid refresh grants survive access-token expiry in settings                        |
| CLIENT-01 | Generate ChatGPT/Claude packages             | Implemented; OAuth configuration plus meeting/pipeline/draft workflows and FA/DE guidance        |
| LOCAL-01  | Browser and automated qualification          | See implementation report; live third-party installs are not part of this gate                   |

## Remaining foundation and MCP scope

- [ ] FND-01: Persistent installation/grant records with explicit personal/organization ownership and delegation rules.
- [ ] FND-02: Separate per-client read/write/domain scopes, with clear consent and server enforcement in addition to CRM permissions.
- [ ] FND-03: Verified client identity/CIMD where supported, registration administration, and consistent resource request validation.
- [ ] FND-04: General provider SDK with OAuth, API-key, custom credential, token rotation, and secret-key rotation support.
- [ ] FND-05: Shared jobs, leases, retries/backoff, rate-limit handling, dead-letter review, and notification delivery.
- [ ] FND-06: Scoped public API, signed outbound events, replay protection, idempotency, and developer documentation.
- [ ] MCP-04: Capability matrix for every CRM domain; add approved file/note/report/custom-field workflows with visibility tests.
- [ ] MCP-05: Repeatable cross-client authorization, refresh, revocation, permission-change, and offboarding qualification.
- [ ] MCP-06: Optional embedded record/pipeline/calendar views using supported MCP UI extensions, with safe host fallback.
- [ ] CLIENT-02: Public client packaging validation, listing assets, vendor review, install/update/uninstall tests.

## Provider backlog

Each provider must include account selection, explicit permissions, resource selection,
test/configure/reconnect/disconnect, health and errors, revocation, operator instructions,
FA/DE/EN review, and evidence from the actual upstream provider before release.

| Priority / ID     | Provider                         | Required workflow                                                                                                       |
| ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| First / SLACK-04  | Slack                            | Record-change alerts, routing rules, signed events, link previews, slash/message actions, safe CRM identity linking     |
| First / GOOGLE-01 | Gmail                            | Retain current sync; multiple accounts, provider readiness, domain/account policy review                                |
| First / GOOGLE-02 | Google Calendar + Meet           | Calendar selection, two-way sync, guests/RSVP, recurrence exceptions, reminders/privacy, conference creation, conflicts |
| First / MS-01     | Microsoft 365 + Teams            | Outlook mail/calendar, delegated scopes, tenant policy, two-way sync, Teams meeting lifecycle                           |
| First / ZOOM-01   | Zoom                             | OAuth/refresh, create/update/cancel, host account, meeting options, CRM linking                                         |
| Next / AUTO-01    | n8n, Make, Zapier                | Maintained connectors, record triggers/actions, signed webhooks, templates, execution history                           |
| Next / FILE-01    | Drive, OneDrive, Dropbox         | Permission-aware browse/link/attach, shared resources, revocation and deleted-file handling                             |
| Next / WORK-01    | GitHub, Linear, Jira             | Link records to issues/projects; status updates and configurable synchronization                                        |
| Later / BOOK-01   | Calendly, Cal.com                | Bookings/cancellations/rescheduling, CRM linking, timezone/calendar behavior                                            |
| Later / MSG-01    | WhatsApp Business, telephony     | Conversation/call logging, authorized messaging, provider event verification                                            |
| Later / BIZ-01    | Stripe, accounting, e-signatures | Payment/invoice/proposal/signature status and reviewable outbound actions                                               |

Calendar implementation must also satisfy [the existing event workflow specification](google-calendar-event-workflow.md).
An OAuth connection alone does not establish synchronization or conferencing support.

## Marketplace and extension programme

- [ ] APP-01: Versioned manifest and Bun/TypeScript SDK, stable application IDs, capability declarations, compatibility ranges.
- [ ] APP-02: App roles, least privilege, server-side API enforcement, credential isolation, network policy, quotas, audit attribution.
- [ ] APP-03: Isolated function execution and bounded jobs; never run an untrusted plugin inside the web application process.
- [ ] APP-04: Sandboxed UI extension points: record panels/widgets, navigation, command actions, settings, and translation context.
- [ ] APP-05: Workflow triggers/actions and optional MCP tools registered through the same capability contract.
- [ ] MARKET-01: Search/categories, app details, publisher identity, documentation, screenshots, permissions, compatibility, changelog.
- [ ] MARKET-02: Review/install/configure/enable/disable/update/uninstall, migration planning and explicit data-retention choices.
- [ ] MARKET-03: Private organization distribution, public registry, provenance/signatures, reviews, reporting, emergency disabling.
- [ ] MARKET-04: SDK examples, CLI scaffolding/build/test/publish, CI fixtures, versioned documentation and support policy.

## Twenty comparison

Twenty documents Google/Microsoft mail and calendar, REST/GraphQL APIs, webhooks,
workflow HTTP actions, OAuth connection providers, and apps that add objects, logic,
UI, and AI skills. Its app framework and public/private publishing are the parity target.
This preview does not claim that those broader capabilities are complete.

Primary sources checked 2026-10-31:

- [Calendar, email and integration methods](https://docs.twenty.com/getting-started/core-concepts/calendar-and-email)
- [Workflow triggers/actions](https://docs.twenty.com/getting-started/core-concepts/workflows)
- [App capabilities and isolation](https://docs.twenty.com/getting-started/core-concepts/apps)
- [Reusable OAuth connection providers](https://docs.twenty.com/developers/extend/apps/logic/connections)
- [Publishing and compatibility](https://docs.twenty.com/developers/extend/apps/operations/publishing)
- [Recent marketplace, conferencing and Teams features](https://twenty.com/releases)
