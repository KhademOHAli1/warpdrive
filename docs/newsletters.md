# Campaigns in Warpdrive

Campaigns uses Warpdrive sessions, permission sets, CSRF protection, navigation, locale, and audit records. The server calls one internal Listmonk engine per Warpdrive installation. The engine owns campaign scheduling and SMTP delivery, list membership, consent state, bounce handling, and templates. It uses a dedicated database and role on the Warpdrive PostgreSQL service. Warpdrive's existing worker reconciles identity and consent events and runs newsletter Workflow actions.

The deployment builds the [derived newsletter engine](../deploy/newsletters/engine/README.md) from pinned Listmonk [v6.2.0](https://github.com/knadh/listmonk/releases/tag/v6.2.0). The derived engine requires an explicit form submission to confirm opt-in. It preserves suppression, rejects double opt-in downgrades, and checks reviewed campaign revisions at the point of change. Warpdrive verifies the installed engine capabilities before writing. Listmonk is distributed under its [AGPLv3 license](https://github.com/knadh/listmonk/blob/v6.2.0/LICENSE). The upstream [source for this version](https://github.com/knadh/listmonk/tree/v6.2.0) and [API contract](https://listmonk.app/docs/apis/apis/) are available separately.

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
     -f docker-compose.yml -f docker-compose.newsletters.yml up -d --build newsletter-engine
   ```

4. Bootstrap the engine admin with `NEWSLETTER_BOOTSTRAP_USER` and `NEWSLETTER_BOOTSTRAP_PASSWORD` during initial installation, or use the upstream setup screen on a private operator tunnel. Use a temporary loopback-only mapping to reach the upstream UI during setup. Then remove the mapping and bootstrap variables.
5. In Listmonk create an API user with a dedicated user role. Give it the permissions listed below. Set `NEWSLETTER_API_USER` and `NEWSLETTER_API_TOKEN` in the private Compose interpolation file. For a mounted token, mount it in the app and worker services and set `NEWSLETTER_API_TOKEN_FILE` for each. The overlay sets the private engine origin for both services. A native development process can use the existing loopback engine origin.
6. Set Listmonk's **Root URL** to the dedicated HTTPS subscriber origin, and configure an approved campaign SMTP relay. Disable the legacy public self-export and wipe controls. Verify public form protection and use double opt-in for public audiences. The overlay derives the app’s `NEWSLETTER_PUBLIC_ORIGIN` from the public hostname. In a native installation set the same exact HTTPS origin as the engine Root URL to enable public list embeds. Set `NEWSLETTER_PUBLIC_SIGNUP_ENABLED=true` only when the public form is ready. The default filesystem media backend serves stable `/uploads/` URLs from the persistent newsletter volume. For S3, use a dedicated campaign asset bucket or prefix and verify its public read policy and URL; the CRM attachment bucket is private.
7. Start Warpdrive with both Compose files and both environment files. Sign in with Warpdrive and open **Actions → Campaigns**. Confirm permissions, subscription and unsubscribe links, and Mailpit delivery in development before setting `NEWSLETTER_DELIVERY_ENABLED=true` on a live installation.

When attaching an existing Listmonk database, review subscribers with legacy global `disabled` status. The derived engine sends only to globally enabled subscribers. Reconcile intended suppression from the existing records before enabling live delivery. The native form creates enabled or blocklisted subscribers and preserves legacy values during profile edits. Review current campaigns and pending schedules before attaching a populated database. When upgrading an existing private backend role, add the CRM identity and erasure grants from the table below before reconnecting the app and worker. When upgrading an existing private backend role, add the CRM identity and erasure grants from the table below before reconnecting the app and worker.

Set `NEWSLETTER_TEST_RECIPIENTS` to the exact, comma-separated test addresses approved for this installation. Both Warpdrive and the engine enforce the list. An empty list disables campaign test sends. Use a capture-only relay for local synthetic tests.

Engine role grants for the native workspace:

| Area                        | Grants                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Campaigns                   | `campaigns:get_all`, `campaigns:manage_all`, `campaigns:get_analytics`, `campaigns:send` |
| Lists                       | `lists:get_all`, `lists:manage_all`                                                      |
| Subscribers                 | `subscribers:get_all`, `subscribers:manage`, `subscribers:import`                        |
| Bounces                     | `bounces:get`, `bounces:manage`                                                          |
| Media                       | `media:get`, `media:manage`                                                              |
| Templates                   | `templates:get`, `templates:manage`                                                      |
| CRM identity and provenance | `warpdrive:identity_verify`, `warpdrive:identity_erase`                                  |
| Engine configuration        | `settings:get`, `settings:manage`, `settings:maintain`                                   |

The native adapter accepts fixed operations and literal subscriber searches. The upstream token omits `subscribers:sql_query`, transactional mail, user administration and role administration. Listmonk still exposes some search-based bulk endpoints to `subscribers:manage`, so keep the engine API and token private. Private engine access is required to configure its relays and provider credentials. The CRM source and audience routes use a private API identity. Set up the optional signed SES feedback route when using SES. The public site exposes subscription, confirmation, preference and tracking routes, archives, and media. The engine admin UI and administrative API remain on the private network. With the delivery flag off, the Compose engine starts in passive mode. Turning delivery on recreates the engine with its scheduler active. Review pending schedules before that change. Recipient unsubscribe links remain available in either mode. The public proxy serves Listmonk’s protected form when signup and delivery are enabled. The raw JSON signup endpoint stays private.

## Settings ownership

| Listmonk area | Warpdrive surface and engine responsibility                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General       | Company and Branding own the CRM name and assets. Regional settings own staff locale and time zone. Campaign settings own the mailing sender, public subscription and archive behavior. The operator sets the subscriber origin.                                                                                                                                                                          |
| Performance   | Campaign settings control sender concurrency, message and batch limits, and related delivery settings. Maintenance shows the effective combined limit and batch size after safety caps are applied.                                                                                                                                                                                                       |
| Privacy       | Warpdrive Privacy owns CRM requests. Campaign settings own campaign tracking, confirmation and unsubscribe policy. Audience operations preserve the engine's suppression and list-level unsubscribe state. Use blocklisting to remove a subscriber from delivery. Permanent subscriber erasure needs a separate procedure that preserves suppression during concurrent unsubscribe and bounce processing. |
| Security      | Warpdrive sign-in, MFA and workspace roles govern the native UI. The engine has a dedicated service identity. The subscriber origin owns public-form protections and trusted origins.                                                                                                                                                                                                                     |
| Media         | The Campaigns media library uses durable engine URLs. Warpdrive Files still serves CRM attachments.                                                                                                                                                                                                                                                                                                       |
| SMTP          | Campaign SMTP has separate sender identity, relay, TLS and retry settings from CRM authentication and personal mailbox connections. Relay endpoints and credentials are operator-managed.                                                                                                                                                                                                                 |
| Bounces       | Campaigns shows the engine's bounce records. The engine applies bounce thresholds and suppression settings to the campaign audience. Provider webhook credentials are operator-managed.                                                                                                                                                                                                                   |
| Messengers    | The campaign engine owns custom postback messenger configuration. The operator controls destinations and credentials.                                                                                                                                                                                                                                                                                     |
| Appearance    | Warpdrive Appearance and Branding control authenticated screens. Subscriber pages have a separate public visual identity at the subscriber origin.                                                                                                                                                                                                                                                        |
| Maintenance   | Settings reports the database, scheduler, authenticated SMTP, media and feedback checks. It also provides date-filtered cleanup of unconfirmed subscriptions, views and clicks, and analytics CSV export without subscriber identifiers. PostgreSQL administration owns database maintenance.                                                                                                             |
| Logs          | Settings shows structured workspace and campaign events from Warpdrive's audit store. The last 90 days are available with source and outcome filters. Campaign changes have a correlation ID and outcome. Provider process logs stay with the engine operator.                                                                                                                                            |

Each mutating action has an operation ID tied to the Warpdrive actor and the validated intent. An acknowledged retry reuses its receipt. An unresolved receipt prevents redispatch. To reconcile a lost response, look up the operation ID in **Settings → Logs** and compare it with the engine record, delivery log, or import status. Record the reviewed outcome and evidence reference there before authoring another action. HTML and CSV previews are transient.

After a campaign starts, retain its historical audience associations so previously delivered unsubscribe links remain useful. The sender rechecks recipient eligibility immediately before handing the message to the transport. Once a relay accepts a message, the engine cannot recall it.

To exercise the consent and scheduler path with disposable local services, run:

```sh
python3 -B scripts/newsletters/engine-smoke.py \
  --engine /path/to/derived/listmonk --mailpit /path/to/mailpit \
  --postgres-bin "$(pg_config --bindir)"
```

The smoke uses loopback listeners, a fresh PostgreSQL cluster and an SMTP sink restricted to synthetic addresses. It exercises mixed-list confirmation, a real due-time dispatch, exclusion of ineligible recipients and the delivered one-click unsubscribe link.

## CRM contacts and campaign audiences

The **Newsletter** tab on a Person record can verify mailbox control and request consent for one active double opt-in list. The mailbox proof and consent request have separate purposes. A Person created from an import or lead, a manual list assignment, and a successful mailbox proof carry no newsletter consent. Shared or changed addresses require review. The consent check uses the exact verified address, subscriber, list and grant.

An editor can preview a saved People view on a campaign draft and approve up to 1,000 visible, eligible addresses. The approval binds to the campaign revision, saved view and exact grants. A later opt-out, address change, new grant or archived list can remove a recipient from the approved audience. Choose a fresh preview when the draft or source changes.

Use permission sets to grant **View campaigns and consent on visible contacts**, **Create and edit campaign drafts**, **Send and pause campaigns**, and **Request newsletter consent on visible contacts**. Grant View to everyone using a delegated Campaigns role. Delegated senders start campaigns from an approved CRM audience. The administrator manages the global subscriber database, settings, maintenance and delivery reconciliation.

The worker persists later consent revocations from unsubscribe, suppression and archived lists against the original binding and purpose before acknowledging the engine event. Replayed events retain the same identity. Completed privacy erasure fences removed history.

Newsletter Workflow triggers can use verified mailbox, confirmed consent and revoked consent events. The consent check and invitation actions follow current Person visibility and permission-set rules. Native contact Timeline entries report consent events and exact campaign SMTP acceptances for the current linked Person. An operator can create a lead from a reviewed campaign delivery for the same Person. Conversion carries that source to the deal and a native Won transition records a qualified outcome. Campaign click and open counts remain engagement metrics.

Choose a connected CRM mailbox in the campaign’s Reply-To field. Gmail needs mail-read access. An IMAP connection needs Inbox selected for sync. The engine sends through campaign SMTP with that mailbox as Reply-To. The CRM mailbox connector imports replies through its usual sync. Native Start, Schedule and Resume verify the current operator’s access to the mailbox and its exact address. Recheck the connection before an already scheduled campaign is due if the mailbox is being moved or disconnected.

## SES feedback and delivery receipts

For SES, configure one sending configuration set and an HTTPS SNS event destination for deliveries, bounces and complaints. Set `NEWSLETTER_SES_FEEDBACK_ENABLED=true`, `NEWSLETTER_SES_TOPIC_ARN` and `NEWSLETTER_SES_CONFIGURATION_SET` in the private newsletter environment. Use the matching SES region, SMTP relay and sending account. The destination uses `POST /webhooks/warpdrive/ses` on the newsletter host. Select SNS signature version 2. Verify that Maintenance shows the subscription confirmed before starting campaigns. [AWS SNS signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html) [AWS SES event publishing](https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html)

The engine accepts only verified events for the configured topic, sending account and configuration set. It matches signed feedback to the exact delivery and address. Hard bounces and complaints suppress that mailbox. The ledger records soft bounces and unresolved matches. Verified feedback stays available while the sender is passive.

A campaign’s message is fixed after delivery starts. Duplicate it to change the message or repair a managed Reply-To. A duplicate of an approved CRM campaign needs its own audience approval. Campaign delivery receipts show recent SMTP acceptance and outcomes requiring review. For an unresolved submission, compare its message identifier with the relay and record the evidence reference before resolving it. A process restart can retry work reserved before submission. Work already submitted stays held until it is accepted, rejected or reviewed. Before changing the effective relay limits, check the configured capacity shown in Maintenance. The native worker logs readiness outages and recovery once per observed transition when delivery is enabled. Use the installation’s existing log monitoring for these events.

## Backup, upgrade and restore

Capture the CRM PostgreSQL database, the separate newsletter PostgreSQL database and the newsletter media volume or S3 object versions. Pause campaigns and stop signup for a coordinated snapshot. Save a checksum manifest beside the dumps and media backup, and record the installed app and engine revisions. Retain the original provider delivery receipts for reconciliation. Backups include sensitive state and belong in the installation’s protected backup destination.

Restore into isolated database targets and a separate media volume. Start the derived engine in passive mode and keep the public form closed. Compare the restored consent, global suppression and delivery receipts with activity after the backup before enabling delivery. Check real media bytes, pending schedules and the engine and application migration versions. Preserve unresolved submissions during rollback. A restored earlier engine can run passive for inspection while current delivery state is reconciled.

Run the synthetic restore against a built engine and the repository’s installed Bun dependencies.

```sh
python3 -B scripts/newsletters/restore-smoke.py \
  --engine /path/to/derived/listmonk --mailpit /path/to/mailpit \
  --postgres-bin "$(pg_config --bindir)" --bun "$(command -v bun)"
```

Production qualification also requires an authorized sending domain and capture mailbox. Verify sender DNS, inbox delivery, confirmation and one-click unsubscribe, persistent feedback, relay rotation, alerts and backup recovery in that installation.
