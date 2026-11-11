# Newsletter installation evidence and operations

Use this worksheet for the two remaining installation gates in the newsletter implementation plan. Version 1.6.1 records qualified source and isolated runtime evidence. This runbook prepares later operational qualification. Every live gate below starts **Pending**.

The current retained local preflight used loopback SMTP capture, disabled SES feedback and closed public signup. Its readiness result establishes that local configuration. The selected provider, sending domain, authorized inbox and target installation are pending.

## Installation worksheet

Keep an installation-specific copy in the approved evidence destination. Record references to protected credentials and provider records. Keep secret values, authentication headers, signed confirmation links and mailbox content out of shared receipts.

| Input                                                                          | Value or protected reference   |
| ------------------------------------------------------------------------------ | ------------------------------ |
| Change/evidence ID, operator and UTC window                                    | Pending                        |
| Target installation, environment and owner                                     | Pending                        |
| Installed app revision, engine image/binary and corresponding source digest    | Pending                        |
| Sending provider, account/project identity and authorized operator             | Pending                        |
| Region or documented provider-specific equivalent                              | Pending                        |
| Authorized sending domain and sender identity                                  | Pending                        |
| Dedicated public newsletter HTTPS host, CRM host and engine Root URL           | Pending                        |
| Authorized test inbox and exact `NEWSLETTER_TEST_RECIPIENTS` entry             | Pending                        |
| Relay endpoint, port, TLS/authentication policy and credential-store reference | Pending                        |
| Feedback adapter and account/topic/configuration references, where applicable  | Pending                        |
| Media backend, filesystem root or bucket/prefix and versioning policy          | Pending                        |
| Existing alert/log destination, receiver and worker/ingress health checks      | Pending                        |
| Protected backup destination, access owner, retention and restore target       | Pending                        |
| CRM/engine database connection-profile references and encryption-key custody   | Pending                        |
| Public signup activation decision and authorized delivery decision             | Pending; signup remains closed |

For a provider without regions, record the applicable account scope and that provider's stated equivalent. Configure the provider through its selected account procedure. Complete the target selection and profile/path variables before running any command template below.

## Proof to retain

For each row record the installation, app/engine revisions, UTC time, operator, result and evidence reference. Retain sanitized output hashes alongside protected original records. A result becomes Passed only after its stated live check has run.

| Gate                                   | Expected proof                                                                                                                                                                          | Retained reference and live result                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Installed engine and permissions       | Private engine capabilities, database migration state, app connection, intended delegated permissions and anonymous public admin/API rejection                                          | Pending                                           |
| Sending identity and public host       | Provider-approved sender/domain records, required DNS verification, HTTPS certificate, exact Root URL and protected signup configuration                                                | Pending                                           |
| Authorized inbox delivery              | Approved test recipient, exact campaign/audience revision, SMTP acceptance receipt and actual received message headers/body with sender authentication and intended Reply-To            | Pending                                           |
| Confirmation and one-click unsubscribe | Public GET leaves consent pending; affirmative confirmation updates the exact purpose; a delivered one-click unsubscribe revokes that grant and reaches the native consent history      | Pending                                           |
| Public media                           | A known campaign asset resolves anonymously at its stable URL with expected content type and bytes                                                                                      | Pending                                           |
| Bounce and complaint feedback          | Selected authenticated adapter, exact delivery match, persisted feedback, hard-bounce/complaint suppression and corresponding native revocation; retain soft-bounce behavior separately | Pending                                           |
| Relay credential rotation              | Old credential rejected after revocation, new credential accepted after engine reload, readiness transition timestamps and authentication-only protocol evidence                        | Pending                                           |
| Alerts and process health              | Outage alert received at the selected destination, deduplicated repeated state, recovery resolves that incident, and separate worker/ingress health alert receipt                       | Pending                                           |
| Coordinated backup and restore         | CRM dump, engine dump, media/object versions, migration/revision and receipt inventories, checksums, isolated passive restore and content/state comparisons                             | Pending                                           |
| Upgrade and rollback                   | Matching pre-upgrade restore set, passive old/new engine observation, preserved current suppression and unresolved delivery records, reconciliation before any resumption               | Pending                                           |
| Activation                             | Recorded decision for the qualified installation, reviewed schedules/limits and exact flag changes                                                                                      | Pending; `NEWSLETTER_PUBLIC_SIGNUP_ENABLED=false` |

Limit recipient proof to the authorized inbox or provider-approved simulator allowlist. Use a private test audience or a native Person consent invitation, with wider campaigns paused. Existing confirmation and unsubscribe routes remain available while public signup stays closed.

For SES, use the signed feedback endpoint and settings described in [Campaigns setup](newsletters.md#ses-feedback-and-delivery-receipts). The custom SNS adapter serves SES. For another provider, record its supported authenticated feedback path or the missing adapter. Keep the feedback gate Pending until the selected account's delivery, bounce and complaint paths are demonstrated.

## Readiness and logs

An administrator can read **Settings → Maintenance** through `newsletter.read` operation `admin.readiness` with empty input. The private engine contract is authenticated `GET /api/warpdrive/readiness`, requiring `settings:get`. It returns a `data` envelope containing the following fields.

| Field                            | Contract                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ready`                          | Boolean combining database, scheduler, relay, media and feedback readiness                                       |
| `database.status`                | `ready`, `unavailable` or `migration_required`                                                                   |
| `scheduler.status`, `lastScanAt` | `ready`, `starting`, `stale` or `passive`; nullable ISO timestamp                                                |
| `relay.status`, `checkedAt`      | `ready`, `unconfigured` or `unavailable`; nullable ISO timestamp                                                 |
| `media.status`, `checkedAt`      | `ready`, `unavailable` or `unchecked`; nullable ISO timestamp                                                    |
| `feedback.status`, `lastEventAt` | `disabled`, `configured` or `confirmed`; nullable ISO timestamp                                                  |
| `limits`                         | `workers`, `perWorkerMessagesPerSecond`, `messagesPerSecond`, `batchSize`, `queueCapacity` and Boolean `clamped` |

The SMTP probe negotiates the configured transport, TLS and authentication and issues NOOP. It issues no MAIL, RCPT or DATA command. Relay and media probes cache their results for 20 seconds. Filesystem media probing creates, reads and removes a temporary probe file. S3 probing uses an authenticated HEAD against an existing sample.

For a private readback, put the engine authentication in an operator-owned mode-0600 curl configuration. Set the variables below to its path, the approved internal origin and a protected output path. Run with shell tracing disabled.

```sh
set -eu
curl --disable --config "$newsletter_curl_config" \
  --silent --show-error --fail --max-time 10 \
  "$newsletter_engine_origin/api/warpdrive/readiness" \
  > "$newsletter_readiness_evidence"
```

While passive, expect `scheduler.status=passive` and `ready=false`; inspect the component results. A successful authentication probe qualifies relay access. Retain inbox evidence separately for delivery.

The worker checks readiness during its initial reconciliation run and scheduled minute reconciliation, after Workflow and identity work. It emits one JSON line per readiness fingerprint transition when delivery is enabled and the integration is configured. An unavailable relay with otherwise healthy non-SES components produces this stderr event.

```text
{"event":"newsletter.delivery.readiness","level":"warn","readiness":"ready/ready/unavailable/ready/disabled"}
```

Recovery produces this stdout event.

```text
{"event":"newsletter.delivery.readiness","level":"info","readiness":"ready"}
```

Other outage fingerprints join database/scheduler/relay/media/feedback statuses in that order. A failed readiness request produces `unreachable`. Repeated identical states produce no heartbeat. A worker restart resets its prior state to ready and can emit the current outage again. Disabled or unconfigured installations skip the probe and event.

Route these worker stdout/stderr records through the installation's existing log monitoring. Use installation plus `event` as the incident identity, update its recorded fingerprint and deduplicate repeats. Resolve it on `level=info` with `readiness=ready`. Retain collector timestamps, the sanitized readiness responses and destination receipt IDs. Use separate worker/process and public-ingress health alerts to cover a stopped worker or unavailable subscriber host.

**Settings → Logs** reads the audit store through `newsletter.read` operation `admin.logs`. Its optional filters are `source` (`campaigns` or `workspace`), `outcome` (`requested`, `succeeded`, `failed`, `unknown`) and `cursor` (`at` ISO timestamp and UUID `id`). The response is `{rows,next}`, with at most 30 rows from the last 90 days. Each row has `id,at,action,source,outcome,correlationId`. Use the returned cursor unchanged for the next page. Retain operation IDs and reviewed evidence references for unresolved writes. Collect readiness transitions from the worker process log destination.

## Relay credential rotation

Use the selected provider's authorized credential interface and protected engine administration. This sequence follows the retained `rotation-rollback080` synthetic evidence in the [1.6.1 qualification record](delivery/newsletter-qualification-1.6.1.json).

1. Record the window, current credential reference, relay settings excluding secrets, pending schedules and unresolved receipts. Keep signup closed. Hold campaign starts, invitations and imports that send mail. Pause campaign work and disable delivery for the maintenance window.
2. Prepare a replacement credential through the selected provider. Store it in the approved secret store and record its reference.
3. Revoke the old credential at the provider. Perform a fresh engine readiness read after the probe cache expires or after a controlled restart. Retain `relay.status=unavailable` and the provider's sanitized authentication rejection evidence.
4. Apply the replacement through the private engine SMTP settings. The tested engine operation is `PUT /api/settings/smtp` with the complete approved relay array; it reloads the engine. Use protected request input or the private operator UI. Keep the credential out of shell arguments, terminal transcripts, shared JSON and command tracing.
5. Wait for reload health and a fresh `relay.status=ready` authentication probe. Retain the new credential reference, reload/revision evidence and protocol evidence showing zero SMTP envelope commands. Confirm that the revoked credential remains rejected.
6. Use a bounded alert test window. Keep every campaign paused, review due schedules, pause all mail-producing workflows/jobs, hold invitations/imports and keep public signup false. Enable delivery for the engine and monitoring worker during this window and verify that the worker is reconciling. Introduce a provider-approved authentication failure condition through the private relay settings, reload, and wait for an eligible worker sample to emit the outage event. Retain its actual destination receipt. Restore the valid replacement credential, reload, and wait for a fresh successful relay probe and the worker's recovery event to resolve the incident. Repeated identical outage samples should preserve one incident. Disable delivery again when the window ends. Direct probes during disabled delivery supply component evidence; the enabled worker window supplies alert evidence.
7. Review schedules, effective limits, consent and held delivery receipts before any separately authorized resumption. Record the outcome and leave signup closed until its activation decision.

The retained fixture exercised a loopback SMTP AUTH server and engine reload. The selected provider's credential lifecycle, account policies, alert routing and installation remain Pending.

## Coordinated snapshot

Choose a maintenance window and quiesce writes before taking the set. Pause campaign work, close signup, disable newsletter delivery and stop the app, workers and engine writers through the installation's service manager. Keep PostgreSQL running for the dumps. Include public preference/feedback availability in the maintenance plan. Record the cut and outage interval and retain external provider receipts for reconciliation after that cut.

Set `newsletter_pg_bin` to the absolute directory of the selected server major version's PostgreSQL client toolchain. Record the `pg_dump`, `pg_restore` and `psql` versions in the worksheet. Every database command below uses that explicit toolchain.

Prepare protected libpq connection profiles named `newsletter_crm_source` and `newsletter_engine_source` for the approved source databases. Use a protected service/password file or the installation's existing credential mechanism. These commands carry profile names and file paths. Confirm the selected database identities and roles before running them.

Set `newsletter_backup_dir` to a new absolute leaf directory under an existing protected parent outside the media root, and for filesystem media set `newsletter_media_root` to its quiesced upload root. The command fails if the destination already exists.

```sh
set -eu
umask 077
mkdir "$newsletter_backup_dir"
"$newsletter_pg_bin/pg_dump" --dbname=service=newsletter_crm_source --format=custom \
  --file="$newsletter_backup_dir/crm.dump"
"$newsletter_pg_bin/pg_dump" --dbname=service=newsletter_engine_source --format=custom \
  --file="$newsletter_backup_dir/newsletter.dump"
tar -C "$newsletter_media_root" -czf "$newsletter_backup_dir/newsletter-media.tar.gz" .
```

Write `snapshot.json` in the backup destination with the installation ID, cut UTC time, app/engine revisions and digests, PostgreSQL/tool versions, migration versions, media location and credential/encryption-key custody references. Record the service configuration needed to remain passive after restore.

The CRM dump contains operation receipts, identity commands/events and native attribution. The engine dump contains subscribers, suppression, consent grants/events, campaign state, recipient delivery receipts and feedback. For a current engine, retain these read-only receipt inventories with the snapshot.

```sh
"$newsletter_pg_bin/psql" --dbname=service=newsletter_crm_source -X --set=ON_ERROR_STOP=1 --csv \
  --command='SELECT state,count(*) FROM newsletter_operation_receipts GROUP BY state ORDER BY state' \
  > "$newsletter_backup_dir/crm-receipts.csv"
"$newsletter_pg_bin/psql" --dbname=service=newsletter_engine_source -X --set=ON_ERROR_STOP=1 --csv \
  --command='SELECT state,count(*) FROM warpdrive_delivery_recipients GROUP BY state ORDER BY state' \
  > "$newsletter_backup_dir/engine-receipts.csv"
```

For S3, substitute the selected backend's versioned object export and content-checksum manifest for the filesystem tar. Record the bucket/prefix and exact object versions. Keep the snapshot and keys in their approved protected destinations.

Generate a checksum file for the complete filesystem set after `snapshot.json` and the inventories are written.

```sh
python3 - "$newsletter_backup_dir" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys

root = Path(sys.argv[1])
names = ("crm.dump", "newsletter.dump", "newsletter-media.tar.gz",
         "snapshot.json", "crm-receipts.csv", "engine-receipts.csv")
lines = []
for name in names:
    digest = sha256()
    with (root / name).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    lines.append(f"{digest.hexdigest()}  {name}\n")
(root / "SHA256SUMS").write_text("".join(lines))
PY
```

Retain the approved backup destination receipt and a separately protected copy of the checksums. All artifacts include sensitive installation state.

## Passive restore and rollback

A DBA prepares two empty, isolated restore databases and maps the protected profiles `newsletter_crm_restore` and `newsletter_engine_restore` to them. Verify both destination identities and keep them separate from active databases. Verify the retained checksums from the backup directory before restoring. On a host with `sha256sum`, use the command below. macOS supplies `shasum -a 256 -c SHA256SUMS` for the same manifest.

```sh
(cd "$newsletter_backup_dir" && sha256sum -c SHA256SUMS)
```

Set `newsletter_restore_root` to a new absolute leaf directory under an existing protected parent. Select absolute paths for the compatible engine binary and mode-0600 restore configuration. The configuration must identify the isolated engine database and a loopback/private listen address. The following block creates the fresh restore directory and restores the two databases.

```sh
set -eu
umask 077
mkdir "$newsletter_restore_root"
"$newsletter_pg_bin/pg_restore" --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname=service=newsletter_crm_restore "$newsletter_backup_dir/crm.dump"
"$newsletter_pg_bin/pg_restore" --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname=service=newsletter_engine_restore "$newsletter_backup_dir/newsletter.dump"
```

For a filesystem snapshot, the tar above contains the upload root's contents. Extract them into the new `uploads/` directory. The engine loads `upload.filesystem.upload_path` from its settings table and resolves relative paths from its working directory. Update that setting in the isolated engine database, then verify the recorded absolute path before launch. This block requires a filesystem provider and one matching setting row.

```sh
set -eu
mkdir "$newsletter_restore_root/uploads"
tar -xzf "$newsletter_backup_dir/newsletter-media.tar.gz" -C "$newsletter_restore_root/uploads"
"$newsletter_pg_bin/psql" --dbname=service=newsletter_engine_restore -X --set=ON_ERROR_STOP=1 \
  --set=restore_uploads="$newsletter_restore_root/uploads" <<'SQL'
BEGIN;
WITH relocated AS (
  UPDATE settings SET value=to_jsonb(:'restore_uploads'::text)
  WHERE key='upload.filesystem.upload_path'
    AND EXISTS (SELECT 1 FROM settings
                WHERE key='upload.provider' AND value='"filesystem"'::jsonb)
  RETURNING key
)
SELECT count(*)=1 AS setting_relocated FROM relocated
\gset
\if :setting_relocated
COMMIT;
\else
DO $$ BEGIN
  RAISE EXCEPTION 'Expected one filesystem restore path setting';
END $$;
\endif
SELECT value FROM settings WHERE key='upload.filesystem.upload_path';
SQL
```

For S3, restore the selected object versions to an isolated namespace and change the restored database's `upload.s3.*` settings to that namespace and an explicit reader credential. Verify GET/HEAD access and a policy that denies writes. Replace retained production storage credentials before launch and use an isolated runtime without a production instance/workload role that could supply fallback credentials. Keep the original production media destination outside the restore engine's write authority. S3 readiness uses an authenticated HEAD against a restored sample.

Launch from the new restore root with an allowlisted environment. Review `newsletter_restore_path` as the executable search path. Inherited `LISTMONK_*` settings override configuration files, so the clean environment below supplies the intended flags and locale explicitly.

```sh
set -eu
(
  cd "$newsletter_restore_root"
  env -i PATH="$newsletter_restore_path" TZ=UTC LC_ALL=C \
    NEWSLETTER_DELIVERY_ENABLED=false NEWSLETTER_PUBLIC_SIGNUP_ENABLED=false \
    "$newsletter_restored_engine_binary" --config "$newsletter_restore_config" --passive
)
```

Keep app and workflow workers stopped until their restored database, stable encryption keys and intended database ownership/grants are checked. Readiness should show database ready and scheduler passive. Check intended restore-directory ownership and compare exact media bytes at the restore origin, memberships, suppression, pending campaigns and delivery/operation receipt states and counts. Record zero outbound message transactions during inspection. Filesystem readiness probes create temporary files only in the relocated restore directory.

For rollback, first preserve the post-upgrade databases, media and provider delivery receipts as another checksummed set. Restore the matching pre-upgrade pair and media into isolated targets, select the retained compatible app/engine binaries, and use the passive launch above. Retain the newer targets and their post-cut suppression and unresolved receipts. An older snapshot can contain earlier consent and delivery states. Reconcile subsequent opt-outs, complaints, suppressions and accepted/unknown submissions against authoritative provider records before resuming. Hold every unresolved submission for operator review. Keep signup closed.

The committed synthetic reference exercises dual-database restoration, exact media bytes, blocklist/unsubscribe preservation, an unknown CRM receipt and passive startup with an empty SMTP capture.

```sh
python3 -B scripts/newsletters/restore-smoke.py \
  --engine /path/to/derived/listmonk --mailpit /path/to/mailpit \
  --postgres-bin "$(pg_config --bindir)" --bun "$(command -v bun)"
```

The retained `rotation-rollback080` fixture additionally restored an earlier engine's due campaign in passive mode and preserved the newer database's unknown receipt and later suppression separately. The installation's coordinated backup, recovery time, provider reconciliation and live rollback evidence remain Pending.
