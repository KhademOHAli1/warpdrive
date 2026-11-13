---
sidebar_position: 3
title: Leads
description: "The Warpdrive leads inbox: capturing unqualified prospects, linking them to people and organizations, converting them into deals, and archiving."
---

# Leads

Use the leads inbox to track prospects before they enter the
[pipeline](./pipeline.md) as deals.

`/leads` is the list; `/leads/[leadId]` is one lead.

![The leads inbox](/img/screenshots/leads/list.png)

Opening a lead from the list shows it in a slide-over panel over the list rather than
navigating away.

## What a lead holds

A lead has a title, an optional value, a source, and links to a person and an
organization. Labels and owners work as they do on deals.

## Linking to contacts

A lead can link to a person, an organization, or both. Select an existing contact
when it is already in Warpdrive. For bulk entry, see
[Deduplication and linking](./import.md#deduplication-and-linking).

## Converting

Converting a lead creates a deal from it, carrying across its value, contacts, and
labels, and takes the lead out of the active list.

The deal receives copies of the lead's notes and activities, including completed
activities. Notes retain their authors and original dates. Email threads that
have no deal link gain a link to the new deal and remain linked to the lead.
The lead retains its original history.

Conversion is the point at which something enters the pipeline, which is what keeps
pipeline totals meaningful.

## Archiving

Leads that go nowhere are archived rather than deleted, so the record of having tried
survives. Archived leads are excluded from the active list.

## Visibility

Leads follow the same visibility model as other records. See
[Visibility groups](../administration/visibility-groups.md).

## Related

- [Import](./import.md), for bulk lead import.
- [Contacts](./contacts.md)
- [Pipeline](./pipeline.md)
