<h1 align="center">warpdrive</h1>

<p align="center">
  An open-source, self-hosted <b>Pipedrive alternative</b> for business-development teams.<br/>
  Pipeline management, a deal workspace, contacts, and two-way Gmail, running entirely on your own infrastructure.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/self--hosted-single--tenant-2ea44f" alt="Self-hosted">
  <img src="https://img.shields.io/badge/Next.js-000?logo=next.js&logoColor=fff" alt="Next.js">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff" alt="TypeScript">
  <img src="https://img.shields.io/badge/Postgres-4169E1?logo=postgresql&logoColor=fff" alt="Postgres">
</p>

<p align="center">
  <img src="docs/screenshots/pipeline.png" alt="warpdrive pipeline board" width="100%">
</p>

warpdrive reimplements the core business-development workflow of Pipedrive as software you
run yourself. It is **single-tenant and self-hosted**: your own box, your own Postgres and
object storage, authenticated with your own Google Workspace. Core CRM records are stored on
your infrastructure; connected email and enrichment services process the data used by their
integrations. There is no per-seat application license fee.

The information architecture and workflows follow the tools BD teams already know, but all
code, styling, and assets are original, and the interface ships its own visual layer built
on [shadcn/ui](https://ui.shadcn.com). warpdrive is not affiliated with or endorsed by
Pipedrive.

This [maintained open source fork](https://github.com/KhademOHAli1/warpdrive) adds the Bun
runtime and Persian/German localization to [upstream Warpdrive](https://github.com/sneg55/warpdrive).
It retains the upstream relationship, history and MIT attribution.

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [warpdrive vs Pipedrive](#warpdrive-vs-pipedrive)
- [Tech stack](#tech-stack)
- [Quickstart (local development)](#quickstart-local-development)
- [Languages and regional settings](#languages-and-regional-settings)
- [Documentation and implementation status](#documentation-and-implementation-status)
- [Self-hosting](#self-hosting)
- [Tests](#tests)
- [Project status](#project-status)
- [Contributing](#contributing)
- [License](#license)

## Features

**Pipeline**
- Kanban board with drag-and-drop stages, multiple pipelines, and custom stages
- Per-stage weighted totals, rotting-deal indicators, and saved filters
- Board / list / archive views

**Deals**
- Deal workspace with a unified timeline: activities, notes, files, email, and full change history
- Participants, followers, labels, lost reasons, and close dates
- Won / lost handling with a stage-progress bar

**Contacts**
- People and organizations with custom fields (JSONB)
- Organization firmographics and org-to-org relationships
- Leads inbox and CSV import with an undo step

**Email (two-way Gmail)**
- Send and receive over the Gmail API, with thread linking to deals and people
- Open and click tracking, templates, signatures, merge fields, and scheduled send
- Personal inbox plus shared, deal- and contact-linked threads

**Team and platform**
- Role-based permissions, teams, and user management
- Notifications and basic pipeline stats (funnel, deal and activity performance)
- Realtime updates across the board, inbox, notifications, and presence over WebSocket

## Screenshots

**Deal workspace:** activities, notes, files, and the full history timeline in one view.

![Deal workspace](docs/screenshots/deal-workspace.png)

**Inbox:** two-way Gmail with thread linking, follow-up labels, and unread state.

![Email inbox](docs/screenshots/inbox.png)

**Contacts:** people and organizations with custom fields.

![Contacts](docs/screenshots/contacts.png)

## warpdrive vs Pipedrive

The table records this fork's current scope. Planned work is identified separately from
features available in the application.

|                                                            |                    warpdrive                    |   Pipedrive    |
| ---------------------------------------------------------- | :---------------------------------------------: | :------------: |
| License                                                    |                MIT, open source                 |  Proprietary   |
| Hosting                                                    |           Self-hosted, single-tenant            |  Vendor cloud  |
| Pricing                                                    |         Free (your infrastructure only)         | Paid, per seat |
| Your data                                                  |          Stays on your infrastructure           | Vendor servers |
| Kanban pipeline + custom stages                            |                       ✅                        |       ✅       |
| Multiple pipelines                                         |                       ✅                        |       ✅       |
| Deal workspace (activities, notes, files, history)         |                       ✅                        |       ✅       |
| Contacts and organizations + custom fields                 |                       ✅                        |       ✅       |
| Leads inbox + CSV import (with undo)                       |                       ✅                        |       ✅       |
| Two-way Gmail (send/receive, threads, open/click tracking) |                       ✅                        |       ✅       |
| Email templates, signatures, scheduled send                |                       ✅                        |       ✅       |
| Permissions, teams, user management                        |                       ✅                        |       ✅       |
| Saved filters                                              |                       ✅                        |       ✅       |
| Realtime board / inbox / presence                          |                       ✅                        |       ✅       |
| Notifications                                              |                       ✅                        |       ✅       |
| Pipeline stats (funnel, performance)                       |                    ✅ Basic                     |  ✅ Advanced   |
| Products, Projects, Invoicing, Forecast                    |                 ➖ Out of scope                 |       ✅       |
| Native currency values and separate currency totals        |                       ✅                        |       ✅       |
| Workflow automation                                        | Email scheduling; visual builder in development |       ✅       |
| Web forms / chatbot / marketplace                          |                 ➖ Out of scope                 |       ✅       |
| Native mobile apps                                         |                   ➖ Web app                    |       ✅       |

✅ supported · ➖ outside the current implementation

## Tech stack

Next.js (App Router) and React with TypeScript, Drizzle ORM on Postgres, tRPC with TanStack
Query, Next server actions, shadcn/ui with Tailwind, dnd-kit for the board, Zustand for
board-local state, a self-hosted WebSocket server backed by Postgres LISTEN/NOTIFY, MinIO
(or any S3-compatible store) for files, and the Gmail API via Google OAuth. Package manager:
Bun.

## Quickstart (local development)

Requires Bun and Docker.

The upstream MinIO container references in the compose file may no longer be publicly available.
An S3-compatible service can be used for local development, but the shipped compose setup needs
an updated storage image before it can be relied on for a fresh installation.

```bash
git clone https://github.com/KhademOHAli1/warpdrive.git
cd warpdrive
bun install --frozen-lockfile
cp .env.example .env
# bring up Postgres and MinIO with host ports and no TLS:
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres minio
bun run db:migrate
bun run dev
```

The app runs at `http://localhost:3000`. Google sign-in and Gmail need an OAuth client (see
[`docs/deploy.md`](docs/deploy.md)); for local exploration you can sign in without Google
using `/auth/dev-login` in development. That route is not a production sign-in method.

## Languages and regional settings

Select English, Iranian Persian (Farsi), or German in Settings > Regional settings.
Language, calendar and account time zone are independent saved preferences. Persian uses
right-to-left layout and offers Persian or Latin digits. German uses decimal commas and
localized dates. Both the Gregorian and Iranian Solar Hijri calendars are available in the
shared date pickers and activities calendar. Saved dates remain Gregorian ISO values; stored
amounts and API/export formats retain their canonical representation.

Translations use whole messages, contextual terminology, ICU plurals and localized accessibility
labels. See [the localization glossary](docs/i18n-glossary.md) and
[localization progress and verification](docs/i18n-progress.md). Run `bun run i18n:check` when
changing interface copy; catalog validity is followed by contextual workflow review.

## Calendar roadmap

The next calendar milestone is the Google Calendar web event workflow, including its
advanced fields, invitations, recurrence, conferencing and account-dependent options.
The [workflow specification](docs/google-calendar-event-workflow.md) records the reference
behavior, current gaps and acceptance criteria. This milestone is documentation only;
calendar implementation is deferred until work resumes. Google Meet, Zoom, Teams and
external calendar synchronization are planned capabilities, not current integrations.

The current UI includes the updated sidebar and top bar, separate regional, appearance
and workflow settings, contact directories and inbox workspace. These changes are kept
together with the English, Persian and German catalogs.

## Documentation and implementation status

Start with the [documentation index](docs/README.md) and the [current user guide](docs-site/docs/intro.md).
The guide now covers the updated navigation, separate regional/appearance/workflow preferences,
Farsi/German behavior, Iranian date input, and native currency values. Existing screenshots are
historical illustrations and may precede the current shell.

The [visual workflow builder](docs/workflows/status.md) is in implementation. Its approved
42-task plan, Mobbin design references, architecture decisions, and verification ledger live
in `docs/workflows/`. The first increment adds internal definition/version foundations;
a user-facing editor and execution engine are not yet available. Personal workflow preferences
in Settings are a separate existing feature.

## Self-hosting

The repo ships a single-box Docker topology (app, WebSocket server, background worker,
Postgres, MinIO, and Caddy for automatic HTTPS):

```bash
cp .env.example .env    # fill in domain, Google OAuth, storage, and secrets
docker compose up -d --build
```

Caddy provisions TLS for your domain automatically; Postgres and MinIO stay on the internal
network. See [`docs/deploy.md`](docs/deploy.md) for the full guide, including Google OAuth
setup, the `s3.` subdomain for file uploads, and every required environment variable.

## Tests

```bash
bun run test:unit          # fast unit tests
bun run test:integration   # spins up a disposable Postgres via Testcontainers
```

Integration tests run against a real Postgres (never a mock) so migrations and queries are
exercised as they run in production.

## Project status

This fork focuses on the Bun runtime, Iranian calendar support and contextual Persian/German
localization. [Localization progress](docs/i18n-progress.md) records source, test, CI and local
browser evidence. Production deployment and external OAuth/Gmail configuration remain
specific to the installation.

The [advanced pipeline analytics proposal](docs/pipeline-analytics-proposal.md) outlines an
Insights view, richer funnel analysis, bottlenecks, pipeline movement and future forecasting.
It records a proposed direction rather than additional shipped features.

## Contributing

Focused pull requests to this fork are welcome. Include tests for new behavior and run the
Bun typecheck, translation audit and lint checks. Keep identifiers, stored records and API
contracts independent of interface language; use the [localization glossary](docs/i18n-glossary.md)
for translation changes. Changes of general interest can also be proposed to the upstream project.

## License

MIT. See [`LICENSE`](LICENSE).

## Shared UI updates

The shared UI follows the current shadcn Radix Nova registry with RTL support. Run
`bun run ui:check` to preview registry updates and `bun run ui:update` to apply and verify them.
CRM adapters are kept outside the replaceable registry directory. See
[the UI update guide](docs/ui-updates.md) for the workflow and compatibility notes.
