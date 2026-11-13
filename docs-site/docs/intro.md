---
sidebar_position: 1
slug: /
title: Introduction
description: "Warpdrive is an open-source, self-hosted CRM for business-development teams: pipeline management, a deal workspace, contacts, and two-way Gmail, on your own infrastructure."
---

# Warpdrive

Warpdrive is an open-source, self-hosted CRM for a company's business-development
team. It covers pipeline management, a deal workspace, contacts and organizations,
two-way Gmail, contact enrichment, user management, notifications, and a
performance page with sales metrics and quota goals.

The application and CRM storage run on infrastructure you control. Connected
mailbox and enrichment providers process the data used by those integrations.

## What it does

- **Pipeline management.** A drag-and-drop board of deals across stages, with a list
  view and an archive. Stages can flag deals that have gone stale.
- **Deal workspace.** A per-deal page holding the summary, activities, notes, files,
  participants, and the email thread history.
- **Contacts.** People and organizations, linked to each other and to deals.
- **Leads.** A separate inbox for unqualified prospects, convertible into deals.
- **Email.** Connect a mailbox, send from the CRM, and link conversations to the
  relevant records. See [Email sync](./administration/email-sync.md) for setup.
- **Activities.** Calls, meetings, and tasks, in a list and on a calendar.
- **Enrichment.** Fill empty fields on people and organizations from Apollo,
  RocketReach, and GetProspect, behind an explicit review step.
- **Performance.** Sales metrics, a stage funnel built from real stage history, and
  quota goals with pace.
- **AI access.** If the installation enables MCP, authorized assistants can read and
  update the CRM within the user's permissions.
- **Administration.** Users, teams, permission sets, and visibility groups.
- **Languages and region.** English, Persian (right to left), and German. Choose
  Gregorian or Solar Hijri calendar display, time zone, and digits independently.
  See [Regional settings](./features/regional-settings.md).
- **Currencies.** Native amounts on leads/deals and separate currency totals, without
  exchange-rate conversion.

<span id="what-it-is-not" />

## Implementation scope

See [Visual workflows](./features/automations.md) for the early-access workflow
editor and the manual deal follow-up it supports. Availability can vary by
installation and configuration. The release notes describe the scope of each
published version. For external calendar and other provider connections, check
the setup and availability in the relevant feature guide.

## Single-tenant by design

One Warpdrive deployment serves one company. Use teams, permission sets, and
visibility groups to manage access within that workspace.

## Where to go next

- [Installation](./setup.md) walks through a single-box Docker Compose deployment.
- [Architecture](./architecture.md) covers the stack and how the pieces fit.
- The feature pages document each surface in detail, starting with
  [Pipeline](./features/pipeline.md).

## License

MIT. The source lives at
[github.com/KhademOHAli1/warpdrive](https://github.com/KhademOHAli1/warpdrive),
with upstream attribution to [sneg55/warpdrive](https://github.com/sneg55/warpdrive).
