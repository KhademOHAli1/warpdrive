# Warpdrive newsletter engine

The engine uses Listmonk [v6.2.0](https://github.com/knadh/listmonk/releases/tag/v6.2.0) at commit `ef0a75872463f10a4848af6c547d1c057405453a`. The Dockerfile pins its source archive, runtime image, and Go builder by digest. The build checks the source archive again, applies the patches in filename order, and builds against the upstream Go lockfile. The packaged admin frontend comes from the pinned upstream release. The derived executable packages the source tree's queries, schema, and public templates.

Listmonk is licensed under the [GNU AGPL v3](https://github.com/knadh/listmonk/blob/v6.2.0/LICENSE). The image includes the upstream license and a source archive with the pinned source, patches, build inputs, and test scripts. The subscriber page footer links to that archive at `/public/static/warpdrive-engine-source.tar.gz`. Preserve that route on the public newsletter host.

Build the container with BuildKit.

```sh
docker build -t warpdrive-newsletter-engine:6.2.0-consent.1 ./deploy/newsletters/engine
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

The build requires the opt-in confirmation, dispatch, list consent mode, public subscriber update, campaign revision, and affirmative opt-in patches. Warpdrive checks `consent: 2`, `dispatch: 1`, `listConsentMode: 1`, `publicSubscriberUpdate: 1`, and `campaignRevision: 1` on the authenticated `GET /api/warpdrive-capabilities` response before admitting writes that require the derived engine.
