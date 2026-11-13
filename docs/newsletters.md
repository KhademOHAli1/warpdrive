# Campaigns in Warpdrive

Campaigns uses Warpdrive sessions, permission sets, CSRF protection, navigation, locale, and audit records. The server calls one internal Listmonk engine per Warpdrive installation. The engine owns campaign scheduling and SMTP delivery, list membership, consent state, bounce handling, and templates. It uses a dedicated database and role on the Warpdrive PostgreSQL service. Warpdrive's existing worker reconciles identity and consent events, runs newsletter Workflow actions, and monitors operational events through a dedicated minute queue.

The deployment builds the [derived newsletter engine](../deploy/newsletters/engine/README.md) from pinned Listmonk [v6.2.0](https://github.com/knadh/listmonk/releases/tag/v6.2.0). The derived engine requires an explicit form submission to confirm opt-in. It preserves suppression, rejects double opt-in downgrades, and checks reviewed campaign revisions at the point of change. Warpdrive verifies the installed engine capabilities before writing. Listmonk is distributed under its [AGPLv3 license](https://github.com/knadh/listmonk/blob/v6.2.0/LICENSE). The upstream [source for this version](https://github.com/knadh/listmonk/tree/v6.2.0) and [API contract](https://listmonk.app/docs/apis/apis/) are available separately.

The [installation evidence worksheet and operator runbook](newsletters-operations.md) covers the pending provider, inbox, monitoring, rotation and recovery qualification. Record the selected installation and evidence references there before live activation.

## Installation

1. On the PostgreSQL service, use a database administrator to create the dedicated role and database for the source Compose overlay. Both `newsletter-engine-migrate` and `newsletter-engine` use this newsletter database owner and the same `NEWSLETTER_POSTGRES_PASSWORD`. Use a unique generated password. An existing installation keeps its current role, password and database until a planned rotation.

   ```sql
   CREATE ROLE warpdrive_newsletters LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
   \password warpdrive_newsletters
   CREATE DATABASE warpdrive_newsletters OWNER warpdrive_newsletters;
   REVOKE CONNECT ON DATABASE warpdrive_newsletters FROM PUBLIC;
   ```

   A separate runtime login requires a different installation configuration and grants. Qualify its migration and runtime access, startup, and recovery for the selected installation. The [restricted-role test](deployment-engine-images.md) covers a disposable fixture.

2. Put `NEWSLETTER_POSTGRES_PASSWORD` in a private, Git-ignored `.env.newsletters` file for Compose interpolation. Set `NEWSLETTER_PUBLIC_DOMAIN` there to a dedicated subscriber-facing host and add its DNS record. Keep engine credentials in this separate file so only the intended Compose service receives each value. Use a separate hostname from the CRM and its S3 service.
3. Back up the database, media and installation configuration before an upgrade. Stop every engine runtime and independently verify it is absent. Confirm PostgreSQL is running and healthy. Verify that the local engine image referenced by the overlay was built from the selected source revision. Run the explicit migration service with the optional overlay. Start the runtime from the same verified image after the migration exits successfully and you read back its receipt. Keep it stopped if the outcome is unknown. Review existing uploads ownership before using the unprivileged runtime. Startup leaves mounted ownership as configured.

   ```sh
   docker compose --env-file .env --env-file .env.newsletters \
     -f docker-compose.yml -f docker-compose.newsletters.yml \
     --profile newsletter-migrations run --rm --no-deps --pull never newsletter-engine-migrate
   ```

   After verifying the migration receipt and selected local image, start the engine:

   ```sh
   docker compose --env-file .env --env-file .env.newsletters \
     -f docker-compose.yml -f docker-compose.newsletters.yml \
     up -d --no-deps --no-build --pull never newsletter-engine
   ```

4. Bootstrap the engine admin with `NEWSLETTER_BOOTSTRAP_USER` and `NEWSLETTER_BOOTSTRAP_PASSWORD` during initial installation, or use the upstream setup screen on a private operator tunnel. Use a temporary loopback-only mapping to reach the upstream UI during setup. Then remove the mapping and bootstrap variables.
5. In Listmonk create an API user with a dedicated user role. Give it the permissions listed below. Set `NEWSLETTER_API_USER` and `NEWSLETTER_API_TOKEN` in the private Compose interpolation file. For a mounted token, mount it in the app and worker services and set `NEWSLETTER_API_TOKEN_FILE` for each. The overlay sets the private engine origin for both services. A native development process can use the existing loopback engine origin.
6. Set Listmonk's **Root URL** to the dedicated HTTPS subscriber origin, and configure an approved campaign SMTP relay. Disable the legacy public self-export and wipe controls. Verify public form protection and use double opt-in for public audiences. The overlay derives the app’s `NEWSLETTER_PUBLIC_ORIGIN` from the public hostname. In a native installation set the same exact HTTPS origin as the engine Root URL to enable public list embeds. Keep `NEWSLETTER_PUBLIC_SIGNUP_ENABLED=false` until an explicit activation decision is recorded and the public form and installed provider are qualified. The default filesystem media backend serves stable `/uploads/` URLs from the persistent newsletter volume. For S3, use a dedicated campaign asset bucket or prefix and verify its public read policy and URL; the CRM attachment bucket is private.
7. Start Warpdrive with both Compose files and both environment files. Sign in with Warpdrive and open **Actions → Campaigns**. Confirm permissions, subscription and unsubscribe links, and Mailpit delivery in development before setting `NEWSLETTER_DELIVERY_ENABLED=true` on a live installation.

When attaching an existing Listmonk database, review subscribers with legacy global `disabled` status. The derived engine sends only to globally enabled subscribers. Reconcile intended suppression from the existing records before enabling live delivery. The native form creates enabled or blocklisted subscribers and preserves legacy values during profile edits. Review current campaigns and pending schedules before attaching a populated database. When upgrading an existing private backend role, add the CRM identity and erasure grants from the table below before reconnecting the app and worker.

Current internal monitoring also requires the derived engine's `operationalEvents:1` capability from patch 085 and the matching CRM migration `0117_newsletter_operational_visibility`. The published 1.6.1 qualification record covers its recorded revision; it does not establish installation or provider qualification for these later additions. Apply the canonical app migrations and install the matching engine through the reviewed upgrade procedure before qualifying the operational feed.

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
| Maintenance   | Settings reports database, scheduler, authenticated SMTP, media and feedback checks, plus native worker/event-sync freshness. It also provides date-filtered cleanup of unconfirmed subscriptions, views and clicks, and analytics CSV export without subscriber identifiers. PostgreSQL administration owns database maintenance.                                                                        |
| Logs          | Settings shows structured workspace/campaign events and validated operational incident details from Warpdrive's audit store. The last 90 days have source/outcome filters. Current operators can also receive safe in-app bell notices. Provider process logs remain supplemental technical evidence.                                                                                                     |

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

For a no-reply sender, set `app.from_email` to a value such as `Example <noreply@example.org>`, leave the CRM inbox selector unselected, and remove `Reply-To` from both the SMTP relay headers and campaign headers. Clear any previously selected inbox through the selector. Review each campaign’s From value because the global default fills only an empty From. Create no receiving alias. Recipients’ mail clients may still address replies to the visible From address; existing domain catch-all behavior is a separate receiving configuration.

## SES feedback and delivery receipts

For SES, configure one sending configuration set and an HTTPS SNS event destination for **Bounce** and **Complaint** events. Keep SNS raw message delivery disabled and select topic signature version 2. Use the matching SES region, SMTP relay and sending account. The destination uses `POST /webhooks/warpdrive/ses` on the newsletter host. [AWS SNS signature version](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-configure-message-signature.html), [raw message delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html) and [SES SNS event destinations](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html).

Complete the installation’s subscription review before enabling the feedback endpoint and creating its HTTPS SNS subscription. Verify the exact topic ARN, configuration-set name and public endpoint while delivery and public signup remain disabled. Set `NEWSLETTER_SES_FEEDBACK_ENABLED=true`, `NEWSLETTER_SES_TOPIC_ARN` and `NEWSLETTER_SES_CONFIGURATION_SET` in the private newsletter environment. The engine automatically confirms a valid signed SNS subscription confirmation after verifying its configured topic and regional SNS URLs. Verify that Maintenance shows the subscription confirmed before starting campaigns.

The engine accepts only verified events for the configured topic, sending account and configuration set. It matches signed feedback to the exact delivery and address. Hard bounces and complaints suppress that mailbox. The ledger records soft bounces and unresolved matches. Verified feedback stays available while the sender is passive.

A campaign’s message is fixed after delivery starts. Duplicate it to change the message or repair a managed Reply-To. A duplicate of an approved CRM campaign needs its own audience approval. Campaign delivery receipts show recent SMTP acceptance and outcomes requiring review. For an unresolved submission, compare its message identifier with the relay and record the evidence reference before resolving it. A process restart can retry work reserved before submission. Work already submitted stays held until it is accepted, rejected or reviewed. Before changing the effective relay limits, check the configured capacity shown in Maintenance.

## Internal operational visibility

**Settings → Logs**, the notification bell and **Settings → Maintenance** provide operational visibility inside the CRM. The dedicated `newsletter-operations-monitor` queue runs at worker startup and every minute, independently of Workflow reconciliation. It persists readiness incident/recovery state and consumes terminal failures, uncertain submissions, reviewed resolutions and signed bounce/complaint facts. Configured installations continue consuming late feedback while delivery is disabled; relay readiness monitoring is paused in that mode.

The engine's private operational GET is read-only. After validating each event, the worker commits its source-UUID receipt, safe aggregate audit entry and eligible in-app notices together, then ACKs the exact IDs. Failed transactions do not ACK. Durable engine/source dedupe and native receipts preserve replay and restart behavior without duplicate notices. The engine's bounded expiry sweep changes only its operational outbox, including during a passive restore; delivery/campaign receipts and resend rules are preserved.

Only current active administrators can see these operational notices. The in-app notification preference controls bell visibility, and read-time permission checks also apply after a role is revoked. Operational notifications have no email channel, including when an old stored preference requests email. No external alert receiver or email alarm destination is required. Readiness stdout/stderr JSON remains supplemental technical evidence.

Notice and log details contain fixed category/reason/count values. They omit recipient addresses, campaign content, provider bodies, credentials and raw errors. Unmatched signed feedback asks for review and establishes no Person attribution or suppression. A later exact match remains visible. A `provider_accepted` resolution establishes SMTP/provider handoff for a prior issue; actual inbox receipt needs separate proof. Marking a bell item read or acknowledging transport does not resolve a submission, authorize a resend or grant consent.

Maintenance refreshes its read-only CRM monitoring status every 60 seconds while the page is active. It reports the last worker check and successful event sync separately from engine readiness. Both must be within five minutes for current status; a stopped worker therefore becomes stale while the CRM UI remains accessible. Reading or refreshing that status does not run jobs or advance their timestamps. If the CRM itself is unavailable, it cannot show an in-app incident. Keep that availability limit distinct from engine readiness.

The operational GET/ACK endpoints require the private backend's existing `settings:get`/`settings:manage` grants and remain outside the public ingress allowlist. The [operator runbook](newsletters-operations.md#internal-crm-monitoring) describes the contract, installation proof and authentication-only credential rotation window with all mail-producing work held. These docs establish no live installation or provider qualification.

## Backup, upgrade and restore

Capture the complete CRM PostgreSQL database (including migration and pg-boss schemas), the separate newsletter database, CRM object storage and newsletter media. Include the exact runtime configuration, resolved secret-file contents, encryption/signing keys, accepted image identities and deployment journals in the protected recovery set. Keep backup decryption keys in separate custody, and require encrypted off-host storage with independent readback.

The [operator worksheet](newsletters-operations.md#coordinated-snapshot) supplies archive and restore commands for filesystem newsletter media. For S3-backed newsletter media, keep recovery qualification pending until a backend-specific versioned export, manifest verification and isolated restore pass.

Pausing campaigns and disabling signup do not establish a consistent snapshot. Tracking/subscription requests, Web jobs, operational outbox sweeps and already issued storage upload URLs can still write. A coordinated offline capture must stop and independently verify all ingress, Web, Worker, Realtime, engine, migrator and one-off writers, and fence direct object-storage access before capturing databases and media. Existing advisory locks do not fence all these writers. Retain checksums, exact installed image/configuration identities, CRM operational receipts, audit/notices/preferences, engine outbox acknowledgement/source-dedupe state and original provider delivery receipts for reconciliation. The encrypted off-host workflow and installed restore remain separate qualification gates.

Restore into isolated database targets and separate media storage with external effects blocked. Use an engine whose schema admission accepts that recovery set, in passive mode, and keep public ingress closed. Compare restored consent, suppression and delivery receipts with activity after the backup before enabling delivery. Check media bytes, schedules, migration versions and operational acknowledgement/source identities as one set before starting the restored worker. Passive mode can still perform operational writes; preserve original receipts and unresolved submissions. An earlier engine requires explicit compatibility evidence before it can inspect or mutate a restored database.

The existing synthetic restore covers two databases, media bytes and selected consent/receipt state. It does not encrypt or transfer backups off-host, recover key custody or establish an installation recovery result. Run it against a built engine and the repository’s installed Bun dependencies.

```sh
python3 -B scripts/newsletters/restore-smoke.py \
  --engine /path/to/derived/listmonk --mailpit /path/to/mailpit \
  --postgres-bin "$(pg_config --bindir)" --bun "$(command -v bun)"
```

Production qualification requires an authorized sending domain, test inbox and selected installation. Retain the DNS, inbox, confirmation, one-click unsubscribe, feedback, credential rotation, internal incident/recovery and worker-staleness evidence in the [operator worksheet](newsletters-operations.md). Live evidence remains Pending until the corresponding installation checks have run.
