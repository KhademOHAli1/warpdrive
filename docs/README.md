# Warpdrive documentation

This fork is maintained at [KhademOHAli1/warpdrive](https://github.com/KhademOHAli1/warpdrive), with history and attribution retained from [sneg55/warpdrive](https://github.com/sneg55/warpdrive). Use the guide from the source or release that matches the installation. The public
[docs site](https://docs.warpdrivecrm.com/) is published separately from this repository.

## Start here

- [Installation and deployment](deploy.md), configuration and production services.
- [User guide](../docs-site/docs/intro.mdx), current CRM features.
- [Language and regional settings](../docs-site/docs/features/regional-settings.md), Farsi/German/English, calendars, digits, timezones, and appearance.
- [Architecture](../docs-site/docs/architecture.md), application, workers, storage, permissions, and conventions.
- [Contributing](../docs-site/docs/contributing.md), Bun, test lanes, review, and documentation maintenance.
- [Updating](../docs-site/docs/operations/updating.mdx), migration and backup procedure.

## Operators and contributors

- [Deployment and recovery](deployment-redesign.md), with separate evidence for source,
  image qualification, installation and recovery.
- [Release and review controls](delivery/ci-release-controls.md) and the
  [release operator guide](delivery/release-operations.md).
- [Mailbox guide](mailbox-guide.en.md) ([Deutsch](mailbox-guide.de.md) ·
  [فارسی](mailbox-guide.fa.md)) and [provider capability boundaries](email-provider-capabilities.md).
- [Newsletter source and installation guide](newsletters.md) and
  [operator qualification worksheet](newsletters-operations.md). The worksheet's
  checksum and archive commands are for filesystem media. For S3, qualify the
  versioned export, manifest verification and restore procedure for your backend
  before treating the recovery set as complete.
- [MCP security operations](mcp-security-operations.md) ([Deutsch](mcp-security-operations.de.md) ·
  [فارسی](mcp-security-operations.fa.md)).

## Interface and internationalization

See the [Better Auth implementation report](auth-implementation-report.md),
[operator guide](auth-operations.md), [Farsi guide](auth-operations.fa.md),
[German guide](auth-operations.de.md), and [current authentication UI](auth-ui-design.md)
for onboarding, MFA, sessions, recovery, and security policy.

- [UI maintenance](ui-updates.md), shared shadcn primitives, CRM adapters, themes, and RTL.
- [Localization glossary](i18n-glossary.md), contextual product wording.
- [Localization status and historical evidence](i18n-progress.md), current summary followed by dated checkpoints.
- [Language review](i18n-language-review.md), semantic wording review.
- [Activity timezone model](activity-timezones.md), instants versus calendar dates.
- [Multiple currencies](multicurrency.md), native currency values and separate totals.

## Visual workflows

- [Workflow issues](https://github.com/KhademOHAli1/warpdrive/issues?q=is%3Aissue+label%3Amodule%3Aworkflow) for current execution and the [preserved implementation status](workflows/status.md) for dated checkpoints.
- [Approved task plan](workflows/implementation-plan.md), dependencies and acceptance criteria.
- [UX specification and Mobbin references](workflows/ux-design-reference.md), user journeys and reference-to-task mapping.
- [Architecture decisions](workflows/architecture.md), definitions, publication, persistence, and authority.
- [Visual UI review](workflows/ui-review.md), observed journeys, screenshots, and outstanding visual acceptance.
- [Builder interaction review](workflows/builder-interaction-review.md), connection gestures, undo, mobile editing, and actual execution paths.
- [Historical continuation handoff](workflows/CONTINUATION.md), scope, evidence and ownership at the recorded revisions.
- [Workflow operations](workflows/operations.md), migrations, worker recovery, and current limits.
- [Public workflow feature guide](../docs-site/docs/features/automations.md), current availability and release boundaries.

## Specifications for future work

- [Google Calendar event workflow](google-calendar-event-workflow.md), advanced event creation, synchronization, and conferencing requirements.
- [Pipeline analytics and Insights proposal](pipeline-analytics-proposal.md), reporting scope and proposed workflows.

Specifications describe intended behavior. A planned integration is not an available connection. A passing unit test, local browser check, provider test, and deployed acceptance are different kinds of evidence; record them separately.

## Historical records

Use the [roadmap](../ROADMAP.md) and canonical issues for live scope and status.
Dated admission, qualification, handoff and design records retain the results at their
stated revisions. In particular, the old integration restart instructions and
[English](integration-execution/local-runtime.md),
[German](integration-execution/local-runtime.de.md) and
[Persian](integration-execution/local-runtime.fa.md) local runtime profiles describe
an isolated 31 October 2026 environment. For a new checkout, use the current
[setup instructions](../README.md#quickstart-local-development) and
[branch rules](../AGENTS.md).

## Documentation policy

For a feature or UI change, update its user-facing guide, implementation/operations notes, and task status in the same change. Update the root README when availability or setup changes. Add public guides under `docs-site/docs/` and order them in the nearest `meta.json`. Keep screenshot captions clear about date, locale, and whether a capture is current or historical. Never publish account data, credentials, or private test fixtures.

The public content and images stay in Warpdrive. The [standalone renderer](https://github.com/KhademOHAli1/warpdrive-docs)
builds them with the renderer revision pinned by `docs-site/renderer.lock`.
Use root-relative URLs inside the public guides. The renderer's export check verifies the
generated routes, bookmarks, links and assets.

Use portable Markdown for new content. See [Public documentation hosting](development/public-docs-migration.md)
for local preview and the pending hosting cutover.
