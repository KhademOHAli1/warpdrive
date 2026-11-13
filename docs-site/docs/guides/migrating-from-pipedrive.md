---
title: Migrating from Pipedrive
description: "Move organizations, people, leads, deals, activities, and notes from Pipedrive CSV exports into Warpdrive, in the right order, with owners, links, and history kept."
---

# Migrating from Pipedrive

Export each record type from Pipedrive as a separate CSV file, then import
the files in order so Warpdrive can link them. See
[Import](../features/import.md) for the wizard steps.

## Before you start

1. **Invite your team first.** The importer matches owners to active Warpdrive
   users by email, then by name. Make sure your team can sign in before the
   import. See [Users and teams](../administration/users-and-teams.md).
2. **Create pipelines and stages if their order matters.** The importer can create missing pipelines and stages for you (see below), but it appends new stages in the order the file first names them. If you want a specific order, create the pipelines and stages yourself, or reorder them afterwards.

## Export from Pipedrive

In Pipedrive, open **Tools and apps → Export data** and choose **CSV** for each
record type. Export activities and notes separately. If you use a list export,
include the **ID** field in the column chooser. Check that every file contains
the record's own ID and keep the linked record IDs where available. Warpdrive
uses the IDs to link files and identify rows that were already imported.
See [Pipedrive's export guide](https://support.pipedrive.com/en/article/exporting-data-from-pipedrive).

## Import order

Import the files in this order, choosing **Pipedrive export** as the **Source** on the upload step:

1. Organizations
2. People
3. Leads
4. Deals
5. Activities
6. Notes

The order matters because later files link to earlier ones. **Notes** appears
under **Import as** when the source is **Pipedrive export**.

Convert leads to deals only after every file is in. Activities and notes imported later attach to the lead, not to the deal it became.

For each file, Warpdrive pre-matches columns from their headers. Check the mapping before you continue, and fix any column that landed on the wrong field.

## How records are linked

- **Leads** link to their person and organization by Pipedrive ID, or by name.
- **Activities and notes** link to deals, leads, people, and organizations by their Pipedrive IDs when those columns are present in the file, and by exact name otherwise. If a name is ambiguous or matches nothing, the row fails with a message saying which file to import first.
- **An activity links a deal or a lead, not both.** A row that names both fails.
- **A note attaches to one record:** its deal when it has one, otherwise its lead, otherwise its person, otherwise its organization.
- **Owners** are matched to active Warpdrive users by email, then by name. A
  missing or ambiguous match, or a permission that prevents reassignment, leaves
  the importing user as owner of a newly created record and adds a warning to
  the results and downloadable report.

## What is kept

- **Deals** keep their status, won and lost dates, lost reason, labels, and creation date.
- **Leads** keep their owner, labels, creation date, and archived state. Their source and channel are not carried over.
- **Activities** keep their done state and done time. Overdue and done imported activities do not send reminders.
- **Deals and leads** can retain their currency when you map the source column to
  **Currency**. Check the mapping before importing.
- **Dates and times** use the source calendar and time zone you choose in
  **Map columns**. The defaults are Gregorian and UTC.

## Create missing pipelines and stages

On a deal import from a Pipedrive export, a **Create missing pipelines and stages** checkbox is available. It requires the pipeline-management permission. When it is on, any pipeline or stage named in the file that does not exist yet is created, and new stages are appended in the order the file first names them.

Undo does not remove pipelines or stages the import created. Delete them by hand if you do not want them.

## Re-running a file

Re-running a file skips rows whose Pipedrive ID still points to a record you can
see. If rows failed, fix the file or import the missing linked records first,
then retry with the same IDs. Review owner warnings separately. A warning can
appear on a row that was already imported.

## What does not come across

- Lead source and channel
- Products
- Files
- Email history
- Stage history

## Related

- [Import](../features/import.md)
- [Users and teams](../administration/users-and-teams.md)
- [Deal workspace](../features/deal-workspace.md)
