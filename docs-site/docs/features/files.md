---
title: Files
description: "Attaching files to Warpdrive records: presigned direct uploads to object storage, size limits, and where files are stored."
---

# Files

Files can be attached to deals, people, and organizations, and are listed on the
record with their size and uploader.

## How uploads work

Open **Files** on the record and select the file to attach. The browser sends the
file directly to object storage using a temporary upload URL.

If uploads fail for everyone, ask your administrator to check that the object
storage endpoint is reachable from a browser. The single-server Compose example
uses a dedicated hostname with DNS and HTTPS configured. See
[Installation](/setup/).

## Size limit

The attachment picker accepts files up to 25 MiB. Your installation can enforce a
lower server limit through `MAX_FILE_BYTES`.

## Storage and backups

In the single-server Compose example, the `miniodata` volume holds attachment
objects and the database holds their record links. Back up and restore both
together to recover the files. See [Updating](/operations/updating/).

## Visibility

A file inherits the visibility of the record it is attached to.

## Related

- [Deal workspace](/features/deal-workspace/)
- [Installation](/setup/)
