---
sidebar_position: 2
title: Installation
description: "Deploy Warpdrive with Docker Compose, configure secure authentication and mail delivery, and bootstrap the first administrator from the deployment host."
---

# Installation

Warpdrive ships as a self-contained Docker Compose stack: the Next.js app, a
WebSocket server, a background worker, Postgres, MinIO object storage, and a Caddy
reverse proxy that terminates TLS with automatic Let's Encrypt certificates. One
`docker compose up -d --build` brings up the whole thing.

## Prerequisites

Use the maintained fork's current `.env.example`, package manifests, and migration
journal as the configuration source. Bun is the declared application runtime and
package manager; local development needs the version in `package.json`.

The inherited Compose storage image references require operator review before a
fresh installation. The root README records the known MinIO image availability
limitation; an S3-compatible deployment needs valid image/service configuration,
credentials, bucket provisioning, and browser-reachable upload URLs.

- A Linux box with Docker and the Compose plugin.
- A domain name with an `A`/`AAAA` record pointing at the box's public IP, for the
  application's HTTPS origin and authentication callbacks.
- **A second `A`/`AAAA` record for an `s3.` subdomain** (for example
  `s3.crm.example.com`), also pointing at the box. The browser uploads files (CSV
  imports, avatars, attachments) directly to MinIO through this hostname, so it needs
  its own DNS record and certificate. Skipping this breaks every upload.
- Ports 80 and 443 open. Caddy needs port 80 for the ACME challenge.
- An SMTP service that can deliver invitations, email verification, password resets,
  and security notices. Production requires SMTP; local capture does not send mail.
- Optional Google, Microsoft, or OIDC provider credentials if you want provider
  sign-in. Google credentials are also needed if you enable Gmail integration.

## 1. Configure the environment

```sh
cp .env.example .env
```

Warpdrive reads `process.env` in exactly one module, which validates every variable
with a schema and throws at import time. A misconfigured deployment fails loudly at
boot rather than misbehaving hours later.

### Deployment values

| Variable | Value on the box |
| --- | --- |
| `APP_DOMAIN` | `crm.example.com`, the public hostname |
| `ACME_EMAIL` | an address for Let's Encrypt expiry notices |
| `BASE_URL` | `https://crm.example.com` |
| `NEXT_PUBLIC_WS_URL` | `wss://crm.example.com/_ws` |
| `WS_PUBLIC_URL` | `ws://ws:8080`, the internal Compose address |
| `MINIO_ENDPOINT` | `https://s3.crm.example.com` |
| `DATABASE_URL` | `postgres://warpdrive:warpdrive@postgres:5432/warpdrive` |
| `SEED_ADMIN_EMAIL` | Intended first administrator's exact email, required in production |
| `ALLOW_FIRST_LOGIN_ADMIN` | Keep `false`; first sign-in does not create an administrator |

Three of these cause silent, confusing failures when set wrongly, so they are worth
stating plainly:

- **`MINIO_ENDPOINT` must be the public `https://s3.<domain>` URL**, not the internal
  `minio` Compose alias. The browser POSTs presigned uploads directly to this address,
  so an internal hostname is unreachable from where it actually gets used. Every
  upload fails if this is wrong.
- **`NEXT_PUBLIC_WS_URL` must be set at build time.** `NEXT_PUBLIC_*` variables are
  inlined into the client bundle when the image is built, not read at runtime. If it
  is missing, the app still starts and looks healthy, but the board, inbox,
  notifications, and presence indicators silently never update.
- **Bootstrap runs explicitly on the deployment host.** `SEED_ADMIN_EMAIL` identifies
  its intended recipient; setting it does not create an account or promote a visitor.
  The environment boundary rejects `ALLOW_FIRST_LOGIN_ADMIN=true` in production.

### Business values

| Variable | Meaning |
| --- | --- |
| `BASE_CURRENCY` | Currency deal values are recorded in. Defaults to `USD`. |
| `MAX_FILE_BYTES` | Upload size ceiling. Defaults to `26214400` (25 MiB). |
| `APP_VERSION` | Version shown as "current" by the update banner. |
| `DISABLE_UPDATE_CHECK` | Set `true` to disable the update banner and its GitHub poll. |

### Generate the secrets

```sh
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY (32-byte base64 key)
openssl rand -hex 32      # AUTH_SECRET (dedicated authentication secret)
openssl rand -hex 32      # WS_TICKET_SECRET (>= 32 chars)
openssl rand -hex 16      # MINIO_ACCESS_KEY / MINIO_SECRET_KEY
```

`DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `WS_TICKET_SECRET`, `AUTH_SECRET`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `AUTH_MICROSOFT_CLIENT_SECRET`, `AUTH_SMTP_PASSWORD`,
`AUTH_OIDC_PROVIDERS`, `OAUTH_SIGNING_KEY`, and `MINIO_SECRET_KEY` may each instead be
supplied as `<VAR>_FILE` pointing at a file path, for use with Docker secrets. The app
reads the file contents at boot. Keep the encryption key stable across upgrades, and
give the app, worker, and operator process the same secrets and `BASE_URL`.

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
| `AUTH_SMTP_SECURE` | `false` uses STARTTLS, required in production; `true` uses implicit TLS, commonly port `465` |
| `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD` | SMTP credentials when required by the service |
| `AUTH_TRUSTED_PROXY_HEADER` | Defaults to `none`; select a header only when trusted ingress strips or replaces client-supplied values |

The regular worker delivers the encrypted authentication outbox every minute.
Queueing a message is not proof of delivery. Check SMTP and worker health, then
review delivery status in Security administration once an administrator can sign in.
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
address. A matching Workspace domain does not authorize a join.
`GOOGLE_WORKSPACE_DOMAIN` is a legacy setting, not a domain restriction for native
authentication; apply any tenant restrictions in your identity provider as well.

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

```sh
docker compose up -d --build
```

Startup order is handled for you. Postgres becomes healthy, a one-shot `migrate`
service applies the schema and `createbuckets` provisions the MinIO bucket, then
`app`, `ws`, and `worker` start. Caddy waits for the app to report healthy, then
fetches a TLS certificate on the first request to `https://<APP_DOMAIN>`.

Check it:

```sh
docker compose ps
curl -fsS https://<APP_DOMAIN>/api/health   # -> {"ok":true}
```

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

The base Compose file is production-only: no host ports, TLS through Caddy. For a
local run, merge the development overrides, which expose host ports and drop Caddy:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The app is then at `http://localhost:3000`, the MinIO console at
`http://localhost:9001`, and Postgres at `localhost:5433`. Set
`BASE_URL=http://localhost:3000` and `NEXT_PUBLIC_WS_URL=ws://localhost:8080` for this
mode.

Use `AUTH_MAIL_TRANSPORT=capture` only for development: it records a local delivery
result without sending email. The source-checkout operator entry point is
`bun run auth:operator`, with the same arguments as the packaged command above.
Provider callbacks must match the local origin if you enable provider sign-in.

## Operating the deployment

See [Updating](./operations/updating.md) for upgrades, backups, and day-to-day
operation. Authentication cutover invalidates old application sessions and MCP
grants; existing users sign in again and MCP clients request fresh authorization.
The migration preserves CRM user UUIDs and existing Google subjects. Keep a
restorable database backup before applying it.
