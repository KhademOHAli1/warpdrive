# Calendar continuation handoff, 31 October 2026

Historical checkpoint: see [the later continuation status](calendar-progress-2026-10-31.md) for the fixed reminder blocker, compact editor and current evidence. This remains a continuation checkpoint, not a completion or release claim. The user requested a new persistent chat, a new goal, and continued implementation of every remaining calendar roadmap item until this part of Warpdrive is fully and reliably closed. Google Calendar and Google Meet are the first providers to connect and verify.

## Goal for the new chat

Create this persistent goal at the start of the new chat, then begin work:

> Complete the remaining Warpdrive calendar roadmap in docs/calendar-implementation-plan.md and docs/google-calendar-event-workflow.md, starting with save/reminder integrity and Google Calendar plus Meet. Preserve the current product UI, CRM relationships and permission boundaries. Deliver polished, accessible workflows in contextual Farsi and German, with Iranian calendar support, reliable background processing, recurrence, invitations, calendar sharing, provider integrations, scheduling, interoperability and the documented special-event lifecycles. Prove each completed workflow with appropriate tests and real browser/server/database acceptance. Record actual provider acceptance separately from local or simulated evidence. Keep unresolved credential, account-policy or provider gates explicit; do not mark the goal complete while required work remains.

The request authorizes local calendar implementation and testing. Do not infer authorization to change real user accounts, grant OAuth scopes, send external invitations, create external meetings, spend money, deploy, or merge unrelated branches. Continue independent work while requesting the specific missing provider setup when necessary. No provider test accounts or app registrations have been supplied yet.

## Repository ownership and saved state

- Use `/Users/ali/Developer/warpdrive-calendar` explicitly for all calendar commands.
- Branch: `codex/calendar-workflows`; HEAD: `2803183809c646a063f78fe954c110adbb2f453f`.
- Previous editor commits: `9f0e9cc` (localized create/edit), `e5087f7` (UI refinement). HEAD is the clean merge of then-current `origin/main` at `cab6558` into this calendar branch.
- The current foundation implementation is **uncommitted**. There were 68 modified/untracked entries before this handoff document. They belong to this calendar work. Do not reset, stash, discard, or bulk-stage another worktree's work.
- Main and origin/main have since advanced to `a1a8f6da1ce366c35002900bf33508356dfbb995` as observed at handoff. This calendar branch has not incorporated that later work. Inspect changes before a future reconciliation.
- Other active worktrees include `/Users/ali/Developer/warpdrive` (currently `codex/privacy-data-lifecycle`), `warpdrive-integrations`, `warpdrive-mail-platform`, and `warpdrive-settings-ux`. Do not edit them or stop their services. Recheck live ownership before mutation.
- No calendar push, PR, merge to main, or deployment occurred in this continuation slice.
- A local recovery copy is under `.runtime/calendar-handoff-20261031/`: tracked diff, non-ignored untracked source archive, status, checksums and selected evidence. The original worktree remains the source of truth. Do not apply the recovery patch onto an already changed checkout.
- `.runtime/` is ignored. It contains local test harnesses and dummy configuration. Never commit environment files, credentials, auth cookies, database data directories or node_modules.

Read `AGENTS.md`, `CLAUDE.md`, and relevant installed Next.js documentation before coding. The repository requires test-first changes, real PostgreSQL integration tests, shared shadcn/Radix controls, typed boundaries, Result errors, AbortSignal propagation and the declared Bun package manager. No dependency changes were made in this slice. Bun is pinned to 1.4.4 at `.runtime/bin/bun`.

## Implemented foundations, pending final acceptance

### Creation, navigation and draft safety

- Day view with civil-day stepping and correct 23/25-hour DST windows, alongside week/month.
- Pointer selection snapped to 15-minute cells, reverse selection, cross-midnight endpoints, keyboard lane creation, `C` shortcut and all-day lane creation.
- An empty day/week still presents the interactive grid. A pointer click uses its precise position within a lane; keyboard activation uses the lane boundary.
- Existing quick/detail editor continuity, localized Iranian date/time controls and current shell/design tokens are retained.
- Unsaved editor guards cover cancellation, close/Escape, raw uncommitted time input and beforeunload. Calendar settings guard close/switch when new names or settings are dirty.
- New calendar events prefer the `meeting` activity type even when the catalog lists `call` first. A live browser discovery produced a red/green regression for this.

### Event identity, time zones and conflicts

- Migration `0083_calendar_event_revision.sql`: activity version and event time zone; a BEFORE UPDATE trigger increments every writer's revision, including old CRM composers/imports.
- Existing version is checked after visibility/permission checks under a row lock for update, complete and delete. Conflicts retain the draft and return localized feedback rather than overwriting another writer.
- Authored event time zone survives unrelated edits and changes to display preferences. New events adopt the chosen calendar's zone once source data arrives without erasing typed fields. Moving an existing event retains its authored zone.
- Time-zone selection uses the existing searchable Combobox. Server boundaries validate real IANA identifiers.

### Calendar ownership, membership and privacy

- Migration `0084_calendar_ownership.sql`: calendars, owner, primary status, default time zone, archival, member roles, event calendar, privacy and busy/free state.
- Personal calendar is provisioned lazily. Additional calendars can be created, renamed, archived/restored and shared with active workspace users as free/busy, reader or editor.
- Owners manage sharing/settings. Primary calendars cannot be archived. Membership mutations and event saves use consistent calendar locks to serialize revocation against writes.
- Calendar read/write checks are used by the calendar, editor, entity activity reads and lead timeline. Private events are redacted to noninteractive busy spans when the viewer can see availability but not event details. Free events do not generate busy spans.
- Read-only details viewer has no mutation controls; safe meeting links and sanitized rich descriptions are retained.
- Standalone calendar editors can write native calendar events. CRM-linked events retain the existing parent permission boundary.
- **Legacy CRM activities remain calendarId=null.** Their IDs and CRM relationships are preserved; a migration/backfill strategy has not been completed. There is no claim that all old activities have become owned calendar events.
- Source visibility/filter toggles are not implemented yet. The manager/editor choose calendars, but the main view still combines accessible calendars.

## First priority: fix the reproduced partial-save failure

The latest real browser acceptance found a release-blocking issue in the existing reminder path:

1. `repo.ts` commits a newly created activity.
2. It then calls `scheduleReminder` outside that transaction.
3. A fresh web process starts pg-boss as a producer, but its `activity.reminder` queue is created only by a separate reminder worker.
4. `boss.send` fails with `PGBOSS_QUEUE_NOT_FOUND`; the server action reports failure even though the event exists. Retrying the new-event form can create duplicates.

Reproduction is committed nowhere yet: `src/features/activities/calendarReminderDelivery.integration.test.ts`, with a real migrated PostgreSQL database and a real pg-boss instance but no reminder queue. The deliberately failing test and `.runtime/calendar-reminder-queue-red.log` reproduce the correct failure. **Do not hide the error or remove/skip the test to obtain a green suite.**

The new test is still rough/unformatted. Its `setBoss(null)` cleanup needs a corresponding nullable setter type or another proper cleanup approach; `src/jobs/boss.ts` currently declares a non-null parameter although the stored singleton is nullable. The last passing typecheck predates this test. Do not claim the current tree is type-clean.

Recommended next design, not implemented yet:

- Persist reminder intent in the **same transaction** as the event. No queue I/O on the save path. Keep the existing 10-minute reminder lead until personal defaults/overrides are implemented; it is not 15 minutes.
- An outbox table should retain activity identity, due-time snapshot, fire time, dispatch/delivery/cancellation state and notification ID. Upsert idempotently and cancel obsolete intents when an event moves, completes or is deleted.
- A worker dispatches pending intents with row locking and a stable pg-boss job UUID. The installed pg-boss SendOptions supports `id`. A crash after enqueue but before marking dispatched must not create a second logical job.
- Re-read current activity state and exact due snapshot at delivery. Existing reminder code does not correctly suppress jobs after rescheduling despite its comment. Test cancellation, completion, deletion, archived calendars and stale jobs.
- Create the in-app notification and mark delivery atomically. Do not enqueue notification email from inside an uncommitted notification transaction. Persist notification ID so retry can reattempt email handoff without making another in-app notification.
- `src/server/worker.ts` registers the notification email worker, then the reminder worker. `src/jobs/appInstrumentation.ts` starts the web producer; development instrumentation intentionally does not run reminder consumers. Do not weaken auth timeouts or start unrelated import/mail workers to solve a calendar acceptance problem.
- New background work must have retry/recovery tests, not just happy-path assertions. A narrowly scoped local calendar worker may be useful for acceptance.

Related privacy issue to test before exposing reminders/invitations:

- Notification producers, feed and email currently gate CRM parents, but a native event with no parent can leak its subject to an assignee without current calendar detail access, or after membership revocation.
- Check activity calendar visibility for activity notifications at production/read/delivery boundaries. `loadCalendarAccess` can batch activity IDs; preserve legacy non-calendar behavior. Add real PostgreSQL tests for private/free-busy recipients and revocation.

## Verification ledger

These are actual recorded results, not complete service acceptance:

| Evidence                                     | Result                                                | Limit                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `.runtime/calendar-core-unit.log`            | 485 unit tests, 78 files passed                       | Before the reminder regression was added; selected activity/calendar tests, not every repository test |
| `.runtime/calendar-default-type-green.log`   | Targeted default-meeting regression passed            | 1 selected test, 12 skipped by selection                                                              |
| `.runtime/calendar-core-pg.log`              | 16 tests, 6 files passed against native PostgreSQL 16 | Before adding the known-failing reminder test                                                         |
| `.runtime/calendar-reminder-queue-red.log`   | 1 intentional regression failed                       | Queue missing after event commit; this is the current blocker                                         |
| `.runtime/calendar-core-types.log`           | Typecheck returned exit 0 earlier                     | Predates rough reminder regression, current tree needs recheck                                        |
| `.runtime/calendar-update-final-lint.log`    | Scoped activityUpdate ESLint returned exit 0          | Prior complexity issue fixed; no claim of final whole-tree lint                                       |
| `.runtime/calendar-core-i18n.log`            | 0 catalog issues, 0 new source findings               | Static audit does not prove contextual translation or all UI workflows                                |
| `.runtime/calendar-foundation-fa-editor.jpg` | Actual signed-in Farsi editor screenshot              | Synthetic regular account, local real server/database, no external provider                           |

The earlier editor commit `e5087f7` had 614 selected unit tests, 11 real PostgreSQL tests, lint, types and a dummy-config production build passing. Those results predate migrations 0083/0084 and are **not** current-foundation build proof. The previous `.runtime/calendar-polished-*.jpg` images used mocked transport; do not pass them off as current signed-in acceptance.

Strengthen the archive integration test: it currently checks archive/restore but does not create an event to prove preservation, despite its name. Availability queries also need review for completed activities and archived calendars. Final production build, full lint and signed-in German/mobile acceptance for the new foundations remain open.

## Local restart and browser fixture

### Real PostgreSQL integration harness

Docker was unavailable, so the ignored scratch harness initializes native PostgreSQL 16, migrates the actual repository, and uses `makeTestDb` clones. There are no mocked database queries.

- Binary directory: `/opt/homebrew/opt/postgresql@16/bin/`.
- `.runtime/calendar-pg.setup.mts`: temporary cluster on 127.0.0.1:54672; starts and stops around the run.
- `.runtime/calendar-pg.config.mts`: six previous integration files plus the new failing reminder file.
- Run **one** such PostgreSQL configuration at a time. Do not run simultaneous initializations against the same data directory.

From the owned calendar worktree:

```sh
.runtime/bin/bun --bun node_modules/vitest/vitest.mjs run --config .runtime/calendar-pg.config.mts src/features/activities/calendarReminderDelivery.integration.test.ts
.runtime/bin/bun --bun node_modules/vitest/vitest.mjs run --config .runtime/calendar-pg.config.mts
.runtime/bin/bun --bun node_modules/vitest/vitest.mjs run --project unit src/features/activities 'src/app/(app)/activities/calendar'
PATH="$PWD/.runtime/bin:$PATH" .runtime/bin/bun run typecheck
PATH="$PWD/.runtime/bin:$PATH" .runtime/bin/bun run lint
PATH="$PWD/.runtime/bin:$PATH" .runtime/bin/bun --env-file .runtime/calendar-build.env run build
```

Inspect the dummy build environment and current scripts before using the final command. A dummy-config build is compilation evidence only. Do not apply migrations to shared/live databases as part of these checks.

### Dedicated signed-in browser/server fixture

- URL: `http://calendar-workflows.localhost:3169/activities/calendar?view=day&d=2027-03-21`.
- Native PostgreSQL fixture: 127.0.0.1:54673, `.runtime/calendar-browser-pg/data`. DB metadata is in `.runtime/calendar-browser-fixture.json`.
- Environment: `.runtime/calendar-browser.env`, synthetic only, no Google OAuth connection. The distinct `.localhost` hostname prevents cookie collisions with other previews because cookies are not port scoped.
- Setup/roles scripts: `.runtime/calendar-browser.setup.mts`, `.runtime/calendar-browser.roles.mts`. The latter is restricted to the isolated fixture. Do not rerun setup blindly and lose the current reproduction.
- Existing synthetic users: `owner@calendar-review.invalid`, `reader@calendar-review.invalid`, `editor@calendar-review.invalid`. All are regular users with a synthetic permission set based on REGULAR_DEFAULT_FLAGS. Password/setup information is only in the local fixture scripts; no real account changes are required.
- An initial admin login correctly required MFA. No enrollment, bypass or policy weakening was performed. A fresh regular-user login was used for acceptance.
- WebSocket URL points to 3170, but no WebSocket server was running. Account for that when testing realtime behavior.
- At handoff, web listener PID 21982 was verified with cwd equal to the calendar worktree, port 3169. Browser-fixture PostgreSQL listener was PID 15051 on 54673. Both were left running for continuation. PIDs can be reused; recheck command/cwd/port before any stop/restart. No other service should be terminated.
- Restart only if needed, after verifying ownership:

```sh
.runtime/bin/bun --env-file .runtime/calendar-browser.env --bun node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3169
```

Chrome acceptance tab ID was `351774493`, in browser `1`, session `📅 Calendar workflow acceptance`. Reacquire it through the supported computer-use API; a new chat will not inherit REPL bindings. Read/rewrite CUA documentation before continuing. Do not close user tabs. Cold Next compilation caused transient timeouts; warm retries worked without weakening authentication.

### Do not retry this already-persisted new-event draft

The browser may still show the failed new-event form. The event **already exists**:

- Activity ID `3ee802b0-d564-46e3-b608-e0ac1f6567a9`, revision 1.
- Title `جلسهٔ برنامه‌ریزی نوروز`; location `دفتر تهران`.
- Description `هماهنگی برنامهٔ نوروز و بررسی کارهای تیم`.
- Start `2027-03-21T05:30:00.000Z`, end `2027-03-21T06:30:00.000Z`, authored zone `Asia/Tehran`, displayed 09:00-10:00 on 1 Farvardin 1406.
- Calendar ID `9a5b8e77-dfae-4d25-a9a5-9b4e636476d9`.
- Pasted `https://meet.google.com/calendar-review` is a synthetic link, **not a provisioned or tested Meet conference**. Do not join it.

After fixing reminder integrity, cancel/discard this still-open new-event draft and refresh/reopen the stored event. Verify edit against that row. Use a differently titled event for a fresh create test, then verify exactly one row and the reminder intent/notification lifecycle.

## Remaining roadmap and acceptance order

Keep this list synchronized with both roadmap documents. Every item includes production behavior, failure/retry handling, permissions, accessibility, contextual Farsi/German copy and tests, not merely visible controls.

1. **Save/reminder integrity and privacy:** close the blocker above; personal timed/all-day defaults, multiple notification/email overrides, rescheduling/cancellation, retry idempotency and actual delivery.
2. **Finish foundation acceptance:** real create/reopen/edit/complete/delete, unsaved guards, manager create/rename/archive/restore, share/revoke, read-only/private/busy/free, cross-user denial and conflict races in Farsi and German; Iranian dates; keyboard/RTL/mobile review; source filters, archive/availability fixes and legacy calendar migration decision.
3. **Recurrence and exceptions:** daily/weekly/monthly/yearly, interval, weekdays/ordinals, count/until, immutable occurrence identity, moved/deleted exceptions and single/future/all scopes. Preserve authored Iranian month/year rules separately from Gregorian provider RRULEs. Test Nowruz, leap dates, skipped invalid dates, DST gaps/folds, duration and series splitting.
4. **Guests and invitation lifecycle:** email/contact entry, required/optional guests, organizer/guest authority, guest permissions/privacy, explicit review/send/update/cancel decisions, durable invitation mail, external RSVP, tentative/decline/accept, alternate-time proposals and safe retry.
5. **Google Calendar + Meet first:** separate Calendar consent/scopes from Gmail and sign-in; discovery; full/incremental sync including deletions, pagination and 410 rebuild; external IDs/ETags/conflicts; watch renewal; asynchronous Meet provisioning with pending/failure/retry/update/cancel. Full sync conference data before enabling writes for an existing cache. Real provider-account acceptance is still gated on accounts/app registration and explicit consent.
6. **Scheduling and resources:** authorized free/busy, unknown versus busy/denied, required/optional guest filtering, suggested times, room/equipment requests and reservation responses.
7. **Attachments and event sharing:** existing storage integration, limits/failures, rich-description safety, attachment access review before invitation, event color, duplication/move and authorized ownership transfer.
8. **ICS:** explicit import/export, read-only subscriptions distinct from two-way sync, exclusive all-day end adapter, recurrence exceptions, protected secret feeds and documented lossy conversions.
9. **Microsoft Calendar + Teams, then Zoom:** real capability discovery/consent, discovery/delta/subscription recovery where applicable, provisioning/update/cancel, RSVP and idempotent retries. No fake success for unconfigured providers.
10. **Special event lifecycles:** tasks, focus time, out of office, working location, birthdays, appointment schedules/booking pages, buffers, booking limits, conflict calendars and cancellation according to the reference inventory. Account/edition restrictions must remain truthful.
11. **Closeout:** final test matrix, migrations/build/runtime and worker verification, security/permission review, translated UX review, accurate docs and a clean reviewable calendar checkpoint. Coordinate integration with current main without reverting peer work. Do not equate a local build with release/provider acceptance.

Useful verified technical references for continuation:

- [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html): skip invalid recurrence dates/nonexistent local times; preserve local DTSTART zone. DTEND gives equal elapsed duration while DURATION can preserve nominal duration.
- [Google recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents): originalStartTime identity and future-series splitting.
- [Google event creation and conferencing](https://developers.google.com/workspace/calendar/api/guides/create-events): unique conference request IDs, conferenceDataVersion=1, asynchronous status and conference-data sync precautions.
- [Google incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync) and [API error recovery](https://developers.google.com/workspace/calendar/api/guides/errors).
- Installed `@js-temporal/polyfill` supports calendar `persian`; a verified `PlainDate.from('2027-03-21').withCalendar('persian')` is 1406-01-01 and adding one Persian month produces ISO 2027-04-21. Use deliberate authored-calendar semantics rather than scanning Intl-formatted days.

## Immediate next steps

Create the requested persistent goal, inspect the owned worktree and latest peer/main state without mutation, then finish the red reminder regression with a durable transactional design. Re-run the integration selection and types/lint, continue signed-in browser acceptance, and only then checkpoint the foundation as tested. Work through the remaining list without claiming provider or release proof from local substitutes.
