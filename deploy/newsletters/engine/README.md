# Warpdrive newsletter engine

The engine uses Listmonk [v6.2.0](https://github.com/knadh/listmonk/releases/tag/v6.2.0) at commit `ef0a75872463f10a4848af6c547d1c057405453a`. The Dockerfile pins its source archive, runtime image, and Go builder by digest. The build checks the source archive again, applies the patches in filename order, and builds against the upstream Go lockfile. The packaged admin frontend comes from the pinned upstream release. The derived executable packages the source tree's queries, schema, and public templates.

Listmonk is licensed under the [GNU AGPL v3](https://github.com/knadh/listmonk/blob/v6.2.0/LICENSE). The image includes the upstream license and a source archive with the pinned source, patches, build inputs, and test scripts. The subscriber page footer links to that archive at `/public/static/warpdrive-engine-source.tar.gz`. Preserve that route on the public newsletter host.

Build the container with BuildKit.

```sh
docker build -t warpdrive-newsletter-engine:6.2.0-crm.1 ./deploy/newsletters/engine
```

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

The authenticated `GET /api/warpdrive-capabilities` response proves the required consent, dispatch, CRM identity, approved audience and durable recipient delivery capabilities. The image applies the CRM and audience schema on first install and when opening an existing Listmonk database.

An approved CRM audience references immutable grants for the selected double opt-in list. Unsubscribing, suppressing a subscriber, changing a verified address or archiving the list can exclude previously approved recipients. A fresh grant does not revive a recipient in an earlier audience.

The delivery ledger records recipient admission and the scan cursor in one transaction. It retries leases that expire before submission. A lost SMTP acknowledgement stays unresolved until an operator verifies it. Operators can inspect the delivery ledger and record an accepted or rejected outcome in Warpdrive.

The consent event outbox records each exact grant revocation once, including revocations caused by unsubscribe, suppression, address changes and archived lists. It retains a scope digest for reconciliation after subscriber erasure. The native worker persists the event against its original approved binding and purpose before acknowledging it. Upgrades backfill earlier retained revocations with their original occurrence time. The `consentEvents` capability and readiness checks require this schema.

The internal operational outbox adds capability `operationalEvents:1` and delivery schema version 5. Authenticated `GET /api/warpdrive/operational-events?limit=100` reads bounded unacknowledged events with `settings:get`. `POST /api/warpdrive/operational-events/ack` accepts `event_ids` with `settings:manage` after the native consumer commits. It uses durable source identities and no timestamp frontier. Receipt outcomes and signed feedback commit with their events. A bounded background scan projects retained issues and expired submissions into the outbox while preserving receipt/campaign state in passive mode. It starts no SMTP work and sends no email alarms. See the [operational regression and evidence boundaries](operational-tests/README.md).
