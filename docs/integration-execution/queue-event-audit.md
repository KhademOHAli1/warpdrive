# BASE-006: queues, events and peer workflow audit

Audit date: 2026-10-31. Evidence class: source review only. No services, queues, provider calls or tests were started by this audit.

## Inspected sources and ownership

- Integration checkout: `/tmp/warpdrive-integrations-preview-20261031`, clean source head `2f6098b13455fc241389df48b4d4a17f1eed77a7` before audit documents. References without a checkout prefix below refer to this head.
- Peer workflow checkout: `/private/tmp/warpdrive-workflows-20261031`, branch `codex/visual-workflows`, head `b8f25a41fccdb05e24e03d9ce07311a2798817d6`, origin `https://github.com/KhademOHAli1/warpdrive.git`. Many tracked and untracked workflow/editor/condition files are actively dirty. Peer ownership is retained; none was changed or copied by this audit.
- Calendar peer: `/Users/ali/Developer/warpdrive-calendar`, branch `codex/calendar-workflows`, head `9f0e9cc`, clean when read. Its one commit after `8539fe8` adds calendar event creation/editing; it is not the visual workflow engine.
- Both integration and workflow work descend from Better Auth main `8539fe8c4aeb0b58b6d05e629710460ef90bbed4`. The workflow peer has five commits after that base. It must be reconciled deliberately rather than assuming its absence from the integration checkout means it does not exist.

## Existing queue ownership

`src/server/worker.ts:18` is the central registration seam. `startWorker` starts pg-boss against `env.DATABASE_URL`, publishes the process singleton, then registers jobs (`src/server/worker.ts:31`). The web process is primarily a producer through `src/instrumentation.node.ts:12` and `src/jobs/appInstrumentation.ts:15`. Development additionally registers import consumers in the web process (`src/instrumentation.node.ts:20`), so a local profile with a separate worker must recognize that exception.

The boss instance is process-scoped via `Symbol.for` on `globalThis` to survive Next bundler layers (`src/jobs/boss.ts:8`). Producers use `requireBoss`; a missing instance throws in production but returns null in tests/scripts and development (`src/jobs/requireBoss.ts:17`). This means an apparently successful DB-only test does not establish actual queue delivery.

| Existing queue                                                      | Registration/handler source                                                                                  | Producer or recovery source                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `email.sync`                                                        | `src/features/email/workerJobs.ts:40`, `:46`                                                                 | Worker boot scans non-disconnected accounts at `:75`; connect/reconnect uses `src/features/email/syncScheduling.ts:18`; subsequent ticks use `src/features/email/syncReEnqueue.ts:28`.                                         |
| `email.send.process`                                                | `src/features/email/workerJobs.ts:62`                                                                        | Scheduled sends: `src/features/email/sendScheduling.ts:18`, called after the durable send-attempt row in `src/features/email/send.ts:218`. Immediate sends process the same outbox inline at `src/features/email/send.ts:224`. |
| `activity.reminder`                                                 | `src/features/activities/reminders.ts:71`                                                                    | `scheduleReminder` at `:18`, called after activity creation commits in `src/features/activities/repo.ts:219`.                                                                                                                  |
| `file.reaper`                                                       | `src/features/files/reaper.ts:59`                                                                            | Hourly cron at `:67`; uses storage and a bounded timeout.                                                                                                                                                                      |
| `import.prepare`, `import.validate`, `import.commit`, `import.undo` | `src/features/import/registerImportWorkers.ts`; shared registration at `src/features/import/jobRunner.ts:30` | Shared enqueue at `src/features/import/jobRunner.ts:12`, with queue creation before send to avoid consumer-start ordering. `runBatchAsActor` rehydrates the batch creator at `:47`.                                            |
| `notification.email`                                                | `src/features/notifications/email/job.ts:168`                                                                | Preference-gated enqueue at `src/features/notifications/emailDispatch.ts:10`.                                                                                                                                                  |
| `auth-maintenance`                                                  | `src/features/auth/management/workers.ts:78`                                                                 | Minutely dispatches auth mail, provider revocations and pruning.                                                                                                                                                               |
| `release.check`                                                     | `src/features/release/job.ts:24`                                                                             | Cron plus immediate startup run; `DISABLE_UPDATE_CHECK` prevents registration and GitHub egress (`:28`).                                                                                                                       |

Queue names and mail retry budget are centralized in `src/constants/jobNames.ts:1`. The workflow peer extends that same file and central worker rather than introducing another queue system.

## Durable mail patterns to reuse, with limits

The Gmail outbox is `email_send_attempts` (`src/db/schema/email.ts:134`). `enqueueSend` uses `(account_id, idempotency_key)` and a deterministic Message-ID (`src/features/email/outbox.ts:39`). Claims are token-guarded with lease expiry and a due-time filter (`src/features/email/outboxClaim.ts:41`). The send-start stamp commits before Gmail I/O (`src/features/email/outboxClaim.ts:122`); retries of stamped rows reconcile by Message-ID instead of blindly resending (`src/features/email/outbox.ts:105`). Unresolved acceptance becomes `needs_review` after the reconciliation window (`src/features/email/outboxReconcile.ts:88`).

These are useful patterns for effect identities, claims and ambiguous outcomes. Existing comments using the term exactly-once do not establish a generic exactly-once external-effect guarantee. Preserve the actual provider-specific recovery behavior and design new delivery contracts explicitly.

Auth mail has a separate encrypted outbox, leased with `FOR UPDATE SKIP LOCKED` (`src/features/auth/management/mail.ts:19`, `:49`), bounded attempts/expiry and capture-versus-SMTP outcomes (`:115`, `:120`). `auth-maintenance` polls it, so its durable row is recoverable without a successful per-message queue send. Google token revocations similarly use durable rows, leases and exponential delay (`src/features/auth/management/workers.ts:17`, `:50`); this handler only supports provider `google` (`:34`).

Slack disconnect first blocks local use by storing `revocation-pending`, then attempts remote revoke and retains encrypted material on failure (`src/features/integrations/service.ts:178`). A repeated disconnect action retries that path. The inspected central worker does not register a Slack revocation sweep, and the Google-only auth maintenance handler does not cover it. Do not represent this as an automatic durable Slack retry worker.

## Current domain event and realtime seams

`publishEvent` bumps a durable channel version and calls `pg_notify` through the caller's DB/transaction (`src/server/notify.ts:10`). `publishBoardEvent` validates a version-1, IDs-only board envelope and delegates to it (`src/server/realtime/events.ts:42`). A caller inside a transaction gets atomic commit/rollback behavior. `DbOrTx` also accepts a root database (`src/server/realtime/channelVersions.ts:10`), so atomicity with domain changes is a caller responsibility.

Useful mutation seams already exist:

- Deal creation: `src/features/deals/dealActions.ts:136`, publish at `:214`.
- Deal stage movement: CAS update, audit history and board publish are in one transaction (`src/features/deals/dealMove.ts:52`, `:84`, `:102`). Same-stage reorders skip the stage-change history at `:87`; a future integration stage-change event should do the same.
- Deal update: `src/features/deals/dealUpdate.ts:123`, publish at `:167`.
- Deal archive/delete: `src/features/deals/archiveDeal.ts:27` and `src/features/deals/deleteDeal.ts:23`, with board invalidation for affected surfaces.
- Inbound email applies rows and publishes inside its transaction (`src/features/email/applyMessages.ts:89`), then best-effort arrival notifications after commit (`:118`, `:153`).

Realtime is a distinct standalone WS process. `src/entrypoints/ws.ts:9` creates a dedicated PostgreSQL listener and starts the server at fixed port 8080 (`:11`), honoring `WS_HOST`. Tickets come from a protected tRPC mutation (`src/server/trpc/routers/realtime.ts:18`). Socket auth consumes a ticket and binds a live session (`src/server/ws/socketSession.ts:119`); heartbeat rechecks sessions and refreshes authority (`:154`). Subscriptions and deal fan-out recheck access (`:187`, `:224`). The relay listens only while subscribers exist and validates server-originated NOTIFY payloads (`src/server/ws/relay.ts:25`).

Channel versions permit stale-view detection. Neither channel versions nor LISTEN/NOTIFY persist a replayable integration event payload or subscriber delivery ledger. Keep UI invalidation and durable automation intent separate while writing both in the same domain transaction where appropriate.

## Actual peer workflow implementation

The following peer files were unchanged relative to its recorded HEAD when inspected:

- `src/features/workflows/runAdmission.ts:19`: manual admission validates current actor/ownership, locks the workflow, pins the published version, requires a manual trigger, deduplicates `(workflow, actor, requestKey)` and rejects key reuse with different inputs.
- `src/db/schema/workflowExecutions.ts:18`: durable runs/cursor/outputs plus unique admission identity (`:44`), pinned-version FK (`:45`) and unique `(run_id, node_id)` step effects (`:59`, `:71`).
- `src/features/workflows/worker.ts:18`: a post-admission queue nudge may fail without losing the persisted run. Startup/minutely reconciliation enqueues up to 100 queued/running rows (`:28`, `:64`). `workflow.run` executes bounded steps under combined pg-boss cancellation/timeouts (`:42`).
- `src/server/worker.ts:12`, `:28` and `src/constants/jobNames.ts:37`: peer workflow jobs use the existing pg-boss worker and `workflow.run`/`workflow.reconcile` queues.

The committed executor at peer HEAD locks each run and commits database effects, step completion and cursor advancement together (`src/features/workflows/execution.ts:15`). This file is dirty: the inspected diff adds selection of `true`/`false` condition ports where HEAD follows `next`. Shared permission rehydration and transactional execution exist in both versions. The committed readiness file permits only manual triggers, deal reads and restricted task creation (`git show b8f25a4:src/features/workflows/readiness.ts`, lines 5-10). Active uncommitted work adds conditions, graph editing and related UI/tests. It is not reconciled or qualified by this audit.

The peer architecture itself identifies CRM triggers/outbox as remaining work (`git show b8f25a4:docs/workflows/architecture.md`, lines 39-45). Therefore reuse the existing workflow run/executor/worker, but do not mistake a registry entry for a working CRM trigger, durable delay, notification or external action.

## Failure and transaction gaps to retire

1. CRM mutation plus a future integration intent needs a durable event row in the same transaction. Publishing NOTIFY or sending a pg-boss job after commit alone leaves an unrecoverable crash window.
2. Scheduled mail and new-activity reminders currently persist domain state before separate queue send (`src/features/email/send.ts:155`, `:218`; `src/features/activities/repo.ts:219`). A failed enqueue can leave a saved item without the expected wakeup. This audit found no general sweeper for orphaned scheduled sends/reminders in the central worker. Do not extend this pattern to shared integration events.
3. Reminder producer comments claim singleton deduplication, but it creates a standard queue without an explicit singleton policy (`src/features/activities/reminders.ts:71`). Mail sync explicitly documents why `singletonKey` alone is insufficient on a standard queue (`src/features/email/workerJobs.ts:51`). Verify queue policies against the installed pg-boss before relying on keys for deduplication.
4. Reminder handling only checks missing/deleted/done, then sends current dueAt; it does not compare the job's scheduled timestamp to current dueAt (`src/features/activities/reminders.ts:44`). Activity update does not enqueue a replacement reminder in its inspected path (`src/features/activities/activityUpdate.ts:179` to `:250`). The comment about stale reschedules is broader than the observed checks.
5. Mail sync's count-then-send cadence guard is not an atomic uniqueness constraint (`src/features/email/syncReEnqueue.ts:18`, `:28`), and startup seeds jobs separately (`src/features/email/workerJobs.ts:74`). Test concurrent restart/enqueue rather than assuming a singleton key is sufficient.
6. A separate worker can start external mail/provider/update work from existing DB rows. Local smoke must use an isolated synthetic database, capture mail, disabled update checks and private configuration; existing peer previews must remain untouched.
7. External actions must not be added as network I/O inside the workflow run-row transaction. Persist an effect/delivery intent first, dispatch outside the transaction, and model ambiguous outcomes.

## Recommended first EVT slice

After BASE reconciliation and ARCH ownership/delivery decisions, add a versioned durable CRM event envelope and outbox through the deal stage-change transaction. Record event ID, actor, aggregate ID/version and minimal before/after stage IDs; skip same-stage reorders. Reuse the central pg-boss worker and the workflow peer's persisted admission/reconciliation pattern. Use explicit subscription/delivery identities so Slack rules and workflow record triggers consume the same event without sharing an accidental global completion flag.

Write real-PostgreSQL tests first for rollback producing no event, mutation/event atomicity, lost queue nudge recovered by polling, duplicate dispatch/admission, concurrent workers and permission revocation before delayed effects. Keep `publishBoardEvent` intact to preserve the current UI. Implement a synthetic/local Slack delivery adapter only after CONN/ARCH contracts; real Slack support remains a separate live-provider gate.

This audit supports BASE-006 source acceptance and identifies dependencies for reconciliation. It does not close BASE-004, BASE-009, BASE-010 or any runtime/provider qualification task.
