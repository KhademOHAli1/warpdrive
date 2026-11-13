# Newsletter installation evidence and operations

Use this worksheet for the two remaining installation gates in the newsletter implementation plan. Version 1.6.1 records qualified source and isolated runtime evidence. Current source adds engine patch 085 and native CRM operational visibility; those additions require matching app and engine installation evidence. This runbook prepares that qualification. Every live gate below starts **Pending**.

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
| Current CRM operator, in-app notification preference and worker/UI access      | Pending                        |
| Protected backup destination, access owner, retention and restore target       | Pending                        |
| CRM/engine database connection-profile references and encryption-key custody   | Pending                        |
| Public signup activation decision and authorized delivery decision             | Pending; signup remains closed |

For a provider without regions, record the applicable account scope and that provider's stated equivalent. Configure the provider through its selected account procedure. Complete the target selection and profile/path variables before running any command template below.

## Proof to retain

For each row record the installation, app/engine revisions, UTC time, operator, result and evidence reference. Retain sanitized output hashes alongside protected original records. A result becomes Passed only after its stated live check has run.

| Gate                                   | Expected proof                                                                                                                                                                            | Retained reference and live result                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Installed engine and permissions       | Private engine capabilities including `operationalEvents:1`, matching app/engine migrations, app connection, intended permissions and anonymous public admin/API rejection                | Pending                                           |
| Sending identity and public host       | Provider-approved sender/domain records, required DNS verification, HTTPS certificate, exact Root URL and protected signup configuration                                                  | Pending                                           |
| Authorized inbox delivery              | Approved test recipient, exact campaign/audience revision, SMTP acceptance receipt and actual received message headers/body with sender authentication and intended Reply-To              | Pending                                           |
| Confirmation and one-click unsubscribe | Public GET leaves consent pending; affirmative confirmation updates the exact purpose; a delivered one-click unsubscribe revokes that grant and reaches the native consent history        | Pending                                           |
| Public media                           | A known campaign asset resolves anonymously at its stable URL with expected content type and bytes                                                                                        | Pending                                           |
| Bounce and complaint feedback          | Authenticated adapter, exact match, persisted feedback, hard-bounce/complaint suppression and native revocation plus Logs/bell facts; retain soft/unmatched behavior separately           | Pending                                           |
| Relay credential rotation              | Revoked credential rejected, replacement accepted after reload, actual in-app incident/recovery and repeat/restart dedupe, with all mail-producing work held and no envelope commands     | Pending                                           |
| Internal monitoring and worker health  | CRM Logs/bell outage and recovery, durable repeat/restart dedupe, operator-only visibility, no email, and Maintenance becoming stale after a stopped worker while the UI stays accessible | Pending                                           |
| Coordinated backup and restore         | CRM dump, engine dump, media/object versions, migration/revision and receipt inventories, checksums, isolated passive restore and content/state comparisons                               | Pending                                           |
| Upgrade and rollback                   | Matching pre-upgrade restore set, passive old/new engine observation, preserved current suppression and unresolved delivery records, reconciliation before any resumption                 | Pending                                           |
| Activation                             | Recorded decision for the qualified installation, reviewed schedules/limits and exact flag changes                                                                                        | Pending; `NEWSLETTER_PUBLIC_SIGNUP_ENABLED=false` |

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

### Internal CRM monitoring

The worker owns a dedicated `newsletter-operations-monitor` queue. It submits an initial job and schedules it every minute, independently of Workflow and identity reconciliation. Each job has a 45-second signal; native database work also uses bounded lock and statement timeouts. An unconfigured integration does no monitoring work. A configured integration consumes operational facts even while delivery is disabled; relay readiness monitoring is paused in that mode.

Current source requires engine capability `operationalEvents:1`, engine delivery schema migration 5 and CRM migration `0117_newsletter_operational_visibility`. The engine records terminal failures, uncertain submissions, reviewed resolutions and signed bounce/complaint facts in `warpdrive_operational_events`. The source transition and its event commit together. A campaign-locked background sweep observes retained issues and expired submitting leases without changing delivery/campaign receipts or sending messages, including in passive mode.

The worker reads authenticated `GET /api/warpdrive/operational-events?limit=100` using `settings:get`. It validates the fixed kind/reason pair, UUID, count and timestamp, then commits the native receipt, aggregate audit entry and eligible in-app notices in one CRM transaction. Only after that commit does it acknowledge the exact UUIDs through `POST /api/warpdrive/operational-events/ack`, using `settings:manage`. Each run handles at most three pages. A failed CRM transaction leaves the engine events unacknowledged. Lost responses, concurrent polls and restarts replay the same source identities; conflicting content for an existing UUID is rejected. Retain acknowledged source identities and native receipts for deduplication. No timestamp cursor discards later commits.

Each engine event contains only `id,kind,reason,count,occurred_at`, with `count=1`. GET returns at most 100 events and a `pending` flag. ACK accepts one strict `event_ids` array of 1–100 canonical UUIDs, deduplicates IDs and ignores unknown IDs; replay returns the same distinct known-ID count. Invalid or duplicate properties, invalid UUIDs and trailing JSON fail before acknowledgement. Both routes return `Cache-Control: no-store`.

These endpoints remain private and are absent from the public ingress allowlist. GET is a pure read; ACK changes transport acknowledgement only. A user's bell seen/unseen state is separate. Neither acknowledgement nor marking a notification read resolves a delivery, authorizes a resend or establishes consent.

**Settings → Logs** and the notification bell show safe aggregate facts: readiness incidents and recovery; rejected or uncertain delivery; reviewed resolutions; and bounce/complaint feedback. Only current active administrators have newsletter operational authority. Notification production and feed/unread exposure check that current authority, and the in-app preference controls bell visibility. No operational email is queued or sent, including when a stale preference requests email. There is no email alarm destination to configure. Payloads contain fixed category/reason/count values rather than recipients, campaign content, provider bodies, credentials or raw errors.

An unmatched signed feedback fact requests review only and makes no Person attribution or suppression claim. A later exact match remains a distinct fact. `provider_accepted` means actual SMTP or verified provider handoff for a previously reported issue; inbox delivery needs separate evidence. Operator acceptance/rejection retains its own reason. Repeated readiness failures preserve durable incident state across restarts. Pausing preserves an open incident, and a later ready observation records recovery once.

**Settings → Maintenance** also reads `admin.operationalStatus`, returning `status` (`current`, `stale` or `unchecked`), `checkedAt` and `lastPolledAt`. While the page is active, this CRM-only status query refreshes every 60 seconds. Both a completed worker check and a successful event sync must be no older than five minutes to show current. A missing state is unchecked; an expired or missing successful-sync timestamp is stale. Thus a stopped worker becomes visible on the accessible Maintenance page even when the engine itself remains ready. This read does not run the worker, acknowledge events or advance its timestamps. **Check again** refreshes this status and the separate engine readiness read. If the CRM or its database is unavailable, it cannot display an in-app incident; retain that availability limit in the installation evidence.

### Supplemental process evidence

The worker also emits one JSON line when a persisted readiness incident changes or recovers. An unavailable relay with otherwise healthy non-SES components produces this stderr event.

```text
{"event":"newsletter.delivery.readiness","level":"warn","readiness":"ready/ready/unavailable/ready/disabled"}
```

Recovery produces this stdout event.

```text
{"event":"newsletter.delivery.readiness","level":"info","readiness":"ready"}
```

Other outage fingerprints join database/scheduler/relay/media/feedback statuses in that order. A failed readiness request produces `unreachable`; an unavailable or invalid operational feed produces `events_unavailable`. Repeated identical states and worker restarts do not duplicate a persisted incident. Ordinary samples update the stored check time without another notice or JSON transition line.

Retain stdout/stderr JSON and sanitized readiness responses as supplemental technical evidence. Existing process-log collection can retain these records; an external alert receiver or email alarm is not an installation gate. Qualify the actual CRM Logs/bell incident and recovery, and the Maintenance worker-staleness behavior. Check public HTTPS/ingress availability separately in the public-host gate.

**Settings → Logs** reads the audit store through `newsletter.read` operation `admin.logs`. Its optional filters are `source` (`campaigns` or `workspace`), `outcome` (`requested`, `succeeded`, `failed`, `unknown`) and `cursor` (`at` ISO timestamp and UUID `id`). The response is `{rows,next}`, with at most 30 rows from the last 90 days. Each row has `id,at,action,source,outcome,correlationId` and optional validated operational `detail` containing `category,reason,count`. Raw audit payloads are excluded. Use the returned cursor unchanged for the next page. Retain operation IDs and reviewed evidence references for unresolved writes.

## Relay credential rotation

Use the selected provider's authorized credential interface and protected engine administration. This sequence follows the retained `rotation-rollback080` synthetic evidence in the [1.6.1 qualification record](delivery/newsletter-qualification-1.6.1.json).

1. Record the window, current credential reference, relay settings excluding secrets, pending schedules and unresolved receipts. Keep signup closed. Hold campaign starts, invitations and imports that send mail. Pause campaign work and disable delivery for the maintenance window.
2. Prepare a replacement credential through the selected provider. Store it in the approved secret store and record its reference.
3. Revoke the old credential at the provider. Perform a fresh engine readiness read after the probe cache expires or after a controlled restart. Retain `relay.status=unavailable` and the provider's sanitized authentication rejection evidence.
4. Apply the replacement through the private engine SMTP settings. The tested engine operation is `PUT /api/settings/smtp` with the complete approved relay array; it reloads the engine. Use protected request input or the private operator UI. Keep the credential out of shell arguments, terminal transcripts, shared JSON and command tracing.
5. Wait for reload health and a fresh `relay.status=ready` authentication probe. Retain the new credential reference, reload/revision evidence and protocol evidence showing zero SMTP envelope commands. Confirm that the revoked credential remains rejected.
6. Use a separately authorized, bounded authentication-only monitoring window. Keep every campaign paused, review due schedules, hold all mail-producing workflows/jobs and invitations/imports, verify no queued or in-flight engine messages, and keep public signup false. The dedicated operational queue must run while all mail-producing work remains held. For relay monitoring, `NEWSLETTER_DELIVERY_ENABLED=true` also activates the engine scheduler; permit that change only after verifying every hold. Introduce a provider-approved authentication failure through private relay settings, reload, and wait for an eligible worker sample. Retain the actual CRM Logs incident and the bell notice for a current operator with in-app notifications enabled. Repeated samples and a controlled worker restart must preserve one incident. Restore the valid replacement credential, reload, and retain the fresh successful relay probe plus the in-app recovery. Verify that a replay creates no duplicate notice and that SMTP evidence contains zero MAIL, RCPT and DATA commands. Disable delivery again when the window ends. Direct probes during disabled delivery supply component evidence; the worker window supplies the internal incident/recovery proof.
7. Review schedules, effective limits, consent and held delivery receipts before any separately authorized resumption. Record the outcome and leave signup closed until its activation decision.

The retained fixture exercised a loopback SMTP AUTH server and engine reload. It does not qualify this newer in-app path on a live installation. The selected provider's credential lifecycle, account policies and installed internal incident/recovery checks remain Pending.

## Coordinated snapshot

Choose a maintenance window and follow the [write fence in the recovery overview](newsletters.md#backup-upgrade-and-restore). Keep PostgreSQL running for the dumps. Include public preference and feedback availability in the maintenance plan. Record the cut and outage interval and retain external provider receipts for reconciliation after that cut.

### S3 media hold

For an S3-backed newsletter installation, keep the coordinated backup, restore and rollback gates pending until you qualify a procedure for the selected backend. It must capture exact object versions at the same cut as both database dumps, retain a verifiable version and content-checksum manifest, and verify the restored objects in a separate namespace. Reconfigure the restored engine with an explicit reader credential for that namespace and verify that it cannot use retained production credentials or a fallback workload role. Verify read access, write denial and exact sample bytes before qualifying passive restore. Use the backend's reviewed procedure for those steps.

### Filesystem media snapshot

The archive, checksum and restore commands below apply to installations whose newsletter engine uses the filesystem media provider. Include CRM object storage in the recovery set through its own qualified procedure, even when the newsletter engine uses a filesystem volume.

Set `newsletter_pg_bin` to the absolute directory of the selected server major version's PostgreSQL client toolchain. Record the `pg_dump`, `pg_restore` and `psql` versions in the worksheet. Every database command below uses that explicit toolchain.

Prepare protected libpq connection profiles named `newsletter_crm_source` and `newsletter_engine_source` for the approved source databases. Use a protected service/password file or the installation's existing credential mechanism. These commands carry profile names and file paths. Confirm the selected database identities and roles before running them.

Set `newsletter_backup_dir` to a new absolute leaf directory under an existing protected parent outside the media root. Set `newsletter_media_root` to the host path of the engine's quiesced upload directory. Resolve it from the engine's effective upload path and volume or bind mount. Confirm it points to the actual mounted storage. The command checks the engine's configured provider and refuses an existing destination.

```sh
set -eu
umask 077
media_provider=$("$newsletter_pg_bin/psql" --dbname=service=newsletter_engine_source \
  -X --set=ON_ERROR_STOP=1 -tA \
  --command="SELECT value #>> '{}' FROM settings WHERE key='upload.provider'")
if [ "$media_provider" != filesystem ]; then
  printf '%s\n' 'Filesystem snapshot requires the filesystem media provider.' >&2
  exit 1
fi
test -d "$newsletter_media_root"
mkdir "$newsletter_backup_dir"
"$newsletter_pg_bin/pg_dump" --dbname=service=newsletter_crm_source --format=custom \
  --file="$newsletter_backup_dir/crm.dump"
"$newsletter_pg_bin/pg_dump" --dbname=service=newsletter_engine_source --format=custom \
  --file="$newsletter_backup_dir/newsletter.dump"
tar -C "$newsletter_media_root" -czf "$newsletter_backup_dir/newsletter-media.tar.gz" .
```

Write `snapshot.json` in the backup destination with the installation ID, cut UTC time, app/engine revisions and digests, PostgreSQL/tool versions, migration versions, media location and credential/encryption-key custody references. Record the service configuration needed to remain passive after restore.

The CRM dump contains operation receipts, identity commands/events, native attribution, `newsletter_operational_state`, `newsletter_operational_receipts`, audit entries, stored in-app notices and notification preferences. The engine dump contains subscribers, suppression, consent grants/events, campaign state, recipient delivery receipts, feedback and the `warpdrive_operational_events` outbox with acknowledgement/source-dedupe metadata. Preserve this matching pair so a restored ACK cannot hide a lost native projection or recreate notices already consumed. For the current app/engine schema, retain these read-only summaries with the snapshot; exact identities remain in the protected dumps.

```sh
set -eu
umask 077
"$newsletter_pg_bin/psql" --dbname=service=newsletter_crm_source -X --set=ON_ERROR_STOP=1 --csv \
  --command='SELECT state,count(*) FROM newsletter_operation_receipts GROUP BY state ORDER BY state' \
  > "$newsletter_backup_dir/crm-receipts.csv"
"$newsletter_pg_bin/psql" --dbname=service=newsletter_engine_source -X --set=ON_ERROR_STOP=1 --csv \
  --command='SELECT state,count(*) FROM warpdrive_delivery_recipients GROUP BY state ORDER BY state' \
  > "$newsletter_backup_dir/engine-receipts.csv"
"$newsletter_pg_bin/psql" --dbname=service=newsletter_crm_source -X --set=ON_ERROR_STOP=1 --csv \
  --command='SELECT fingerprint,incident_open,problem,last_polled_at,checked_at FROM newsletter_operational_state ORDER BY engine_key' \
  > "$newsletter_backup_dir/crm-operational-state.csv"
"$newsletter_pg_bin/psql" --dbname=service=newsletter_crm_source -X --set=ON_ERROR_STOP=1 --csv \
  --command='SELECT kind,reason,count(*) FROM newsletter_operational_receipts GROUP BY kind,reason ORDER BY kind,reason' \
  > "$newsletter_backup_dir/crm-operational-receipts.csv"
"$newsletter_pg_bin/psql" --dbname=service=newsletter_engine_source -X --set=ON_ERROR_STOP=1 --csv \
  --command='SELECT kind,reason,acknowledged_at IS NOT NULL AS acknowledged,count(*) FROM warpdrive_operational_events GROUP BY kind,reason,acknowledged_at IS NOT NULL ORDER BY kind,reason,acknowledged' \
  > "$newsletter_backup_dir/engine-operational-outbox.csv"
```

Generate the checksum file after every dump, archive and inventory command succeeds and you have written `snapshot.json`. If any step fails, treat the directory as a partial capture and use a new directory for a complete capture.

```sh
umask 077
python3 - "$newsletter_backup_dir" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys

root = Path(sys.argv[1])
names = ("crm.dump", "newsletter.dump", "newsletter-media.tar.gz",
         "snapshot.json", "crm-receipts.csv", "engine-receipts.csv",
         "crm-operational-state.csv", "crm-operational-receipts.csv",
         "engine-operational-outbox.csv")
lines = []
for name in names:
    digest = sha256()
    with (root / name).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    lines.append(f"{digest.hexdigest()}  {name}\n")
with (root / "SHA256SUMS").open("x", encoding="ascii") as manifest:
    manifest.writelines(lines)
PY
```

Retain the approved backup destination receipt and a separately protected copy of the checksums. All artifacts include sensitive installation state.

## Passive restore and rollback

Use this procedure for the filesystem snapshot above. For an S3-backed recovery set, follow the [S3 media hold](#s3-media-hold).

A DBA prepares two empty, isolated restore databases and maps the protected profiles `newsletter_crm_restore` and `newsletter_engine_restore` to them. Verify both destination identities and keep them separate from active databases. Compare the manifest to the separately protected copy. On a host with `sha256sum`, use the command below. On macOS, substitute `shasum -a 256 -c SHA256SUMS`. Continue only after every listed file passes verification.

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

The tar contains the upload root's contents. Extract it into the new `uploads/` directory. The engine loads `upload.filesystem.upload_path` from its settings table and resolves relative paths from its working directory. Update that setting in the isolated engine database, then verify the recorded absolute path before launch. This block requires a filesystem provider and one matching setting row.

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

Launch from the new restore root after database restore and media relocation both succeed. Review `newsletter_restore_path` as the executable search path. Inherited `LISTMONK_*` settings override configuration files, so the clean environment below supplies the intended flags and locale explicitly.

```sh
set -eu
(
  cd "$newsletter_restore_root"
  env -i PATH="$newsletter_restore_path" TZ=UTC LC_ALL=C \
    NEWSLETTER_DELIVERY_ENABLED=false NEWSLETTER_PUBLIC_SIGNUP_ENABLED=false \
    NEWSLETTER_SES_FEEDBACK_ENABLED=false \
    "$newsletter_restored_engine_binary" --config "$newsletter_restore_config" --passive
)
```

Keep app and workflow workers stopped until their restored database, stable encryption keys and intended database ownership/grants are checked. Readiness should show database ready and scheduler passive. Check intended restore-directory ownership and compare exact media bytes at the restore origin, memberships, suppression, pending campaigns and delivery/operation receipt states and counts. Record zero outbound message transactions during inspection. Filesystem readiness probes create temporary files only in the relocated restore directory.

With engine 085, passive startup may append operational facts for retained rejected/unknown or expired submitting receipts. It must preserve every delivery/campaign receipt field and must not resend. Compare the source receipts separately from this outbox-only catch-up. Before starting a restored CRM worker, reconcile native operational receipts, audit/notices, engine acknowledgement metadata and post-cut facts as one set. Preserve acknowledged source identities. The read-only Maintenance status may correctly show stale while that worker is stopped.

For rollback, first preserve the post-upgrade databases, media and provider delivery receipts as another checksummed set. Restore the matching pre-upgrade pair and media into isolated targets, select the retained compatible app/engine binaries, and use the passive launch above. Retain the newer targets and their post-cut suppression and unresolved receipts. An older snapshot can contain earlier consent and delivery states. Reconcile subsequent opt-outs, complaints, suppressions and accepted/unknown submissions against authoritative provider records before resuming. Hold every unresolved submission for operator review. Keep signup closed.

The committed synthetic reference exercises dual-database restoration, exact media bytes, blocklist/unsubscribe preservation, an unknown CRM receipt and passive startup with an empty SMTP capture.

```sh
python3 -B scripts/newsletters/restore-smoke.py \
  --engine /path/to/derived/listmonk --mailpit /path/to/mailpit \
  --postgres-bin "$(pg_config --bindir)" --bun "$(command -v bun)"
```

The retained `rotation-rollback080` fixture additionally restored an earlier engine's due campaign in passive mode and preserved the newer database's unknown receipt and later suppression separately. The installation's coordinated backup, recovery time, provider reconciliation and live rollback evidence remain Pending.
