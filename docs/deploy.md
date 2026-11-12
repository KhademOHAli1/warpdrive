# Deploying warpdrive to a single box

warpdrive ships as a self-contained Docker Compose stack: the Next.js app, a WebSocket server, a
background worker, Postgres, MinIO object storage, and a Caddy reverse proxy that terminates TLS
with automatic Let's Encrypt certificates. One `docker compose up -d --build` brings up the whole
thing. Design: `docs/superpowers/specs/2026-07-07-docker-single-box-deploy-design.md`.

## Prerequisites

- A Linux box with Docker and the Compose plugin.
- A domain name with an `A`/`AAAA` record pointing at the box's public IP (needed for TLS and
  because Google OAuth will not redirect to a bare IP).
- A second `A`/`AAAA` record for the `s3.` subdomain (e.g. `s3.crm.example.com`) also pointing at the
  box. The browser uploads files (CSV import, avatars, attachments) directly to MinIO through this
  host, so it needs its own hostname, cert, and `MINIO_ENDPOINT` value.
- Ports 80 and 443 open to the internet (Caddy needs 80 for the ACME challenge).
- Working SMTP delivery for invitations, verification, recovery and security notices.
- Optional Google, Microsoft or OIDC credentials for federated sign-in. Google mailbox consent
  remains separate, at `https://<your-domain>/api/gmail/oauth/callback`.

## 1. Configure `.env`

```sh
cp .env.example .env
```

Fill it in. The deployment-specific values:

| Var                       | Value on the box                                                            |
| ------------------------- | --------------------------------------------------------------------------- |
| `APP_DOMAIN`              | `crm.example.com` (the public hostname)                                     |
| `ACME_EMAIL`              | an address for Let's Encrypt expiry notices                                 |
| `BASE_URL`                | `https://crm.example.com`                                                   |
| `NEXT_PUBLIC_WS_URL`      | `wss://crm.example.com/_ws`                                                 |
| `WS_PUBLIC_URL`           | `ws://ws:8080` (internal compose address)                                   |
| `MINIO_ENDPOINT`          | `https://s3.crm.example.com` (public: the browser uploads directly here)    |
| `POSTGRES_PASSWORD`       | a unique generated password for a new database volume                       |
| `MIGRATION_DATABASE_URL`  | `postgres://warpdrive:<owner-password>@postgres:5432/warpdrive`             |
| `DATABASE_URL`            | `postgres://warpdrive_runtime:<runtime-password>@postgres:5432/warpdrive`   |
| `SEED_ADMIN_EMAIL`        | the first admin's email (required in production)                            |
| `ALLOW_FIRST_LOGIN_ADMIN` | `false` (the env boundary rejects `true` in production)                     |
| `AUTH_SECRET`             | a dedicated random secret of at least 32 characters, stable across restarts |
| `AUTH_MAIL_TRANSPORT`     | `smtp` in production                                                        |
| `AUTH_MAIL_FROM`          | your verified sender address                                                |
| `AUTH_SMTP_HOST`          | your SMTP relay hostname, with port/TLS/user/password configured as needed  |

Generate the secrets:

```sh
# 32-byte base64 key for token encryption
openssl rand -base64 32          # -> TOKEN_ENCRYPTION_KEY
# a long random string (>= 32 chars) for WS tickets
openssl rand -hex 32             # -> WS_TICKET_SECRET
# a separate random secret for Better Auth
openssl rand -hex 32             # -> AUTH_SECRET
# independent owner and runtime passwords; hex needs no URL escaping
openssl rand -hex 32             # -> POSTGRES_PASSWORD and MIGRATION_DATABASE_URL password
openssl rand -hex 32             # -> DATABASE_URL runtime password
# MinIO credentials
openssl rand -hex 16             # -> MINIO_ACCESS_KEY / MINIO_SECRET_KEY
```

Hardening: any of `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `WS_TICKET_SECRET`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `MINIO_SECRET_KEY`, `AUTH_SECRET`, `AUTH_SMTP_PASSWORD`,
`AUTH_MICROSOFT_CLIENT_SECRET` and `AUTH_OIDC_PROVIDERS` may instead be supplied as `<VAR>_FILE` pointing
at a file path (Docker secret), and the app reads the file contents at boot.

## 2. Bring it up

On a fresh database, prepare the explicit app/queue schema before creating the runtime
role. The one-shot migrator requires `MIGRATION_DATABASE_URL`; it never falls back to
`DATABASE_URL` or ambient PostgreSQL credentials. These commands are the source checkout
path; reviewed image-only shipping uses [the deployment redesign](deployment-redesign.md).

```sh
docker compose up -d postgres
docker compose run --rm --build migrate
docker compose exec postgres psql -U warpdrive -d warpdrive
```

In that owner session, for the default database/user names, create the separate login and
enter its independently generated password at the `\password` prompt. If the role already
exists, inspect its ownership and grants before changing it; do not rerun `CREATE ROLE` or
rotate credentials as a recovery action. Use the actual migration owner for these grants.

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

Then start the runtime tier:

```sh
docker compose up -d --build
```

On subsequent starts, Postgres becomes healthy, `migrate` verifies/applies app and queue schema and
`createbuckets` provisions the MinIO bucket, then `app`, `ws`, and `worker` start. Caddy waits for
the app to report healthy, then fetches the TLS cert on first request to `https://<APP_DOMAIN>`.
Runtime services clear migration URLs and PostgreSQL owner passwords from the shared environment;
mount an owner secret only into the one-shot service. Runtime queue startup rejects missing,
unfinished or incompatible schema instead of installing it. Supported populated upgrades,
offline writer fencing and installed role provisioning still require their own release evidence.

Check status:

```sh
docker compose ps
curl -fsS https://<APP_DOMAIN>/api/health   # -> {"ok":true}
```

## 3. First admin login

Use the host-only bootstrap command to queue the initial invitation to `SEED_ADMIN_EMAIL`:

```sh
docker compose exec app bun dist/auth-operator.mjs bootstrap --email owner@example.com --name "Workspace owner" --locale fa --confirm
```

The command refuses an established workspace and never creates a password or an authenticated
session. Complete invitation acceptance, email verification and mandatory strong authentication
through the normal UI. `ALLOW_FIRST_LOGIN_ADMIN` stays `false` in production. The
[operator runbook](auth-operations.md) documents recovery, delivery and emergency handling.
Before upgrading an existing installation, follow the
[authentication migration report](auth-implementation-report.md).

## Operating the box

- **Update to a new version:** build the reviewed release images, then use the
  [authentication migration cutover](../src/features/activities/providers/google/authorizationREADME.md#connection-generation-migration)
  for releases that change Calendar authorization state. Compose's one-shot migration
  dependency gates cold startup; it does not itself stop old application processes
  before an upgrade migration runs. The connection-generation migration requires the
  stopped-service sequence below that link, rather than an overlapping restart.
- **Logs:** `docker compose logs -f app` (or `ws` / `worker` / `caddy`).
- **Backups:** the database lives in the `pgdata` volume. Take a dump on a schedule, e.g.
  `docker compose exec -T postgres pg_dump -U warpdrive warpdrive | gzip > backup-$(date +%F).sql.gz`.
  Uploaded files live in the `miniodata` volume; back that up too.
- **Reaching Postgres:** it is intentionally not published to the host in production. Use
  `docker compose exec postgres psql -U warpdrive`. MinIO's S3 API is reachable through Caddy at
  `https://s3.<APP_DOMAIN>` (the browser needs it for presigned uploads); its admin console stays
  internal, so temporarily forward a port to reach that.

## What protects the public surface

Everything below is on by default. It is written down because most of it is invisible until it
is missing, and because two items are load-bearing assumptions rather than settings.

- **Response headers.** `next.config.ts` sets `Content-Security-Policy: frame-ancestors 'none'`
  (plus `base-uri`, `form-action`, `object-src`), `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` and `Permissions-Policy` on every route; Caddy adds HSTS, since only the TLS
  terminator knows the response really went out over HTTPS. Refusing to be framed is what stops
  the OAuth consent screen from being clickjacked into granting an attacker's client full CRM
  access. `script-src` is deliberately not set: it needs nonce injection from middleware, which
  this app does not have.
- **Rate limits.** The unauthenticated endpoints (`/oauth/register`, `/oauth/token`,
  `/auth/start`, `/api/health`, and the email tracking pixel and click redirect) are capped per
  client address; see `src/constants/rateLimits.ts`. The tracking endpoints never fail a request
  when over the limit, they only skip the recording, so a real recipient's click still reaches
  the real destination.
- **Native-auth client identity.** The production Caddy vhost overwrites `X-Real-IP` with its
  actual TCP peer address, and Compose sets `AUTH_TRUSTED_PROXY_HEADER=x-real-ip` only for the app
  behind that proxy. This keeps one client's auth attempts from consuming every user's allowance.
  The local/dev Compose override resets the setting to `none` because it exposes the app port
  directly, where a caller could forge that header. If a CDN or another proxy is placed before
  Caddy, configure trusted proxy handling for that specific ingress before relying on per-client
  identity; otherwise Caddy sees the proxy as one peer.
- **This depends on Caddy being the only way in.** The limiter identifies a caller from the last
  `X-Forwarded-For` entry, which is trustworthy only because Caddy appends the true peer address
  to whatever the client sent. Publish a host port for `app` and that header becomes entirely
  caller-written, at which point every request can claim a fresh identity and the limits enforce
  nothing. Keep Caddy as the sole public listener.
- **WebSocket bounds.** A socket that connects without authenticating is closed after 10s, frames
  are capped at 64 KB, and total connections at 1000 (`src/constants/wsLimits.ts`).
- **Postgres credentials.** Compose requires `POSTGRES_PASSWORD`; there is no password fallback.
  Set a unique value before the first start and use that value only in `MIGRATION_DATABASE_URL`. Postgres
  applies this setting only when it initializes a new `pgdata` volume. For an existing volume,
  first set `POSTGRES_PASSWORD` to the database's _current_ password before upgrading. Changing
  the environment variable alone does not rotate the database role. To rotate a historical
  default, change the role password in PostgreSQL, then update `POSTGRES_PASSWORD` and
  `MIGRATION_DATABASE_URL` together before rerunning migration. Rotate the separate runtime
  role and `DATABASE_URL` together when needed. Keep Postgres off host
  ports in production.
- **MCP client registration.** Open by default so MCP clients can self-onboard. See
  [mcp-server.md](mcp-server.md) for why you may want `OAUTH_REGISTRATION=disabled` once your
  clients are connected.

### One-time effect when upgrading past the session-hashing change

Session cookies are now stored as a sha256 digest rather than in the clear, which means existing
session rows cannot be carried forward (the pre-image is by construction unrecoverable). The
migration deletes them. Users sign in again with a configured authentication method.

The Better Auth cutover also revokes pre-cutover sessions and MCP grants. Existing CRM UUIDs,
permissions and preferences are retained. Administrators finish strong authentication before
receiving application access; MCP clients obtain fresh consent. Old verification links require
a new message. Follow the [migration report](auth-implementation-report.md) and
[operator runbook](auth-operations.md) when planning this upgrade.

## Local development against this stack

The base compose file is production-only (no host ports, TLS via Caddy). For a local run, merge the
dev overrides (which expose host ports and drop Caddy):

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Then the app is at `http://localhost:3000`, MinIO console at `http://localhost:9001`, and Postgres
at `localhost:5433`. Set `BASE_URL=http://localhost:3000` and `NEXT_PUBLIC_WS_URL=ws://localhost:8080`
in `.env` for this mode.
