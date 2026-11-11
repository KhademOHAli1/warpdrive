# Warpdrive newsletter engine

The engine uses Listmonk [v6.2.0](https://github.com/knadh/listmonk/releases/tag/v6.2.0) at commit `ef0a75872463f10a4848af6c547d1c057405453a`. The Dockerfile pins its source archive, runtime image, and Go builder by digest. The build checks the source archive again, applies the patches in filename order, and builds against the upstream Go lockfile. The packaged admin frontend comes from the pinned upstream release. The derived executable packages the source tree's queries, schema, and public templates.

Listmonk is licensed under the [GNU AGPL v3](https://github.com/knadh/listmonk/blob/v6.2.0/LICENSE). The image includes the upstream license and a source archive with the pinned source, patches, build inputs, and test scripts. The subscriber page footer links to that archive at `/public/static/warpdrive-engine-source.tar.gz`. Preserve that route on the public newsletter host.

Build the container with BuildKit.

```sh
docker build -t warpdrive-newsletter-engine:6.2.0-crm.1 ./deploy/newsletters/engine
```

The final image defaults to numeric user/group `65532:65532`. Only its image-owned `/listmonk/uploads` directory receives that ownership during the image build. The entrypoint preserves `LISTMONK_*_FILE` loading and executes the supplied command, including the Compose command; missing, unreadable or invalid file paths fail without logging secret values. Startup does not create users/groups or change directory/volume ownership. Existing upload volumes require a separately reviewed ownership transition before this image is installed. Read-only-root operation additionally requires bounded writable uploads and temporary storage; image source checks do not qualify existing-volume ownership or an installed migration.

To build a native development binary, supply the verified source tarball and the same platform's verified Listmonk v6.2.0 release binary. Use Go 1.26.1 and a fresh output directory. The script reads the upstream binary's embedded admin assets.

```sh
sh deploy/newsletters/engine/build.sh /path/to/source.tar.gz /path/to/listmonk /path/to/output
```

Run the consent regression against the packed binary with local PostgreSQL tools. It creates a disposable PostgreSQL cluster and starts the engine on loopback in passive mode.

```sh
python3 -B deploy/newsletters/engine/tests/consent.py \
  --engine /path/to/output/listmonk --pg-bin "$(pg_config --bindir)"
```

The public opt-in patch uses the server-selected pending list IDs, rechecks the current subscription status in the update, and locks the enabled subscriber row before changing memberships. A concurrent unsubscribe or global suppression can leave the confirmation with zero changed memberships. A link still uses Listmonk's subscriber UUID and does not acquire a new token format.

Opening a confirmation link presents the form even when the legacy `app.show_optin_page` setting is disabled. GET and HEAD leave memberships unchanged. An affirmative form POST supplies the list IDs and confirmation in the request body.

The list update locks the current list row and rejects a double-to-single opt-in change with HTTP 409. Single-to-double changes and edits that preserve the current opt-in mode remain supported.

The authenticated `GET /api/warpdrive-capabilities` response proves the required consent, dispatch, CRM identity, approved audience and durable recipient delivery capabilities. Schema changes run through the explicit maintenance command below. Ordinary startup requires its verified receipt and performs read-only schema admission before preparing queries; it does not install, upgrade, rebuild indexes, backfill consent events or pause legacy campaigns.

An approved CRM audience references immutable grants for the selected double opt-in list. Unsubscribing, suppressing a subscriber, changing a verified address or archiving the list can exclude previously approved recipients. A fresh grant does not revive a recipient in an earlier audience.

The delivery ledger records recipient admission and the scan cursor in one transaction. It retries leases that expire before submission. A lost SMTP acknowledgement stays unresolved until an operator verifies it. Operators can inspect the delivery ledger and record an accepted or rejected outcome in Warpdrive.

The consent event outbox records each exact grant revocation once, including revocations caused by unsubscribe, suppression, address changes and archived lists. It retains a scope digest for reconciliation after subscriber erasure. The native worker persists the event against its original approved binding and purpose before acknowledging it. Upgrades backfill earlier retained revocations with their original occurrence time. The `consentEvents` capability and readiness checks require this schema.

The internal operational outbox adds capability `operationalEvents:1` and delivery schema version 5. Authenticated `GET /api/warpdrive/operational-events?limit=100` reads bounded unacknowledged events with `settings:get`. `POST /api/warpdrive/operational-events/ack` accepts `event_ids` with `settings:manage` after the native consumer commits. It uses durable source identities and no timestamp frontier. Receipt outcomes and signed feedback commit with their events. A bounded background scan projects retained issues and expired submissions into the outbox while preserving receipt/campaign state in passive mode. It starts no SMTP work and sends no email alarms. See the [operational regression and evidence boundaries](operational-tests/README.md).

Explicit schema maintenance uses the same final engine executable:

```sh
./listmonk --config '' --migrate --yes
```

Before invoking it, preserve a paired database/media backup, stop every engine runtime and independently verify that those processes have stopped. Keep delivery disabled and callers held until the migration exits successfully and its receipt has been read back. A connection snapshot by itself cannot establish that an older process will not reconnect. The Compose overlay exposes a manual one-shot service, outside ordinary `up`:

```sh
docker compose -f docker-compose.yml -f docker-compose.newsletters.yml \
  --profile newsletter-migrations run --rm newsletter-engine-migrate
```

`--migrate --yes` installs only an empty public schema or upgrades a recognized upstream schema. It executes the existing CRM identity/consent backfill, approved audiences, durable delivery, SES feedback, readiness index and operational outbox installers in order. Their existing transactions, idempotency markers and legacy campaign holds remain intact. A campaign with an old volatile-queue cursor is held for reconciliation during explicit migration. A restart never establishes a new legacy hold. The command does not start HTTP, a scheduler, SMTP or an operational-event monitor. The compatible `--install --yes` and `--upgrade --yes` commands use the same complete boundary; `--install` on an existing schema requires `--idempotent`, and destructive reinstallation is refused. All migration modes require `--yes` after the maintenance checks.

A dedicated connection holds an exclusive advisory lock `(900731613, 90)` during migration. Each new runtime holds a shared lock on that key from before admission through its process lifetime. During SIGHUP reload, the DB pool, shared session and heartbeat remain alive until successful atomic `syscall.Exec` replaces the old code and closes its database sockets; the reload callback never unlocks or closes the pool. A failed exec exits the process with the fence retained. Campaign manager close is not a complete drain of all callbacks, so this reload behavior makes no drain guarantee. Lock acquisition has a five-second bound. The reserved connection counts toward `db.max_open`, which must be finite and at least two; it does not add an unbudgeted pool. A one-second heartbeat with a two-second query deadline exits the process on lost lock/session ownership. This cooperative guard cannot provide strict fencing of other pooled sessions or provider callbacks during the detection interval. Supported migration therefore still requires independently verified offline maintenance. Older binaries do not participate in this guard and cannot be upgraded online safely by relying on the advisory lock.

`public.warpdrive_engine_schema` records contract version 1, exact upstream version, an installer-content SHA-256, the actual catalog SHA-256 and installation time. The build hashes the final verified upstream migration files, embedded SQL and installer-containing source files before embedding that fingerprint. Catalog admission binds public relations, columns/defaults, constraints, valid indexes, enums, function definitions, triggers, view definitions, RLS flags/policies and sequence configuration; it excludes data, owners, grants and sequence counters. Schema ownership, privileges and PostgreSQL-version compatibility need separate operational qualification. A PostgreSQL upgrade can change catalog rendering and requires explicit review. The source archive includes the final patch and migration regression runner with the reproducible build recipe.

The final receipt transaction runs only after every installer and required-object validation succeeds. Existing installers commit separately, so failure can leave partial work; it never produces a fresh success receipt. A timeout, connection loss or uncertain commit requires inspection before any writer resumes. Do not assume rollback or retry a fresh install against a nonempty partial database. Missing receipts require the explicit operation. Unknown upstream versions, newer receipts and same-installer catalog drift fail closed; restore the inspected expected schema before retrying, or ship a reviewed migration for the change. An unchanged qualified schema returns without changing the receipt or rerunning installers.

Run the bounded [native migration regression](migration-tests/README.md) against the packed final binary and exact patched source. Static patch application and fixture code do not establish installed-runtime acceptance; CI must execute the PostgreSQL, lock-loss and restart probes before this boundary is qualified.
