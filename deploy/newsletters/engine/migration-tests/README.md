# Explicit migration and runtime admission regression

Run against the exact **packed** engine and its corresponding patched source, using local PostgreSQL tools:

```sh
python3 -B deploy/newsletters/engine/migration-tests/verify.py \
  --engine /path/to/packed/listmonk \
  --source /path/to/exact/patched/source \
  --pg-bin /path/to/postgresql/bin \
  --output /path/to/new/migration-evidence.json
```

The caller must establish the binary/source build provenance. The runner records the binary digest and verifies the supplied `schema.sql` against the pinned v6.2.0 baseline SHA-256. It does not rebuild or install dependencies, use Docker, connect to an existing database, or operate a provider. `--output` is optional and must be a new file.

The runner reuses the consent fixture without changing historical tests. It owns a temporary PostgreSQL cluster with Unix-socket-only access and passive loopback engine processes. Its allowlisted environment disables delivery, public signup and SES feedback; synthetic settings disable update checks. Runtime pools are finite and allow the dedicated lifecycle-fence connection. Cleanup stops only its own processes and cluster, including on assertion failure.

It verifies:

- Fresh `--migrate --yes --config ''` initialization, valid receipt fields and no-write repeated migration, including receipt installation time and table tuple identities.
- Schema-level legacy upgrade from the exact pinned upstream schema and upstream migration-version metadata. Started/cursor-bearing legacy campaigns become paused with one `legacy` hold; an unstarted scheduled campaign remains unchanged. Repeated explicit migration preserves the result.
- Explicit `--upgrade --yes`, followed by admitted passive startup.
- Missing receipt tables, missing receipt rows, future receipts and required-index catalog drift reject ordinary startup without durable writes. A missing table can be explicitly installed; an existing invalid or future receipt is not silently overwritten. Catalog drift cannot be blessed by repeating the same-source migration. A missing versioned index is not silently recreated or accepted with a new receipt; restoring it permits migration again.
- Changes to RLS enablement, policy definitions or sequence configuration reject ordinary startup and same-source requalification; restoring the original schema preserves the receipt.
- A separately privileged runtime role can start twice and read schema readiness while an event trigger forbids any attempted runtime DDL. The fixture helper function lives outside the engine's public catalog fingerprint. Ordinary runtime preserves the admission receipt; this check does not prohibit legitimate non-schema runtime writes.
- A live runtime's shared lifecycle fence rejects explicit migration with a bounded failure and leaves the runtime healthy.
- A real explicit migration holds its exclusive lifecycle fence while waiting on an owned installer lock. A uniquely named runtime backend must actually wait on an ungranted shared lock on that exact key, blocked by the owned migration backend according to `pg_blocking_pids`, before its bounded rejection counts. Early rejection on the missing receipt alone fails this probe. Migration completes when the installer lock is released. Outer cleanup reaps both owned processes even if releasing the fixture lock raises.
- Terminating only the fixture runtime's retained PostgreSQL fence session causes engine exit `1`; a clean subsequent runtime can start.

Schema snapshots normalize PostgreSQL's randomized dump guard tokens. Table snapshots also include tuple `xmin`, so an update that rewrites identical values is detected. Evidence contains check names, timings and digests; fixture API credentials and raw database contents are not exported.

These are native synthetic migration and admission checks. The legacy case starts from the verified upstream schema, not an installed older packed binary. Passing it does not establish an old-binary installation upgrade, production restore, container packaging, ingress availability, SMTP delivery or provider acceptance. Those remain separate qualification gates.

The companion standard-library unit tests exercise only the runner's rejection, owned-process cleanup, admission and report-publication guards:

```sh
python3 -B -m unittest discover \
  -s deploy/newsletters/engine/migration-tests -p 'test_verify.py' -v
```

Those units mock process outcomes and start no engine or PostgreSQL. They supply no native runtime evidence. Reports are published atomically as private files without replacing an existing file or following a destination symlink. Failed or unverified lock-session cleanup fails the runner.
