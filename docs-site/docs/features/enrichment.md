---
sidebar_position: 12
title: Enrichment
description: "Fill the gaps on people and organizations from Apollo, RocketReach, and GetProspect: connecting providers, the review dialog, field mapping, caching, and failure handling."
---

# Enrichment

Enrichment suggests values for people and organizations from the external
providers **Apollo**, **RocketReach**, and **GetProspect**.

The **Fill the gaps** button appears on the deal workspace, the lead drawer, the
person page, and the organization page. Warpdrive combines the responses from
eligible providers and opens a review dialog. You choose which values to write to
the record.

## The review dialog

The dialog shows each field the providers returned, next to the value the record
already holds. You choose what to apply. A returned value can also **replace** a
value the record already has, not only fill an empty one, so a stale employee count
or an outdated address can be corrected from the same dialog.

Applied writes go through the same update path as manual edits: the visibility
check, the `contact.edit` permission, and custom-field validation all apply, and
every applied change lands in the record's change log attributed to you.

## Connecting providers

Administrators configure providers at `/settings/enrichment`. Enabling a provider
allows lookups to send the name, email address, or domain needed for that lookup
to the provider. Each provider has:

- an **enable toggle**, independent of the key, so a provider can be switched off
  without losing its credential
- a **write-only key field**; keys are encrypted at rest and never displayed back
- a **Test connection** button

## Field mapping

A field-mapping card on the settings page decides where each piece of provider data
lands.

Organization enrichment works out of the box, because domain, industry, employee
count, annual revenue, LinkedIn URL, and the address fields are already built-in
organization fields.

Person enrichment writes emails, the first and last name, and the organization link
by default. For anything beyond that (job title, LinkedIn profile), create a
[custom field](../administration/data-fields.md) and map it.

## Caching

Warpdrive can reuse a saved result within the cache window, which defaults to
30 days. Administrators can change the window or set it to zero to disable reuse.
When available, **Refresh** starts a new lookup with eligible providers and can
use provider credits.

## When a provider fails

Provider failures are classified rather than lumped together:

- A **rejected key** badges that provider's settings card. Warpdrive distinguishes a
  bad key from a plan that simply does not include an endpoint: some providers
  entitle organization and person lookups separately, and a plan refusing one
  endpoint does not condemn the credential.
- A **rate limit** is remembered and the provider is skipped until it passes. It
  never disables the provider.
- **Quota exhaustion** puts the provider on a 24-hour cooldown, reported separately
  from a rate limit.

A run succeeds if any provider answered, and a provider skipped for a cooldown is
still named in the dialog footer, so a thin result never silently reads as the
whole picture.

## Visibility

The lookup sent to a provider is bounded by what you can see. A hidden
organization's name and domain are not sent to a third party via a person you can
still see.

## Related

- [Contacts](./contacts.md)
- [Data fields](../administration/data-fields.md), for mapping person fields.
