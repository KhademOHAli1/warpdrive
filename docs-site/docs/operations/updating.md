---
sidebar_position: 1
title: Updating
description: "Upgrade a self-hosted Warpdrive deployment, take database and file backups, read logs, and reach Postgres and MinIO on the box."
---

# Updating

## Upgrading

Identify the revision and images your installation is running. Check the release
notes for the target revision and confirm that they cover your database version,
storage backend, and upgrade path. Select the exact tested source revision or
immutable image references for your installation.

The fork's [1.6.1 release notes](https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.6.1)
describe a bounded newsletter source release. Its GitHub assets are a source
archive and supporting records. For an installed update, check the separately
qualified images, migration path, and provider and installation results.

1. Rehearse the upgrade with a restored copy of your current installation in
   isolation. Check the migrations, application workflows, and recovery procedure
   there before scheduling the upgrade.
2. Back up the database, private files, and required runtime keys together. For a
   migration that requires downtime, stop incoming traffic and all database
   writers, including the app, worker, Realtime, and any external integrations
   that write to the database. Follow the sequence for the selected release.
3. Run the release's migration step with its owner credentials and check the result
   before starting the target runtime. The Compose dependency on `migrate` gates
   startup of new processes. It leaves existing processes running unless you stop
   them first. If migration fails, keep the runtime stopped and use the rehearsed
   recovery procedure. Returning to an older image alone cannot reverse schema
   changes.
4. Check service status, sign-in, worker jobs, file access, and Realtime using the
   updated installation. Verify the provider workflows you use before reopening
   normal traffic.

<span id="upgrading-from-minio" />

### Storage upgrades

Check which object store and bucket the running installation uses before upgrading.
If the target changes the storage backend, rehearse copying the private objects and
verifying uploads and downloads before switching. The fork's Compose configuration
described in [Installation](../setup.md) uses MinIO.

## The update banner

When the update check is enabled, the worker looks for the fork's latest GitHub
release. Administrators can see a banner when that version is newer than the
running web version. Read the linked release notes to determine the scope.

| Variable | Effect |
| --- | --- |
| `APP_VERSION` | For the source Compose build, a valid version stamp takes precedence over `package.json`. With neither, the app uses `dev` and skips the comparison. An independently deployed web component reports its own version. |
| `DISABLE_UPDATE_CHECK` | Set `true` to disable the banner and the GitHub poll entirely. |

Configure email, enrichment, and telemetry separately from release polling.

## Backups

Keep a consistent recovery set containing the database, the private objects, and
the keys and configuration needed to read them. Store the set securely outside the
installation and verify a restore in isolation.

For the source Compose configuration, this command takes a logical database dump
using the default role and database. Substitute the configured names:

```sh
docker compose exec -T postgres pg_dump -U warpdrive -d warpdrive -Fc \
  > "warpdrive-$(date +%F).dump"
```

Check that `pg_dump` exited successfully before retaining the file. Plan to
recreate required database roles and grants as part of the restore. Back up the
`miniodata` volume or the equivalent private bucket with your object store's
supported procedure. Keep the source revision, migration journal, configuration,
and restore checks with the recovery record.

Verify that the restored workspace can read an attachment and use any encrypted
configuration it needs. Check provider workflows on the intended installation.

## Logs

```sh
docker compose logs -f app      # the application
docker compose logs -f worker   # mailbox sync, imports, scheduled sends
docker compose logs -f ws       # realtime
docker compose logs -f caddy    # TLS and routing
```

For a stalled import, mailbox sync, or scheduled send, check whether the worker
is running and inspect its logs before retrying.

## Reaching Postgres

In the source Compose setup, PostgreSQL is on the internal network. Open a shell
session against the configured database from the deployment host:

```sh
docker compose exec postgres psql -U warpdrive -d warpdrive
```

Caddy serves the storage API at the configured S3 hostname for signed transfers.
Use private operator access for the storage console.

## Health

```sh
curl -fsS https://crm.example.com/api/health
```

Substitute your hostname. A response of `{"ok":true}` confirms that the app can
reach the database. Check the worker, storage, and provider connections separately.

## Related

- [Installation](../setup.md)
- [Architecture](../architecture.md)
