# Campaigns in Warpdrive

Campaigns uses Warpdrive sessions, administrator authority, CSRF protection, navigation, locale, and audit records. The server calls one internal Listmonk engine per Warpdrive installation. The engine owns campaign scheduling and SMTP delivery, list membership, consent state, bounce handling, and templates. It uses a dedicated database and role on the Warpdrive PostgreSQL service. Warpdrive's pg-boss workers continue to run CRM work.

The deployment pins Listmonk [v6.2.0](https://github.com/knadh/listmonk/releases/tag/v6.2.0) and its published multi-platform image digest. Listmonk is distributed under its [AGPLv3 license](https://github.com/knadh/listmonk/blob/v6.2.0/LICENSE). The upstream [source for this version](https://github.com/knadh/listmonk/tree/v6.2.0) and [API contract](https://listmonk.app/docs/apis/apis/) are available separately.

## Installation

1. On the PostgreSQL service, use a database administrator to create the dedicated role and database. Use a unique generated password. In a fresh installation, the SQL below and the interactive password prompt are sufficient. An existing installation keeps its current role, password and database until a planned rotation.

   ```sql
   CREATE ROLE warpdrive_newsletters LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   \password warpdrive_newsletters
   CREATE DATABASE warpdrive_newsletters OWNER warpdrive_newsletters;
   REVOKE CONNECT ON DATABASE warpdrive_newsletters FROM PUBLIC;
   ```

2. Put `NEWSLETTER_POSTGRES_PASSWORD` in a private, Git-ignored `.env.newsletters` file for Compose interpolation. Set `NEWSLETTER_PUBLIC_DOMAIN` there to a dedicated subscriber-facing host and add its DNS record. Keep engine credentials in this separate file so only the intended Compose service receives each value. Use a separate hostname from the CRM and its S3 service.
3. Start the internal engine with the optional overlay. The engine installs and upgrades its own schema. Back up the newsletter database and media volume before upgrades.

   ```sh
   docker compose --env-file .env --env-file .env.newsletters \
     -f docker-compose.yml -f docker-compose.newsletters.yml up -d newsletter-engine
   ```

4. Bootstrap the engine admin with `NEWSLETTER_BOOTSTRAP_USER` and `NEWSLETTER_BOOTSTRAP_PASSWORD` during initial installation, or use the upstream setup screen on a private operator tunnel. Use a temporary loopback-only mapping to reach the upstream UI during setup. Then remove the mapping and bootstrap variables.
5. In Listmonk create an API user with a dedicated user role. Give it the permissions listed below. Set `NEWSLETTER_API_USER` and `NEWSLETTER_API_TOKEN` in the private Compose interpolation file. For a mounted token, add an app-only Compose override with a secret mount and `NEWSLETTER_API_TOKEN_FILE`. The overlay sets the engine origin for the app. A native development process can use the existing loopback engine origin.
6. Set Listmonk's **Root URL** to the dedicated HTTPS subscriber origin, and configure an approved campaign SMTP relay. Disable the legacy public self-export and wipe controls. Verify public form protection and use double opt-in for public audiences. Set `NEWSLETTER_PUBLIC_SIGNUP_ENABLED=true` only when the public form is ready. The default filesystem media backend serves stable `/uploads/` URLs from the persistent newsletter volume. For S3, use a dedicated campaign asset bucket or prefix and verify its public read policy and URL; the CRM attachment bucket is private.
7. Start Warpdrive with both Compose files and both environment files. Sign in with Warpdrive and open **Actions → Campaigns**. Confirm permissions, subscription and unsubscribe links, and Mailpit delivery in development before setting `NEWSLETTER_DELIVERY_ENABLED=true` on a live installation.

When attaching an existing Listmonk database, review subscribers with legacy global `disabled` status. Listmonk 6.2 excludes global `blocklisted` recipients during campaign selection. Use the existing records to reconcile intended suppression into blocklisting before enabling live delivery. The native form creates enabled or blocklisted subscribers and preserves legacy values during profile edits. Review current campaigns and pending schedules before attaching a populated database.

Engine role grants for the native workspace:

| Area | Grants |
| --- | --- |
| Campaigns | `campaigns:get_all`, `campaigns:manage_all`, `campaigns:get_analytics`, `campaigns:send` |
| Lists | `lists:get_all`, `lists:manage_all` |
| Subscribers | `subscribers:get_all`, `subscribers:manage`, `subscribers:import` |
| Bounces | `bounces:get`, `bounces:manage` |
| Media | `media:get`, `media:manage` |
| Templates | `templates:get`, `templates:manage` |
| Engine configuration | `settings:get`, `settings:manage`, `settings:maintain` |

The native adapter accepts fixed operations and literal subscriber searches. The upstream token omits `subscribers:sql_query`, transactional mail, user administration and role administration. Listmonk still exposes some search-based bulk endpoints to `subscribers:manage`, so keep the engine API and token private. Private engine access is required to configure its relays and provider credentials. Set up provider bounce ingestion on a separately verified endpoint for the selected provider. The public site exposes subscription, confirmation, preference and tracking routes, archives, and media. The engine admin UI and administrative API remain on the private network. With the delivery flag off, the Compose engine starts in passive mode. Turning delivery on recreates the engine with its scheduler active. Review pending schedules before that change. Recipient unsubscribe links remain available in either mode. The public proxy serves Listmonk’s protected form when signup and delivery are enabled. The raw JSON signup endpoint stays private.

## Settings ownership

| Listmonk area | Warpdrive surface and engine responsibility |
| --- | --- |
| General | Company and Branding own the CRM name and assets. Regional settings own staff locale and time zone. Campaign settings own the mailing sender, public subscription and archive behavior. The operator sets the subscriber origin. |
| Performance | Campaign settings control sender concurrency, message and batch limits, and related delivery settings. The Listmonk scheduler uses these limits. |
| Privacy | Warpdrive Privacy owns CRM requests. Campaign settings own campaign tracking, confirmation and unsubscribe policy. Audience operations preserve the engine's suppression and list-level unsubscribe state. Use blocklisting to remove a subscriber from delivery. Permanent subscriber erasure needs a separate procedure that preserves suppression during concurrent unsubscribe and bounce processing. |
| Security | Warpdrive sign-in, MFA and workspace roles govern the native UI. The engine has a dedicated service identity. The subscriber origin owns public-form protections and trusted origins. |
| Media | The Campaigns media library uses durable engine URLs. Warpdrive Files still serves CRM attachments. |
| SMTP | Campaign SMTP has separate sender identity, relay, TLS and retry settings from CRM authentication and personal mailbox connections. Relay endpoints and credentials are operator-managed. |
| Bounces | Campaigns shows the engine's bounce records. The engine applies bounce thresholds and suppression settings to the campaign audience. Provider webhook credentials are operator-managed. |
| Messengers | The campaign engine owns custom postback messenger configuration. The operator controls destinations and credentials. |
| Appearance | Warpdrive Appearance and Branding control authenticated screens. Subscriber pages have a separate public visual identity at the subscriber origin. |
| Maintenance | Settings contains engine health, date-filtered cleanup of unconfirmed subscriptions, views and clicks, and analytics CSV export without subscriber identifiers. PostgreSQL administration owns database maintenance. |
| Logs | Settings shows structured workspace and campaign events from Warpdrive's audit store. The last 90 days are available with source and outcome filters. Campaign changes have a correlation ID and outcome. Provider process logs stay with the engine operator. |

Every native write has a Warpdrive actor and audit correlation ID. When an engine response is lost, the outcome can be unknown. Refresh the campaign, subscriber, import or settings state before repeating that action. A transport retry does not start another write.
