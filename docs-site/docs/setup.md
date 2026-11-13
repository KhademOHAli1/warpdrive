---
sidebar_position: 2
title: Installation
description: "Deploy Warpdrive with Docker Compose, configure secure authentication and mail delivery, and bootstrap the first administrator from the deployment host."
---

# Installation

This guide covers a fresh installation built from a reviewed source revision
using the fork's single-host Docker Compose configuration. The stack includes the
web app, a WebSocket service, a background worker, PostgreSQL, S3-compatible
storage, and Caddy for HTTPS. For an existing installation, follow the
[upgrade guide](./operations/updating.md).

## Prerequisites

Start with a clean checkout of the [maintained fork](https://github.com/KhademOHAli1/warpdrive)
at the exact revision you intend to run. Use the `.env.example`, Compose files, and
migrations from that revision. Review the scope and checksums of any source archive
you download from [GitHub Releases](https://github.com/KhademOHAli1/warpdrive/releases).
Rehearse the setup before using it with customer data.

Before starting Compose, confirm that both storage images (`minio` and
`createbuckets`) are available for your host architecture and pin the versions
you tested. If you use another S3-compatible service, adapt bucket provisioning,
routing, and CORS to that service. The app needs a private bucket and a storage URL
that both the app and the browser can reach.

- A Linux box with Docker and the Compose plugin.
- A domain name with an `A`/`AAAA` record pointing at the box's public IP, for the
  application's HTTPS origin and authentication callbacks.
- **A second `A`/`AAAA` record for an `s3.` subdomain** (for example
  `s3.crm.example.com`), also pointing at the box. The browser uploads files (CSV
  imports, avatars, attachments) directly to MinIO through this hostname, so it needs
  its own DNS record and certificate. Skipping this breaks every upload.
- Ports 80 and 443 reachable for Caddy's HTTPS setup.
- An SMTP service that can deliver invitations, email verification, password resets,
  and security notices. Production requires SMTP; local capture does not send mail.
- Optional Google, Microsoft, or OIDC provider credentials if you want provider
  sign-in. Google credentials are also needed if you enable Gmail integration.

## 1. Configure the environment

```sh
cp .env.example .env
```

Set the values in this section and the authentication settings below. The app
validates its configuration on startup. Docker Compose also reads `.env` when
resolving values in the Compose file.

### Deployment values

| Variable | Value on the box |
| --- | --- |
| `APP_DOMAIN` | `crm.example.com`, the public hostname |
| `ACME_EMAIL` | Contact address for Caddy's ACME account |
| `BASE_URL` | `https://crm.example.com` |
| `NEXT_PUBLIC_WS_URL` | `wss://crm.example.com/_ws` |
| `WS_PUBLIC_URL` | `ws://ws:8080`, the internal Compose address |
| `MINIO_ENDPOINT` | `https://s3.crm.example.com` |
| `POSTGRES_PASSWORD` | Password for the PostgreSQL owner account. With an existing volume, use its current password. |
| `MIGRATION_DATABASE_URL` | Owner connection for the one-shot migrator, for example `postgres://warpdrive:<owner-password>@postgres:5432/warpdrive` |
| `DATABASE_URL` | Separate runtime login without schema ownership, for example `postgres://warpdrive_runtime:<runtime-password>@postgres:5432/warpdrive` |
| `SEED_ADMIN_EMAIL` | Intended first administrator's exact email, required in production |
| `ALLOW_FIRST_LOGIN_ADMIN` | Keep `false`; first sign-in does not create an administrator |

- Set **`MINIO_ENDPOINT`** to the exact browser-facing URL used to sign uploads and
  downloads. In this Compose setup, Caddy proxies `https://s3.crm.example.com`
  to MinIO. MinIO allows cross-origin requests from `BASE_URL`.
- Set **`NEXT_PUBLIC_WS_URL`** before building the source image. The build embeds
  it in the browser bundle. If the value changes, rebuild the image before testing
  realtime updates.
- Set **`SEED_ADMIN_EMAIL`** to the first administrator's email. The host-side
  bootstrap command below queues the invitation.

### Business values

| Variable | Meaning |
| --- | --- |
| `BASE_CURRENCY` | Default currency, `USD` if unset. Records may use other currencies. |
| `MAX_FILE_BYTES` | Upload size ceiling. Defaults to `26214400` (25 MiB). |
| `APP_VERSION` | Version shown as "current" by the update banner. |
| `DISABLE_UPDATE_CHECK` | Set `true` to disable the update banner and its GitHub poll. |
| `MCP_ENABLED` | Defaults to `true` and requires `OAUTH_SIGNING_KEY`. Set `false` if you do not need the MCP and OAuth endpoints. |

### Generate the secrets

```sh
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY (32-byte base64 key)
openssl rand -base64 32   # OAUTH_SIGNING_KEY (separate 32-byte base64 key when MCP is enabled)
openssl rand -hex 32      # AUTH_SECRET (dedicated authentication secret)
openssl rand -hex 32      # WS_TICKET_SECRET (>= 32 chars)
openssl rand -hex 32      # PostgreSQL owner password
openssl rand -hex 32      # PostgreSQL runtime password
openssl rand -hex 16      # MINIO_ACCESS_KEY
openssl rand -hex 16      # MINIO_SECRET_KEY
```

`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `WS_TICKET_SECRET`, `AUTH_SECRET`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `AUTH_MICROSOFT_CLIENT_SECRET`, `AUTH_SMTP_PASSWORD`,
`AUTH_OIDC_PROVIDERS`, `OAUTH_SIGNING_KEY`, and `MINIO_SECRET_KEY` may each instead be
supplied as `<VAR>_FILE` pointing at a file path, for use with Docker secrets. The app
reads the file contents at boot. Mount the migration owner secret only in the
migration service. Keep encryption and signing keys stable across ordinary upgrades
and share the required runtime secrets and `BASE_URL` with the app, worker, and
administrator bootstrap process. Compose still needs the interpolation values it uses
for the PostgreSQL and storage containers.

<span id="2-set-up-google-oauth" />

## 2. Configure authentication and email

Warpdrive uses Better Auth with invitation-only onboarding. Email/password sign-in
and passkeys are enabled by default. Google, Microsoft, and configured OIDC providers
are optional. Keep password sign-in enabled for the initial invitation unless you
have configured a working provider; passkeys are enrolled after joining.

### Authentication and SMTP values

| Variable | Meaning |
| --- | --- |
| `AUTH_SECRET` | Dedicated random secret of at least 32 characters; required in production |
| `AUTH_ALLOW_PASSWORD` | Enables email/password sign-in; defaults to `true` |
| `AUTH_ALLOW_PASSKEY` | Enables passkey enrollment and sign-in; defaults to `true` |
| `AUTH_MAIL_TRANSPORT` | Set `smtp` in production; `capture` is for local development |
| `AUTH_MAIL_FROM` | Sender email address accepted by your SMTP service |
| `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT` | SMTP host and port, commonly port `587` |
| `AUTH_SMTP_SECURE` | Use `false` for STARTTLS, commonly port `587`, or `true` for implicit TLS, commonly port `465`. |
| `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD` | SMTP credentials when required by the service |
| `AUTH_TRUSTED_PROXY_HEADER` | Defaults to `none` for direct/local runs; production Compose sets `x-real-ip` because Caddy overwrites that header with the TCP peer address |

The worker checks the encrypted authentication outbox every minute. If an invitation
doesn't arrive, check SMTP and the worker. An administrator can check delivery
status in Security administration after signing in.
Password joins require mailbox verification before application access. Administrators
must also enroll and verify a strong factor, using an authenticator or a passkey.

### Optional identity providers

Register exact callback URLs using your public `BASE_URL`:

| Provider | Configuration | Registered callback |
| --- | --- | --- |
| Google sign-in | `AUTH_GOOGLE_ENABLED=true` plus `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` | `https://crm.example.com/api/auth/callback/google` |
| Microsoft sign-in | `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET`, and `AUTH_MICROSOFT_TENANT` | `https://crm.example.com/api/auth/callback/microsoft` |
| OIDC sign-in | `AUTH_OIDC_PROVIDERS`, a JSON array of objects with `name`, `issuer`, `clientId`, and `clientSecret` | `https://crm.example.com/api/auth/callback/<provider-id>` |

For a single-tenant Microsoft deployment, configure your specific Entra tenant ID.
OIDC requires an exact HTTPS issuer with discovery metadata. Its provider ID is
`oidc-` followed by the first 16 hexadecimal characters of the SHA-256 hash of the
issuer with its trailing slash removed. Use that ID in the registered callback.
Native sign-in no longer uses the legacy `/auth/callback` URL.

Every new account requires a valid, single-use invitation for its exact email
address. To restrict Google sign-in to a Workspace domain, set
`GOOGLE_WORKSPACE_DOMAIN` to that domain. The Google provider checks the verified
hosted-domain claim. Leave it blank if you intend to invite Google accounts from
different domains.

### Gmail connection is separate from sign-in

Google sign-in does not connect a mailbox, and Gmail consent does not grant CRM
access. Gmail uses the Google client credentials and its separate callback:
`https://crm.example.com/api/gmail/oauth/callback`. Register that URL too if you want
mailbox integration. You can set `AUTH_GOOGLE_ENABLED=false` while retaining Google
credentials for Gmail.

Mailbox consent needs the `openid` and `email` scopes as well as the Gmail scopes,
because the callback verifies the returned mailbox identity.

See [Email sync](./administration/email-sync.md) for connecting mailboxes once the
app is running.

## 3. Bring it up

On a fresh database, start PostgreSQL and apply the schema with the migration owner.
After this command succeeds, open a PostgreSQL session as the owner:

```sh
docker compose config --quiet
docker compose up -d postgres
docker compose run --rm --build migrate
docker compose exec postgres psql -U warpdrive -d warpdrive
```

Use the default database and role names shown here or substitute your configured
names. Create the runtime login and enter its password at the `\password` prompt.
The table, sequence, and function grants cover both the existing schema and future
objects created by this migration owner.

```sql
CREATE ROLE warpdrive_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
\password warpdrive_runtime
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public, pgboss TO warpdrive_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, pgboss TO warpdrive_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, pgboss TO warpdrive_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, pgboss TO warpdrive_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO warpdrive_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO warpdrive_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, pgboss
  GRANT EXECUTE ON FUNCTIONS TO warpdrive_runtime;
\q
```

Use the runtime login in `DATABASE_URL`. Start the stack after the grants are in place:

```sh
docker compose up -d --build
```

Compose waits for PostgreSQL and a successful `migrate` run before starting
`app`, `ws`, and `worker`. The app also waits for `createbuckets` to provision
the private bucket. Caddy starts after the app passes its health check and the
WebSocket service starts.

Check service status and the public health endpoint. Substitute your hostname:

```sh
docker compose ps
curl -fsS https://crm.example.com/api/health
```

Expect `{"ok":true}` when the web process can reach PostgreSQL. Verify invitation
delivery, a test upload and download, and browser realtime separately.

<span id="4-first-admin-login" />

## 4. Bootstrap the first administrator

After migrations finish, verify the worker is running and SMTP is configured. On
the deployment host, use the app container's validated environment:

```sh
docker compose exec app bun dist/auth-operator.mjs bootstrap \
  --email owner@example.com --name "Workspace owner" --locale fa --confirm
```

The address must match `SEED_ADMIN_EMAIL`. Use `--locale de` or `--locale en` for
German or English. The command creates the initial defaults and administrator
placeholder, then queues the normal 72-hour invitation. It does not create a
password or a usable session. It refuses an initialized workspace or an existing
user, and cannot be used to promote or relink an account.

Open the delivered invitation, join using the invited address, complete verification,
and enroll the required administrator factor. Keep recovery codes securely when
they are shown. The bootstrap invitation is single-use; an ordinary visitor cannot
elect themselves administrator.

If the original administrator has not claimed the account and the invitation
expires, renew it from the host:

```sh
docker compose exec app bun dist/auth-operator.mjs resend-bootstrap \
  --email owner@example.com --confirm
```

This only replaces the original unclaimed first-administrator invitation. It
invalidates old links, retains the account's UUID and preferences, and does not
reopen bootstrap. Repair delivery before retrying; retrying an expired email alone
does not extend the link's lifetime.

From there, invite the rest of your team from
[Users and teams](./administration/users-and-teams.md).
See the [authentication operator runbook](https://github.com/KhademOHAli1/warpdrive/blob/main/docs/auth-operations.md)
for bootstrap restrictions and approved recovery procedures.

## Local development

For a host-run development app, start only the backing services with the development
override. Use a dedicated database and restrict access to the published development
ports on your host:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres minio createbuckets
```

Check the bucket provisioner exits successfully. In the host app's environment,
use PostgreSQL on `localhost:5433`, `MINIO_ENDPOINT=http://localhost:9000`,
`BASE_URL=http://localhost:3000`, and `WS_PUBLIC_URL` and `NEXT_PUBLIC_WS_URL`
both set to `ws://localhost:8080`. Use `WS_HOST=127.0.0.1` for the host-run WebSocket
process. Follow [Contributing](./contributing.md#running-locally) to migrate the
database, grant runtime access, and start the app.

Use `AUTH_MAIL_TRANSPORT=capture` only for development: it records a local delivery
result without sending email. The source-checkout operator entry point is
`bun run auth:operator`, with the same arguments as the packaged command above.
Provider callbacks must match the local origin if you enable provider sign-in.

## Operating the deployment

See [Updating](./operations/updating.md) for upgrades, backups, and day-to-day
operation. If upgrading across the Better Auth cutover, review the migration and
recovery sections of the [authentication operator runbook](https://github.com/KhademOHAli1/warpdrive/blob/main/docs/auth-operations.md).
Existing users sign in again and MCP clients request fresh authorization after
that migration. Keep a restorable database backup before applying it.
