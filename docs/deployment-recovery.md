# Cold recovery capture and verification

`scripts/deployment/recovery.py` captures the supported local Compose storage into an
encrypted restic repository and verifies a complete restore into a new directory. It never
stops, starts, upgrades or resumes services. Installed application recovery, independent
off-host acceptance and external key custody remain open requirements.

This first adapter supports a dedicated local Linux Docker Compose installation with the
repository's five local named volumes: `pgdata`, `miniodata`, `newsletter_uploads`,
`caddydata` and `caddyconfig`. PostgreSQL must use the ordinary data directory and have no
external tablespaces. Bind-mounted configuration must be read-only and explicitly included
in the approved configuration set. Shared PostgreSQL, remote Docker daemons, volume plugins,
writable data binds, symlinks and special source files are refused. The optional
Operations Collector can bind an empty socket directory for its local transport.

The fresh Compose qualification uses this five-volume profile. The Python recovery
API also supports a separate typed installed profile. It inventories native
PostgreSQL and object storage roots, the relay autosave, the watched ingress,
named private credentials and protected state. Its observer must hold an exact
stop witness and the restore must receive the independently admitted profile.
The stock CLI uses the Compose observer. The typed profile has fixture coverage
and still requires an installed topology observer for operational use.

## Operator sequence

1. Select and approve the installation inventory, immutable images, repository and resource
   budget. Keep a high-entropy restic password in an owned `0600` file outside the installation,
   state directory, repository and restore target. A separate readback credential file is
   required. Two local copies do not prove independent custody. Preserve an externally held
   recovery credential and qualify its retrieval separately.
2. Enter maintenance, drain and stop all writers and ingress using the reviewed installation
   procedure. This includes Web, Worker, Realtime, engine, migrators and one-off jobs,
   plus standalone Core and host monitoring writers when present. Stop PostgreSQL and
   MinIO cleanly. Feature switches and advisory locks do not provide this
   fence: tracking requests, passive outbox maintenance and existing upload URLs can write.
3. Run `capture` using the actual inventory and a new private state directory and restore
   target. The tool independently inspects Docker and `pg_controldata`; a plan's claim that
   processes stopped is never accepted as evidence. It checks exact container/image IDs,
   all project containers, exclusive named-volume ownership, the PostgreSQL bridge and
   alias, actual resolver/hosts files and clean shutdown. Host mappings, custom DNS and
   ambiguous client network modes hold the operation. It hashes the actual files before
   and after capture and verification.
4. Read the retained result. A verified snapshot has a full repository ID, full snapshot ID,
   manifest hash and unchanged-source witness. It has passed uncached repository integrity
   reading, exact snapshot-membership checks and a restore with content, mode and ownership
   verification. Its original `verifiedAt` is retained on repeated reads.
5. Keep services and external effects held. Booting restored services, object/credential
   checks, consent/access revocations and ambiguous provider submissions must be reconciled
   before any writer-resumption decision. This tool never authorizes that decision.

An example command, after preparing the actual installation and approved repository:

```sh
python3 -B scripts/deployment/recovery.py capture \
  --plan /private/recovery/installation-plan.json \
  --state /private/recovery/operation-a \
  --restic /usr/local/bin/restic \
  --repository sftp:backup@backup.example:/warpdrive \
  --password-file /private/keys/backup-password \
  --readback-repository sftp:backup@backup.example:/warpdrive \
  --readback-password-file /private/readback/backup-password \
  --restore-target /private/restore/operation-a \
  --docker /usr/bin/docker \
  --pg-controldata /usr/lib/postgresql/16/bin/pg_controldata
```

The repository must already exist. The tool never initializes a production repository,
changes SSH trust, disables TLS, runs a shell credential hook, unlocks, prunes or deletes
backups. SFTP authentication and host-key trust must already be configured. No credentials,
raw environment or command stderr enter stdout or the public receipt. The private state
directory contains sensitive effective configuration and recovery metadata and must remain
protected.

## Restore when the source host is unavailable

Retain the private verified receipt and canonical `recovery-manifest.json`, the independently
recorded SHA256 of the receipt, the exact original absolute snapshot member name for the
manifest and a separate readback credential. The original member name is a label in the
encrypted snapshot. Its original host path can be absent during restore.

```sh
python3 -B scripts/deployment/restore_recovery_set.py \
  --receipt /private/readback/verified-receipt.json \
  --receipt-sha256 "$WARPDRIVE_RECOVERY_RECEIPT_SHA256" \
  --manifest /private/readback/recovery-manifest.json \
  --original-manifest-member /var/lib/warpdrive/recovery/operation-a/recovery-manifest.json \
  --restic /usr/local/bin/restic \
  --repository sftp:backup@backup.example:/warpdrive \
  --readback-password-file /private/readback/backup-password \
  --restore-target /private/restore/operation-a \
  --limits /private/readback/limits.json
```

The limits document uses the same complete object as the capture plan. The reader checks
the exact repository, snapshot, embedded manifest and captured file inventory, then
verifies bytes, mode and ownership in a new quarantine. Keep that quarantine private.
Application startup and writer resumption require their own acceptance.

For Operations monitoring, add `--monitor-handoff /private/readback/restore-handoff.json`
and `--operations-installation-id "$WARPDRIVE_OPERATIONS_INSTALLATION_ID"` to the
restore command. The verifier writes the handoff to a new private file only after
verification succeeds. Record its SHA-256 on the verifier host and carry that pin
through the trusted handoff with the independently recorded cold receipt pin.
The handoff contains opaque identifiers, completion time, byte counts and digests.
The verifier needs neither the collector socket nor the reporter signing key.

An enrolled `recovery_verifier` source submits the handoff from the collector host.
Use a private reporter configuration and an owned 0700 outbox dedicated to its
source generation. Transfer the handoff as an owned 0400 or 0600 file.

```sh
python3 -B scripts/deployment/recovery_restore_monitor.py report \
  --handoff /private/recovery-reporter/restore-handoff.json \
  --handoff-sha256 "$WARPDRIVE_RESTORE_HANDOFF_SHA256" \
  --receipt-sha256 "$WARPDRIVE_RECOVERY_RECEIPT_SHA256" \
  --config /private/recovery-reporter/config.json \
  --outbox /private/recovery-reporter/outbox
```

If acknowledgement is uncertain, use `--retry-pending` in place of `--handoff`
with the same SHA-256 pins. The outbox keeps the exact pending sequence until the
collector accepts it. Maintenance displays this result as **Restore bytes verified**.
Application restore acceptance, off-host delivery, key custody and permission to
resume writers each require their own evidence.

The opt-in PostgreSQL fixture starts the restored cluster on a different local
listener with the source paths unavailable. It exercises Warpdrive's credential
decryption, pg-boss job readback and newsletter receipt admission against that
cluster. The pending job stays unclaimed, an unknown newsletter operation stays
unresolved, and the restored runtime role is denied DDL. The fixture also verifies
the restored newsletter media bytes and rejects an incorrect encryption key.

On Darwin arm64, the same fixture can include a checksum-pinned Silo executable from
`RELEASE.2026-10-26T00-00-00Z`. Set `WARPDRIVE_RECOVERY_POSTGRES_FIXTURE=1`,
`WARPDRIVE_RECOVERY_SILO_BIN` to the absolute executable path and
`WARPDRIVE_RECOVERY_SILO_SHA256` to its verified digest. Run the
`test_recovery_postgres.py` suite from `scripts/deployment`. Both Silo processes bind
only to loopback. The test captures the stopped object store in the same encrypted
snapshot, then proves restored attachment bytes and metadata through the application's
download path, including anonymous and cross-actor denial. The fixture uses synthetic
Silo root credentials. Installed credentials, Linux runtime and SSE/KMS remain separate
qualification gates.

Add `WARPDRIVE_RECOVERY_ENGINE_BIN` and `WARPDRIVE_RECOVERY_ENGINE_SHA256` for
the checksum-pinned, patched Darwin arm64 Listmonk build to include the newsletter
Engine. The same source cluster then contains the CRM and Engine databases, and
the Engine uploads real media to the captured newsletter volume. Stop the source
Engine, Silo and PostgreSQL before taking the single encrypted snapshot. From the
independently restored data, boot the Engine in passive mode on its own loopback
listener, using the restored restricted database role and API credential. The
fixture rebinds only its local endpoints and media path, and makes a scheduled
fixture campaign overdue. It verifies the restored media and suppression, the
unchanged unknown Engine delivery receipt, and that a confirmed recipient's
campaign stays scheduled beyond a full scan interval. The real Engine negotiates
with the local SMTP sink, which records no message transaction. The fixture does
not contact a provider or resume campaign delivery.

The local readback fixtures use different Restic passwords and verify distinct key
slots. They revoke the writer slot before independent restore. A separate fixture
copy also verifies that revoking the reader slot leaves the writer usable. These
fixtures use one local host and filesystem. Installed off-host storage and
independent key custody have their own acceptance checks.

The [newsletter restore smoke](../scripts/newsletters/restore-smoke.py) uses the
patched Engine, loopback PostgreSQL and Mailpit. It stops the source Engine before
dumping the databases and archiving media. The restored passive Engine serves the
original media and retains suppression. An overdue campaign with a confirmed
recipient remains scheduled across a full campaign scan interval, the CRM's
unknown operation stays unresolved, and Mailpit remains empty.

## Public availability observation

Run `python3 -B scripts/deployment/check_public_availability.py app.example.com`
from an independently operated host. Each invocation makes one bounded,
certificate-validated HTTPS health request and emits one timestamped JSON
observation. The exit status is 0 for healthy, 1 for observed failure and 2 for
unknown. Throttling and local probe failure are unknown. Keep the observation
and alerts on the observer host so an installation outage cannot suppress them.
For a periodic check, add `--state-dir /private/availability` using an existing
owned 0700 directory on that host. Two consecutive failures open one incident
by default, and two consecutive healthy observations close it. A gap over three
minutes resets the streak and expires the prior status. Uncertain observations
keep an open incident unresolved. The output includes the latest
transition and its timestamp so an independent alert runner can deduplicate it.
The exit status describes the latest raw observation. The observer account can
run the combined command once a minute to sample and attempt one delivery.
Use a private 0600 or 0400 JSON destination configuration with `url` and `token`.
Use `null` if the destination needs no bearer token.

```sh
python3 -B scripts/deployment/public_availability_tick.py app.example.com \
  --state-dir /private/availability --config /private/availability/alerts.json
```

The combined command attempts one delivery even if recording the observation
fails. It emits the sample, recording, delivery and staleness statuses. Exit 1
indicates observed failure or held delivery. Exit 2 indicates an unknown or
stale observation or a recording failure when delivery was successful or idle.
Run a separate consumer on the observer host to drain events if the probe stops.

```sh
python3 -B scripts/deployment/check_public_availability.py read app.example.com \
  --state-dir /private/availability
python3 -B scripts/deployment/check_public_availability.py ack app.example.com \
  --state-dir /private/availability --event-id "$ACCEPTED_EVENT_ID"
```

Run the delivery command on the observer host after configuring the separate
HTTPS alert destination.

```sh
python3 -B scripts/deployment/deliver_public_availability.py app.example.com \
  --state-dir /private/availability --config /private/availability/alerts.json
```

The command sends the oldest pending event with its stable `Idempotency-Key`.
The endpoint must deduplicate that key and return HTTP 200 or 202 with
`{"accepted":true,"eventId":"<same key>"}` after accepting the event durably.
A timeout or mismatched reply keeps the event queued for the same ID on the next
run. The queue holds 64 transitions and preserves them if another would overflow
it. Schedule the probe and delivery independently so delivery can drain pending
events during a target or probe outage. Delivery exits 1 when held and 2 when
the observer is stale after delivery or an empty read. Configure the scheduler
to surface those failures on the observer host. The local TLS fixture verifies
the protocol with an isolated receiver. Independent host and destination setup
are required for installed acceptance.

## Inventory and retained identity

The plan has exactly these fields:

- `schemaVersion: 1`, `kind: "warpdrive-cold-recovery-set"`;
- bounded `operationId`, `installationId` and Compose `project`;
- `containers`, keyed by actual supported Compose service, containing full 64-character
  container IDs and immutable `sha256:` image IDs; all long-running services are mandatory,
  and every existing migration/one-off container must also be included;
- `volumes`, mapping `postgres`, `objects`, `newsletterMedia`, `ingressData` and
  `ingressConfig` to the actual exclusive Docker volume names;
- `configurationFiles`, the approved absolute configuration/accepted-artifact/journal paths;
- the full authenticated restic `repositoryId` and complete `limits`.

The source inventory includes whole cold PostgreSQL storage, including all databases,
roles/grants, pg-boss and migration/engine receipts; MinIO state; newsletter media; ingress
state; approved configuration and accepted artifacts/journals. It also captures actual Docker
runtime configuration and resolves mounted `_FILE` inputs, including database credentials,
`TOKEN_ENCRYPTION_KEY`, `AUTH_SECRET`, OAuth/WS/webhook keys and provider configuration.
The observer refuses overlapping bind and volume sources on containers outside the installation.
The Core database DSN must resolve to the observed PostgreSQL service; an unrelated local volume
cannot stand in for an external database. Authority-affecting Core URI query options are
refused. If a standalone Core container exists, include its exact stopped identity and
runtime database configuration in the plan. Host-based writers require a separate stop
witness. For the optional Compose Operations Collector, include its exact stopped
identity and approved private read-only configuration bind. Its database must use the
same observed bridge. Leave its dedicated socket directory empty and outside the
captured roots. Keep the reporter outbox with its generation in the protected recovery
inputs if a reporter is installed. Listmonk key normalization and aliases are checked, and its effective
`LISTMONK_db__params` must be explicitly empty so a configuration-file fallback cannot change
the database authority. Unknown legacy configuration holds the operation before capture.

The adapter does not yet inspect the restored application databases for external campaign
S3 media or KMS dependencies, prove logical ownership of every historic database, boot
PostgreSQL/MinIO/engine/application images in isolated restored volumes, decrypt actual stored
credentials, or reconcile object references and provider receipts. Therefore
`applicationRecoveryAccepted` remains false. Only reviewed installations whose external
dependencies are independently inventoried can qualify a complete recovery set.

The current plan schema covers the five named Compose volumes. The private installed
Web slots and relay require a separate inventory profile. That profile needs exact
slot and relay identities, both bridge memberships, stopped writer evidence under
the release locks, and the accepted Caddy autosave and application-specific ingress
route. Keep the empty relay socket directory outside the captured roots. Verify
installed object storage and newsletter media from their actual mount inventories.
`installed_cold_web_recovery.py` combines the exact stopped Web slots, relay and
scoped Traefik route into one read-only witness under the existing release locks.
It checks both Docker bridges and rejects duplicate aliases or external writable
mounts. It returns the autosave and six named secret-file paths plus the pinned
ingress route bytes for a separate protected copy. It needs a complete native
inventory and an enclosing hold on host writers. The typed capture API requires
that witness alongside the complete storage, writer and ingress inventory. An
operational observer for that complete installed topology remains to be qualified.

Local filesystem repositories are admitted for rehearsal only. Even for an SFTP destination,
readback from the same machine cannot establish an independently observed off-host result.
The receipt always retains `offHostAccepted: false` and `keyCustodyAccepted: false` until a
separate installation acceptance process exists. No local path copy is represented as
off-host recovery.

## Failures and reconciliation

The private journal uses an exclusive lock, immutable fsynced phase files, a contiguous
checksum chain and exact plan/manifest binding. The checksums protect accidental integrity;
they are not signatures or an append-only storage service. Protect the journal's host and
parent directory from modification by other users.

`BACKUP_INTENT` is durable before restic can write. Any failure after intent is `UNKNOWN`.
An interrupted capture is never automatically repeated, even when no snapshot is currently
visible. Run `reconcile` with the same plan/state, the same approved repository and a new
restore target. It reads the operation's exact tag, requires one full snapshot whose encrypted
manifest matches the retained source, and verifies it without another backup call. Missing,
ambiguous, changed or corrupted state holds the operation. Partial restore directories remain
quarantined; the tool never overwrites or removes them.

Preparation failures can leave private metadata without a backup intent. Preserve that record
for diagnosis and prepare a new operation/state directory after resolving the cause. Do not
delete an unknown intent merely to obtain another attempt.

## Resource and implementation boundaries

The initial envelope admits at most 100,000 entries, 16 TiB of source data, 64 GiB per file
by default, and an explicit operation deadline of at most 24 hours. The selected plan normally
uses smaller limits. It also declares repository-read and restore-disk reserves. Unknown
capacity holds the operation. Hashing cold storage before and after capture adds reads and
downtime; these costs must be measured for the selected installation.

Processes use two Go scheduling threads, a 256 MiB Go memory target, a separate 768 MiB sampled
process-group RSS watchdog, bounded stdout/stderr, a global operation deadline and an owned
process group. Restic uses one file reader, no local cache and 16 MiB/s transfer limits. The Go
memory target and sampled watchdog are not a cgroup reservation or a production capacity
guarantee.

Local repository and restore-parent paths are opened without following symlink ancestors;
their directory descriptors remain held through mutation. Linux child commands receive the
pinned repository through `/proc/self/fd/N` and the restore target through the raw absolute
string `/proc/self/fd/N/.`. The final `/.` makes restic inspect the held directory rather
than the terminal procfs symlink; it must not be normalized through `Path` or `resolve`.
There is no replaceable child component or real-path fallback. The local synthetic macOS
test uses checked private-parent paths and does not qualify that Linux path mechanism.

Direct-root regular files in the authenticated manifest receive exact rooted, literal-safe
exclusions from the bulk restore. Their exact snapshot membership, size, mode and ownership
are checked before any payload write. Each is then read with `restic dump` using its original
path and immutable snapshot ID. The parent opens a new `0600`, exclusive, no-follow regular
file relative to the held target descriptor and streams at most 64 KiB per chunk while
counting bytes and SHA256. It requires exact length, digest, command success and all resource
guards before applying and checking ownership/mode and fsyncing the file and directory.
Existing output objects are never followed or truncated. Large file limits are unchanged;
file contents are not buffered to the file-size limit, and PostgreSQL trees remain bulk
restores. The complete manifest/inventory and unchanged captured source are verified after
both restore paths; partial files remain quarantined on any failure.
`separateCredentialFileReadback` records a separate file and uncached repository read, not
independent credentials, operators or physical custody. Different existing restic passwords
are allowed when both authenticate the same fixed repository.

This adapter uses the installed restic **0.18.0** command contract. It requires encrypted
repository format 2 and relies on restic's authenticated repository data, rather than custom
cryptography. See the versioned primary documentation for the
[repository format](https://restic.readthedocs.io/en/v0.18.0/100_references.html),
[backup identity](https://restic.readthedocs.io/en/v0.18.0/040_backup.html) and
[isolated restore](https://restic.readthedocs.io/en/v0.18.0/050_restore.html).

The opt-in synthetic crypto test uses a task-owned local repository, random synthetic data,
two local password files and an isolated restore target. It checks encrypted storage,
wrong-password rejection, tampered-ciphertext rejection and exact restored members. It does
not establish off-host storage, cold Docker behavior or installation recovery.

Fixture file writes require an owned private ancestor and use pinned, no-follow directory
and regular-file descriptors. Files have mode `0600` before any payload is written; symlinks
and multiply linked files are refused before truncation. The fixture still intentionally
writes generated markers and disposable restic password files in clear text so the real
encryption and readback contract can be tested. These are generated-only test inputs, not
installation credentials, and their private temporary root is removed by cleanup. This
permission boundary does not establish physical erasure or make a pending CodeQL finding
resolved without a new exact-source security analysis.

A failed restic operation retains a finite operation/reason category and numeric process
status in its private `UNKNOWN` journal record. Raw command output, arguments, keys and
configuration are excluded from that diagnostic. The category does not establish whether
a snapshot was committed: independent manifest-bound reconciliation is still required and
the backup write is never automatically repeated.

The native Linux fixture runs a separate bounded descriptor-target diagnostic before the
full encrypted roundtrip. It uses another generated source, key, repository and isolated
target; checks that the descriptor still refers to its reserved directory; and observes
actual restic output in memory for a fixed root-removal failure signature. Reports retain
only booleans and finite failure facts. A failed restore may have written target children;
the owned target stays quarantined until fixture cleanup. The diagnostic additionally
requires an actual restore through the raw `/.` locator with bytes, modes and ownership
verified at the held inode. Another actual restore replaces both the admitted target name
and its parent with symlinks after argument admission: writes must stay at the held inode,
captured source bytes must stay unchanged, and the post-command path check must reject the
substitution. These controls do not replace the full encrypted roundtrip or establish
installation recovery.

The same native compatibility gate must also restore a generated file directly under the
snapshot's `/`, with bytes, mode, ownership and held-inode identity verified. Restic's
`--stdin --stdin-filename` creates that snapshot without writing to the host's `/`.
Root-level configuration files remain admitted; they are not rejected to make a smaller
fixture pass. Upstream restic normalizes a root file's parent back to the bare descriptor
path even when the target uses `/.`, which is why those exact files use the descriptor-owned
streaming path. The required root-file/mixed-descriptor gate and full encrypted fixture
passed in [Linux run 43152511497](https://github.com/KhademOHAli1/warpdrive/actions/runs/43152511497)
at source `4686be5e5957c4e5a3580c2935fd7a11807eeb2a` and tested merge
`b98a12d57030c849afc021f21e5cf1a2c36d9ce0`. The API-digest-verified artifact and all four
source pins are retained in `docs/deployment-evidence/recovery-linux-4686-20261112.json`.
It records 59 executed passing tests, two explicit opt-in skips in the guard stage,
53.596 seconds, sampled peak RSS 130,449,408 bytes and zero remaining owned processes.
This closes the corrected-source Linux gate at that revision; off-host storage, key custody,
coordinated restored applications and installed acceptance remain open.

The hosted-only mixed-snapshot fixture also includes literal glob characters, a trailing
backslash, punctuation, spaces, Unicode, an empty root file, a nested file with the same
basename and a directory that a wrongly escaped pattern would match. One actual snapshot
contains all members; exact metadata and complete restored bytes are required. A private
owned chroot produces it with the verified static restic binary, fixed GNU `--userspec`,
and an actual static identity probe before backup. Each privileged launch has a fixed GNU
timeout (3 seconds, then a 1-second kill grace); its exact handle must terminate. An actual
timeout probe runs before backup, and unknown cleanup authority or remaining processes
fails the fixture. No mount, service, network operation or host-root file write is needed.
Source bytes stay within 2 MiB and binary scratch within 64 MiB under the unchanged outer
90-second/1-GiB watchdog. This remains synthetic source qualification, not installed recovery.
