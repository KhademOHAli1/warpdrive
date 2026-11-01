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

The application and core CRM storage run on infrastructure you control. Connected
mailbox and enrichment providers process the data used by those integrations. This
maintained fork keeps upstream history and MIT attribution, and adds Bun plus
Farsi/German localization.

## What it does

- **Pipeline management.** A drag-and-drop board of deals across stages, with a list
  view and an archive. Stages can flag deals that have gone stale.
- **Deal workspace.** A per-deal page holding the summary, activities, notes, files,
  participants, and the email thread history.
- **Contacts.** People and organizations, linked to each other and to deals.
- **Leads.** A separate inbox for unqualified prospects, convertible into deals.
- **Email.** Two-way Gmail over OAuth: send from inside the CRM, and see replies on
  the record they belong to.
- **Activities.** Calls, meetings, and tasks, in a list and on a calendar.
- **Enrichment.** Fill empty fields on people and organizations from Apollo,
  RocketReach, and GetProspect, behind an explicit review step.
- **Performance.** Sales metrics, a stage funnel built from real stage history, and
  quota goals with pace.
- **AI access.** An OAuth-protected MCP server so assistants can read and update the
  CRM under each user's own permissions.
- **Administration.** Users, teams, permission sets, and visibility groups.
- **Languages and region.** English, Farsi RTL, and German; independent Gregorian/
  Iranian calendar, timezone, and digit preferences. See [Regional settings](./features/regional-settings.md).
- **Currencies.** Native amounts on leads/deals and separate currency totals, without
  exchange-rate conversion.

## Implementation scope

Visual workflow automation is being implemented in stages. An early-access editor
supports connectable nodes, conditional manual deal follow-up workflows, simulation, publication, background execution,
and run history. Automatic triggers and advanced actions remain in development. See
[Visual workflows](./features/automations.md) for the current boundary.

The Google Calendar event editor, external calendar synchronization, conferencing
providers, and advanced pipeline Insights have separate specifications. They are
planned capabilities, not available integrations. Existing scheduled email,
activity reminders, and basic performance reports remain available.

## Single-tenant by design

Warpdrive is single-tenant: one deployment serves one company. There is no
organization switcher and no cross-tenant data model, which is what keeps the
permissions model comprehensible and the queries simple.

## Where to go next

- [Installation](./setup.md) walks through a single-box Docker Compose deployment.
- [Architecture](./architecture.md) covers the stack and how the pieces fit.
- The feature pages document each surface in detail, starting with
  [Pipeline](./features/pipeline.md).

## License

MIT. The source lives at
[github.com/KhademOHAli1/warpdrive](https://github.com/KhademOHAli1/warpdrive),
with upstream attribution to [sneg55/warpdrive](https://github.com/sneg55/warpdrive).
