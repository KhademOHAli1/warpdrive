---
sidebar_position: 1
title: Updating
description: "Upgrade a self-hosted Warpdrive deployment, take database and file backups, read logs, and reach Postgres and MinIO on the box."
---

# Updating

## Upgrading

This maintained fork keeps Bun, localization, and UI changes on top of upstream
Warpdrive. Check the deployment branch and remotes before updating; an upstream
release number alone does not identify the fork's current code or migration state.

```sh
git status --short
git remote -v
git fetch origin
git log --oneline HEAD..origin/main
```

Back up the database, files, and required runtime secrets, then rehearse the reviewed
release and migrations in an isolated environment. Deploy from a clean checkout of
the intended branch/revision. For a deployment tracking the fork's `main` branch:

```sh
git pull --ff-only origin main
docker compose up -d --build
```

Migrations are applied automatically by the one-shot `migrate` service before the app
restarts, so there is no separate migration step.

## The update banner

Administrators see an in-app banner when a newer release is published on GitHub.

| Variable | Effect |
| --- | --- |
| `APP_VERSION` | The version reported as current. Usually stamped at build from the release tag. Falls back to `package.json`, then to `dev`, which disables the banner. |
| `DISABLE_UPDATE_CHECK` | Set `true` to disable the banner and the GitHub poll entirely. |

`DISABLE_UPDATE_CHECK=true` disables release polling. It does not disable connected
email, enrichment, telemetry, or other integrations; configure those separately.

## Backups

Two volumes hold state, and **both** are needed for a usable restore. A database dump
alone restores records whose attachments are gone.

Database:

```sh
docker compose exec -T postgres pg_dump -U warpdrive warpdrive \
  | gzip > backup-$(date +%F).sql.gz
```

Files live in the `miniodata` volume; back that up alongside the database.

Test a restore before you need one.

Record the source revision, migration journal, restore result, and service checks.
A successful build or migration is not proof that mailbox delivery or other
provider workflows work in the deployed environment. New workflow definitions and
versions are database state; include them in database backups once their migration
has been adopted. The visual executor is still in development.

## Logs

```sh
docker compose logs -f app      # the application
docker compose logs -f worker   # mailbox sync, imports, scheduled sends
docker compose logs -f ws       # realtime
docker compose logs -f caddy    # TLS and routing
```

**`worker` is the one people forget.** Background work (mailbox sync, CSV imports,
scheduled sends) runs only there. An import stuck at "uploaded" or mail that never
arrives is usually a worker that is not running, not an application fault.

## Reaching Postgres

Postgres is deliberately not published to the host in production:

```sh
docker compose exec postgres psql -U warpdrive
```

MinIO's S3 API is reachable through Caddy at `https://s3.<APP_DOMAIN>`, because the
browser needs it for presigned uploads. Its admin console stays internal, so forward a
port temporarily to reach it.

## Health

```sh
curl -fsS https://<APP_DOMAIN>/api/health   # -> {"ok":true}
```

## Related

- [Installation](../setup.md)
- [Architecture](../architecture.md)
