# Warpdrive documentation

This fork is maintained at [KhademOHAli1/warpdrive](https://github.com/KhademOHAli1/warpdrive), with history and attribution retained from [sneg55/warpdrive](https://github.com/sneg55/warpdrive). Documentation changes ship with the implementation they describe.

## Start here

- [Installation and deployment](deploy.md), configuration and production services.
- [User guide](../docs-site/docs/intro.md), current CRM features.
- [Language and regional settings](../docs-site/docs/features/regional-settings.md), Farsi/German/English, calendars, digits, timezones, and appearance.
- [Architecture](../docs-site/docs/architecture.md), application, workers, storage, permissions, and conventions.
- [Contributing](../docs-site/docs/contributing.md), Bun, test lanes, review, and documentation maintenance.
- [Updating](../docs-site/docs/operations/updating.md), migration and backup procedure.

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

- [Implementation status](workflows/status.md), what is implemented and which milestone comes next.
- [Approved task plan](workflows/implementation-plan.md), dependencies and acceptance criteria.
- [UX specification and Mobbin references](workflows/ux-design-reference.md), user journeys and reference-to-task mapping.
- [Architecture decisions](workflows/architecture.md), definitions, publication, persistence, and authority.
- [Visual UI review](workflows/ui-review.md), observed journeys, screenshots, and outstanding visual acceptance.
- [Workflow operations](workflows/operations.md), migrations, worker recovery, and current limits.
- [Public workflow feature guide](../docs-site/docs/features/automations.md), current availability and release boundaries.

## Specifications for future work

- [Google Calendar event workflow](google-calendar-event-workflow.md), advanced event creation, synchronization, and conferencing requirements.
- [Pipeline analytics and Insights proposal](pipeline-analytics-proposal.md), reporting scope and proposed workflows.

Specifications describe intended behavior. A planned integration is not an available connection. A passing unit test, local browser check, provider test, and deployed acceptance are different kinds of evidence; record them separately.

## Documentation policy

For a feature or UI change, update its user-facing guide, implementation/operations notes, and task status in the same change. Update the root README when availability or setup changes. Add new published pages to `docs-site/sidebars.ts`. Keep screenshot captions clear about date, locale, and whether a capture is current or historical. Never publish account data, credentials, or private test fixtures.

The documentation site is a separate Bun package. Use its declared package manager and lockfile, then run its production build to check links. Root tests and site builds each need their own recorded result. Check that Markdown links work both in the repository and in Docusaurus.
