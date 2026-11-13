---
sidebar_position: 7
title: Import
description: "Import deals, leads, people, and organizations into Warpdrive from CSV: the upload and mapping wizard, deduplication, error reporting, and undo."
---

# Import

Open **Import data** in Settings to see import history. Select **New import** to
start. Your permission set must allow data import.

![The import wizard](/img/screenshots/import/wizard.png)

## The wizard

The wizard takes you through four steps.

1. **Upload** a CSV file by dragging it in or using the file picker. Select the
   **Source** and the record type under **Import as**. Use **CSV file** for a
   general CSV export or **Pipedrive export** for a file from Pipedrive.
2. Under **Map columns**, check the suggested matches and map any other columns
   you want to keep, including [custom fields](../administration/data-fields.md).
   When date options appear, choose the calendar and time zone used by the file.
3. **Preview** the parsed result. Review the valid rows, errors, and warnings
   before importing.
4. Select **Import** to process the valid rows.

Choosing **Pipedrive export** adds the **Notes** import target, the
Pipedrive ID column for safe re-runs, links between files, owners, deal history, and an
option to create missing pipelines and stages. See
[Migrating from Pipedrive](../guides/migrating-from-pipedrive.md) for the full walkthrough.

A person's name can be mapped as a single Name column or as separate **First name**
and **Last name** columns, since contact exports routinely split the name. Mapping
either part satisfies the required Name field, and mapped parts are joined into the
display name.

## How uploads and processing work

The file uploads directly from the browser to object storage using a presigned URL,
then the import itself runs as a **background job**.

:::caution
If an import stays at **Uploaded**, ask your administrator to check the background
worker before you retry. The worker may be stopped or unable to process the job.
:::

Because it is a background job, a large import continues if you navigate away.

## Deduplication and linking

For a people import, matching uses the person's primary email address. For an
organization import, matching uses the organization name without regard to case.
Choose **Skip the row** or **Update the existing contact** for matching contacts.
Only records you can see are considered for matching.

When importing linked people and organizations, Warpdrive reuses an eligible match
or creates the missing contact when it has enough information. Keep the original
IDs when re-running a Pipedrive export.

## Errors

Rows that fail are reported per row with the reason, rather than failing the whole
file. A partially successful import tells you exactly which rows did not land, so the
usual fix is to correct those rows and re-import only them.

Rows that imported but need a second look, such as a Pipedrive owner that matched no
Warpdrive user, carry a **warning**. Warnings appear next to the row in the results and
in the downloadable report, and never stop the row from importing.

## Undo

From import history, **Undo** removes records created by a completed or partially
completed batch when you have permission to delete them. Updates to existing
contacts and any pipelines or stages created during the import remain in place.
Use a small sample to check the mapping before importing your full file.

## Hidden fields

Built-in fields hidden in [Data fields](../administration/data-fields.md) are excluded
from column mapping, which keeps the mapping step to fields your team actually uses.

## Related

- [Migrating from Pipedrive](../guides/migrating-from-pipedrive.md)
- [Contacts](./contacts.md)
- [Leads](./leads.md)
- [Data fields](../administration/data-fields.md)
