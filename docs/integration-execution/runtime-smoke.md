# Isolated runtime smoke

Harness: `scripts/integration-profile-smoke.ts`. Status: runtime smoke passed on 31 October 2026 at 14:23 Europe/Berlin. This document records BASE-008/009 local operational evidence and never substitutes
for provider, public-hosting or publication qualification.

## Refusal boundary

Before any database, queue or object writes, the harness requires the exact profile:

- App `http://127.0.0.1:3160`, development mode.
- PostgreSQL role `integration_program`, loopback `127.0.0.1:55436`, database
  `integration_program_preview`, no URL query parameters.
- Realtime `ws://127.0.0.1:8080`, listener host `127.0.0.1`.
- S3 `http://127.0.0.1:9160`, bucket `integration-program`.
- Telemetry and update checks disabled; Google/Slack client IDs blank.
- No pre-existing users, mailboxes, integration connections, authentication mail or remote
  revocation rows. A seeded or provider-connected profile is refused without modifying it.

Private configuration lives at `/tmp/warpdrive-integration-program-private/runtime.env`.
Do not copy its contents to logs, source or public artifacts.

## Execution

Use the declared Bun 1.4.4 binary and the private env file from the reconciled checkout:

```sh
PATH=/tmp/warpdrive-bun144/bin:$PATH /tmp/warpdrive-bun144/bin/bun \
  --env-file /tmp/warpdrive-integration-program-private/runtime.env \
  scripts/integration-profile-smoke.ts
```

The script is a producer/client process. It does not register a fake worker, start a websocket
server or replace any running service. Start the actual isolated application, worker, realtime,
PostgreSQL and S3 services first. It leaves those services running.

The registered `auth-maintenance` queue must already exist. The harness uses producer-only
pg-boss (no queue migrations, schedules, maintenance or consumers), submits a uniquely labelled
harmless job and requires the real worker to mark it completed, with start/completion timestamps.
On the required empty profile the handler has no mail or provider revocations to dispatch.

The websocket checks use a newly inserted synthetic CRM/auth identity and a native password
session fixture. This qualifies current server-side native-session validation and signed ticket
consumption; it does not qualify password entry, MFA, browser login or a provider identity.
Invalid tickets and replay must close with 4401. Own-user subscription must succeed, another
user channel must be denied, and a real PostgreSQL `pg_notify` must arrive with sequence zero.

S3 receives a unique `base-smoke/<uuid>.txt` object containing Farsi, German and English bytes.
The actual MinIO client uploads, reads and compares bytes, removes the object, and requires a
not-found result afterward. No customer file or database file record is touched.

Synthetic tickets, native session, auth identity and CRM user are removed transactionally.
Cleanup attempts database, object and producer shutdown independently, even after failure.
Only the completed synthetic queue record remains as operational evidence. Calls have finite
8-second deadlines, the worker completion poll is bounded at 30 seconds, PostgreSQL statements
have 5-second limits, and a final 90-second process cap covers third-party calls lacking cancellation.
Failures emit stable step codes and completed checks, never tickets, credentials, URLs containing
credentials, database rows or SDK error messages.

## Evidence

- Static Biome formatting/check: passed for the harness.
- Scoped type-aware ESLint: passed for the harness.
- TypeScript no-emit check: no diagnostics on the authored harness checkpoint.
- Runtime execution: passed, exit 0, Bun 1.4.4, actual isolated services.

The existing UI/source pass did not qualify realtime. The following evidence applies to the
reconciled local foundation and its actual separate services.

Source head: `80ba5c4363dfe804bf93ac59f4947ad5bdb812c8`. The harness was an uncommitted
operational addition during this run; its SHA-256 is recorded below for exact attribution.

Invocation: the command above from `/tmp/warpdrive-integrations-preview-20261031`, with the
pinned runtime directory first on PATH. The app, worker, realtime, PostgreSQL and S3 services
were provisioned and started separately by the programme owner. The harness did not start,
restart or replace any service.

Positive run: exit **0**, all ten checks passed:

```text
exact-isolated-profile_empty-provider-data
app_database-health_200
separate-producer_registered-auth-maintenance_completed
realtime_invalid-auth_denied-4401
realtime_synthetic-native-session_authenticated
realtime_ticket-replay_denied-4401
realtime_own-user_subscribed_other-user_denied
realtime_actual-pg-notify_relayed-seq0
storage_actual-upload-read-delete_unicode-bytes
synthetic-ticket-session-user_cleaned
```

Refusal check: reran with only `BASE_URL=http://127.0.0.1:3161` supplied by the shell.
Exit **1**, result `profile_refused_before_writes`. No services were changed.

Independent read-only cleanup inspection after both invocations:

| Item                                             | Count |
| ------------------------------------------------ | ----- |
| CRM users                                        | 0     |
| Native auth users                                | 0     |
| Sessions                                         | 0     |
| Consumed websocket tickets                       | 0     |
| Authentication mail rows                         | 0     |
| Provider revocation rows                         | 0     |
| Remaining S3 `base-smoke/` objects               | 0     |
| Completed labelled `auth-maintenance` smoke jobs | 1     |

Sanitized logs retained outside Git under the private profile directory:

- `/tmp/warpdrive-integration-program-private/runtime-smoke.log`
- `/tmp/warpdrive-integration-program-private/runtime-smoke-refusal.log`
- `/tmp/warpdrive-integration-program-private/runtime-smoke-cleanup.log`

This closes the tested local startup/producer-worker/realtime/storage scenario. It does not
establish provider authorization, actual notification delivery, browser authentication,
long-running heartbeat/offboarding behavior, public reachability or production readiness.

Harness SHA-256: `bbe3bbdb2b8b32d954cba0e506024f7c495268c6123f945f16fb3971a122f3df`.

## Final source rerun

The same ten checks passed again on source `a01ca83d09ef40dfe2421f96e024c66dbee0c3e2`
using the committed harness and the same separate services. Log: `smoke.log` in the private
profile and sanitized durable evidence. The earlier cleanup counts above remain attributed
to the first run; subsequent successful runs leave an additional labelled completed queue job.
