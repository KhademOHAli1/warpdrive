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
writable binds, symlinks and special source files are refused.

## Operator sequence

1. Select and approve the installation inventory, immutable images, repository and resource
   budget. Keep a high-entropy restic password in an owned `0600` file outside the installation,
   state directory, repository and restore target. A separate readback credential file is
   required. Two local copies do not prove independent custody. Preserve an externally held
   recovery credential and qualify its retrieval separately.
2. Enter maintenance, drain and stop all writers and ingress using the reviewed installation
   procedure. This includes Web, Worker, Realtime, engine, migrators and one-off jobs. Stop
   PostgreSQL and MinIO cleanly. Feature switches and advisory locks do not provide this
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
`TOKEN_ENCRYPTION_KEY`, `AUTH_SECRET`, OAuth/WS/webhook keys and provider configuration. The
Core database DSN must resolve to the observed PostgreSQL service; an unrelated local volume
cannot stand in for an external database. Authority-affecting Core URI query options are
refused. Listmonk key normalization and aliases are checked, and its effective
`LISTMONK_db__params` must be explicitly empty so a configuration-file fallback cannot change
the database authority. Unknown legacy configuration holds the operation before capture.

The adapter does not yet inspect the restored application databases for external campaign
S3 media or KMS dependencies, prove logical ownership of every historic database, boot
PostgreSQL/MinIO/engine/application images in isolated restored volumes, decrypt actual stored
credentials, or reconcile object references and provider receipts. Therefore
`applicationRecoveryAccepted` remains false. Only reviewed installations whose external
dependencies are independently inventoried can qualify a complete recovery set.

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
pinned repository and target through `/proc/self/fd` descriptors. The local synthetic macOS
test uses checked private-parent paths and does not qualify that Linux path mechanism.
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
the owned target stays quarantined until fixture cleanup. This diagnostic does not change
the production locator, accept a real-path fallback, or replace a successful roundtrip.
