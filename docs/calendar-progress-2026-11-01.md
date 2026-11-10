# Calendar continuation, 1 November 2026

The main-relative C-shortcut increment is Delivered as `a29c08c356af8a308056086ecbac98f2d70683e4`. Exact hosted CI `41365229340` passed all required jobs at 00:25:39 UTC on 2 November: 8,670 unit cases (3 skipped), 3,066 integration cases, full types/lint, application, all five worker bundles and sites. All thirteen shortcut component cases passed. This is source delivery; browser, installed-upgrade and provider acceptance remain open.

This is an active local implementation checkpoint. The full roadmap in `calendar-implementation-plan.md` and `google-calendar-event-workflow.md` remains open. Source is in the existing `/Users/ali/Developer/warpdrive-calendar` worktree, detached at `2803183` plus preserved edits. Settings owns integration; no push, merge, deployment or real provider/account change is implied.

## Latest local evidence and open release gates

The page-reader supporting core passed 64/64 across ten files and actual 24-file scoped lint/format checks plus configured types; its add-only handoff is awaiting main integration. Completion contract tests passed 52/52 and affected UI tests 26/26. The editor now retains its known version when a legacy completion response omits one, using an authoritative returned version when present.

The initial seven-case PostgreSQL selection produced four passes and three replay failures. After the minimum replay fix and allocated configured type/lint closure, a separate once-only GREEN passed7/7 across3files in4.29seconds. This proves witnessed combined-edit rollback, matching commit, Date-only direct reminder persistence/owner feed/unread with cancelled/repeated silence, authorization before no-op, exact same-state no-write replay, concurrent canonical completion and stale-token replay without reminder DML. The separately allocated notification-INSERT failure/retry case then passed1/1 in3.23seconds: witnessed failed write, exact retryable state, and same-UUID retry to one owner-visible receipt. Earlier successful suites below stay tied to their own cuts.

A further scheduling regression exposed C bubbling from week/day portalled dialog buttons and opening a second editor. A minimal DOM-containment guard resolves it. Four new cases and15week-grid cases completed passing before the combined invocation's retained timeout; the unfinished Navigation file then passed3/3 alone after isolating command/tRPC/router boundaries. This is22file-completed component passes. The separately allocated compiler then passed configured Next type generation/full TypeScript, scoped six-fixture TypeScript and typed lint for the three UI plus six fixture files, with zero errors or warnings. Its command took16.49seconds and its owned process group was verified empty. Actual browser proof remains open; the private day-view tests depend on the wider Calendar UI and are not independently main-relative checks.

The native fixture and process group were removed, with all four prior containers retained. Launch was normal pressure; post-terminal sampling saw warning pressure. Aggregate peak was unmeasured. This is logical local SQL/direct-handler evidence, not live worker, wall-clock scheduling, email, browser or provider acceptance.

Canonical0098 is reserved, with native persistence and transition boundaries accepted, but no SQL authored. Old rows/writers must remain legacy; new intent writes must explicitly select ownership and persist suppression. The separately allocated three-case engine diagnostic reached three intended assertion failures with zero setup failures in3.04seconds: rebuild automatically adopted a raw legacy row, and both native create paths retained the wrong legacy marker after their rule/suppression controls passed. The exact owned fixture/process were removed and all three fresh baseline containers retained. A minimal server-owned marker and central pre-policy reconciliation guard are now privately qualified by the eleven-case GREEN described below; affected raw fixtures explicitly distinguish genuine legacy and intent-owned cases. A common Activity lock, separate intent queue/fence, authentic historical receipt visibility and final current email admission remain required. The local live-acceptance adapters are type/lint-qualified but runtime-unrun; exact legacy/installed acceptance is open. Real Google Calendar/Meet acceptance awaits an OAuth app and test accounts; local implementation continues without another setup request.

The new engine application source passed declared Next type generation and full TypeScript. The subsequent fixture compiler stopped before lint/native execution because the selection filter was placed in a project rather than global Vitest configuration. That failure is retained. After the single option-placement correction and a fresh allocation, scoped fixture types and typed lint for eight source/three fixture files passed with no errors or warnings. The native phase passed exactly11selected cases across4files in6.80seconds, with11other cases deliberately unselected. This covers the original three ownership/suppression cases plus genuine legacy date/reassignment, intent-owned direct writes, delivery targets, blocked defaults bootstrap and100/1/101batch controls. Owned processes/container/run labels were absent, all three baseline containers retained and23source pins unchanged. The complete allocation including cleanup took110.75seconds within300. This remains private fixture proof; canonical transition, historical receipt, live worker/browser and provider gates remain open. The unchanged passed application pipeline and earlier seven/INSERT-retry suites were not repeated.

The populated upgrade diagnostic has now reached its intended failure after successful migration and all preservation controls. Exact canonical 0000–0097 and its 98-entry ledger were followed by the historical private native test input. The resulting 99-entry ledger, old Activity/notification/CRM snapshots, legacy ownership, version and authorship controls passed. The copied Calendar backfills then left one unadmitted pending dual-channel intent and one dirty marker for an old event. No delivery or provider effect occurred. Runner time was 4.02 seconds; exact container/process/temp-root cleanup retained all three foreign baselines and all 29 source pins. The later native-create control was not reached.

The corrected new private test migration omits only those two blanket INSERTs, retains the original historical fragments/manifest and unchanged case, and leaves all 98 canonical migrations byte-identical. Public canonical 0085/0087 are unrelated Privacy/Integration migrations; the Calendar names are old private fragments, not admitted canonical history. Current 32 hashes and commands are in `Calendar_Canonical_Upgrade_No_Activation_Preparation_2026-11-02/prepared.json`. Source review, formatting and actual SQL-folder assembly passed. Fresh scoped fixture types/helper lint then passed, and the same populated-upgrade case passed in 3.77 seconds, including the previously unreached actual native calendar/event create and one pending in-app-only intent. Old migration data and all source pins were preserved; exact cleanup retained the three fresh foreign baselines and removed the owned process/container/temp roots. Overall allocation was 65.33 seconds, with independent post-native verification in 33.14 seconds. `Calendar_Canonical_Upgrade_GREEN1_2026-11-02/result.json` records this qualified private cut. This does not admit canonical SQL or qualify installed data, queue ownership, legacy takeover, final MAIL admission, live workers, browser or providers.

Source-bound receipts are in the continuation output folder: `Calendar_Page_Visitor_Handoff_2026-11-01`, `Calendar_Completion_Contract_2026-11-01` and `Calendar_Event_Reminder_Native_2026-11-01`. The following sections retain the earlier implementation history and its limits.

The historical reminder visibility correction is now privately qualified. After the authentic producer/feed/unread assertion first failed, all 22 selected cases across four files passed, with 30 deliberately unselected and zero setup failures. Configured Next route generation/full application TypeScript, scoped fixture types and typed lint for one production plus three fixture/config paths passed with no errors or warnings. The same receipt remains visible when automation is disabled, while actual email admission remains suppressed; current CRM/calendar, malformed-reference/backlink and modern suppression controls passed. Exact cleanup retained all three fresh foreign containers and all 21 source pins. Total allocation including observed cleanup was 101.25 seconds. This does not establish canonical upgrade, native engine admission, queue separation, owner adoption, compatible takeover/receipt transfer, live workers, browser or provider acceptance.

## Personal reminders

Personal calendar defaults and per-event overrides are implemented separately from shared event fields. The session determines whose preference changes. Readers with full event detail access can manage their own reminders. Free/busy, revoked, private and CRM-invisible access does not permit a subscription. Existing event-only reminder saves preserve the shared event version; combined shared/personal edits use one rollback-aware transaction and independent reminder revision checks.

Timed rules support notification and email, 0 to 28 days before the start; all-day rules support a civil day offset and local clock. Each group allows up to five unique rules. Explicit empty overrides stay empty. Timed and all-day drafts survive switching, collapsing and failed validation. Personal reminder controls remain an inline disclosure in the compact event editor. Calendar management includes separately saved personal defaults, and the read-only event view has its own personal reminder save.

The compatibility defaults remain 10 minutes for timed events, with both notification and email choices subject to global channel preferences and mailbox availability. The all-day product default is 09:00 on the event day in its authored zone, not a Google-parity assertion. All-day planning uses canonical civil dates, including DST gap/fold behavior tested in the pure planner.

Durable settings/default/activity/ACL rebuild markers fan out in bounded worker batches. Current policy versions, temporal signatures, receipt identity and channel choices gate notification feed/count and email delivery. Stable recipient/fire-time receipts survive unrelated edits and rule reorderings. Source assignment policies follow the current assignee and the persisted automation flag; explicit personal subscriptions remain independently authorized.

Native PostgreSQL tests exposed two deadlocks involving activity, calendar and dirty-row locks. Activity serialization now uses NO KEY UPDATE so trigger foreign-key KEY SHARE does not conflict, and rebuilds acquire calendar before dirty row. A further observed initial-setting/default-update race is fixed by acquiring calendar UPDATE before any defaults command SHARE/default lock and rechecking authorization after waiting.

Legacy no-intent-ID notification compatibility now resolves stored notification backlinks before any compatibility fallback. Cancelled, mismatched or ambiguous receipts cannot bypass their current policy. Malformed provided references fail closed. Unverifiable all-day legacy mail is denied, while eligible timed notices and truly unlinked in-app history preserve their scoped compatibility behavior. The combined receipt suite passed 60/60 after the three additional audit regressions first failed as expected.

## Google Calendar consent foundation

Dedicated Calendar accounts and OAuth attempts persist separately from Gmail and login grants. State/browser bindings are hashed, PKCE uses S256, refresh credentials are encrypted, and callback consumption is atomic. Credential CAS versions now remain separate from stable connection generations: ordinary refresh advances only the credential version, while reconnect, disconnect, reauthorization-required invalidation and offboarding advance the connection generation. Access tokens are not persisted. Account DTOs exclude credentials. Different verified external Google email is allowed unless a deployment explicitly chooses a same-email/domain policy.

POST `/api/calendar/google/oauth/start` uses CSRF and the live workflow session. GET callback requires the same active owner and an independent callback-scoped HttpOnly/Lax cookie for that attempt, named from the cookie prefix and hashed state. Issuance uses the attempt's fixed Expires deadline. An owner may have at most eight unexpired attempts across browsers, including consumed and cancelled rows. Callback HEAD is inert, and malformed or duplicate callback inputs clear no cookies. Redirect destinations/statuses are fixed. Dedicated optional Calendar configuration has no Gmail fallback. Deactivation/access revocation clears Calendar credentials and pending attempts in the existing offboarding transaction; ordinary logout retains grants.

This is local consent/token/HTTP infrastructure, not synchronization or Meet acceptance. The Settings > Connections account card is now implemented locally with owner-scoped account reads, CSRF-protected local disconnect, validated OAuth-start navigation and contextual Farsi/German/English states. It preserves the existing MCP card and distinguishes connected accounts from unavailable calendar synchronization. Its current 28 containerless UI/boundary tests, full typecheck, translation audit and scoped static checks pass after observed RED. The fixed callback destination passed its native route cases at the stated focused checkpoint. Actual unconfigured-state account-card acceptance now covers Farsi/German desktop and mobile; configured consent/reconnect/disconnect browser flows remain separate gates. Expired-attempt retention cleanup, external calendar bindings/mirror/outbox, sync/watch/recovery and actual conferencing workflows remain required.

The user confirmed there is no Google Cloud app or synthetic provider-account setup yet and instructed local implementation to continue. Real OAuth/refresh/Calendar/Meet acceptance requires that setup and explicit consent; watch acceptance additionally needs a reachable approved HTTPS callback. No real Google API calls or account changes were made.

## Evidence so far

- Pure planner: 14/14, `.runtime/calendar-reminder-policy-green.log`.
- Personal settings/defaults: 17/17 native PostgreSQL, `.runtime/calendar-reminder-settings-green.log`.
- Combined reminder/calendar privacy/outbox selection: 152/152 across 27 files, `.runtime/calendar-personal-all-pg.log` (before the subsequent defaults-concurrency and legacy compatibility additions).
- Defaults initial-setting/create concurrency: 5/5 native PostgreSQL, `.runtime/calendar-reminder-defaults-concurrency-green.log`.
- Batched own-user calendar catalog: 4/4 native PostgreSQL, `.runtime/calendar-reminder-catalog-green.log`.
- Google account foundation: 17/17 native PostgreSQL and 21/21 pure tests, `.runtime/calendar-google-*`.
- Google route/offboarding: 12/12 native PostgreSQL across three files, `.runtime/calendar-google-routes-green.log`; optional env and existing env coverage: 29/29, `.runtime/calendar-google-route-env-green.log`.
- Event save/cache refresh and current-context draft regression: 11/11 unit tests, `.runtime/calendar-manage-cache-green.log`.
- Manager sibling keys: actual React duplicate-key errors reproduced, fixed with distinct stable sibling keys; 10/10 tests, `.runtime/calendar-manager-sibling-keys-green.log`.
- A broader unit selection passed 727 tests but found three stale sign-in copy expectations in untouched `localeUi.test.tsx`; this is not a green full-unit result. `.runtime/calendar-personal-unit-green.log` preserves the failure evidence.
- Full typecheck passed on 1 November, `.runtime/calendar-nov1-types.log`. A selected unit run passed 716/716 across 104 files, `.runtime/calendar-nov1-unit.log`, and the production Next build passed with dummy validation configuration, `.runtime/calendar-nov1-build.log`. These preceded the final legacy compatibility changes and small core helper refactor.
- Whole-repository lint initially found two owned callback complexity errors. The shared `activityReminderWrite.ts` refactor is now qualified by the combined database suite, full types and whole-repository lint.
- Legacy compatibility RED reproduced 15 failures with 42 controls passing. Three additional malformed-reference/all-day audit regressions then failed before the narrow guards were changed. Final native receipt GREEN: 60/60 across four files, one worker, `.runtime/calendar-reminder-legacy-green.log`. Fresh migrated clones also validated `0089_calendar_reminder_receipt_index.sql`, the nonunique notification backlink index.
- The current worker entrypoint bundle passed, `.runtime/calendar-nov1-workers.log`. Its owned process exited 0 and the native PostgreSQL cluster was torn down after the finite slot.
- Final combined native selection: 211/211 across 35 files, one worker, `.runtime/calendar-nov1-combined-pg.log`. Full types passed in `.runtime/calendar-nov1-final-types.log`; whole-repository lint passed in `.runtime/calendar-nov1-final-lint.log` with the same 11 unrelated warnings; the fresh production build passed in `.runtime/calendar-nov1-final-build.log`. All resource guards exited normally and the native cluster was torn down.

## Browser and worker evidence

In the isolated synthetic signed-in Farsi fixture, an explicit timed no-reminder override was saved through the collapsed event disclosure. PostgreSQL confirms shared activity version 3 stayed unchanged while the user's personal policy became revision 1. Personal timed defaults were saved as notification-only 30 minutes, and all-day defaults as notification-only one day before at 08:45 using Persian input digits.

The real reminder worker replaced the original future Nowruz 10-minute/both-channel intent with a new defaults-version-1, notification-only 30-minute intent at `2027-03-21T05:00:00Z`. The previous intent is cancelled. Evidence: `.runtime/calendar-personal-acceptance-evidence.json` and `.runtime/calendar-personal-worker-evidence.json`.

Current-source signed-in acceptance used regular synthetic users and the normal authentication flow. The all-day event `8dff7e7b-0ed3-417a-95fe-4a3675beea5c` was created in Farsi for canonical `2026-11-01`, with the reminder entered as Persian digits `۰۷:۳۰`, same day, Asia/Tehran, notification only. German desktop/mobile reopening preserved the Iranian display date, canonical date and authored zone. A mobile location edit and a later post-delivery edit advanced the shared event to version 3 while the personal policy remained revision 1 and intent UUID `b0391b48-fbaa-4845-afa1-4ab196c6a145` stayed unchanged.

The actual worker delivered that intent at `2026-11-01T04:00:01Z`, corresponding to 07:30 Tehran. Exactly one raw notification and receipt were observed; no email job was present for that notification. The German notification popup displayed one unread reminder after refresh. This is not a WebSocket realtime or external email qualification. The inherited Nowruz all-day event `b6e9663b-57f1-4112-8f0f-219f53ebf37b` retained canonical `2027-03-22`, an assignment/default policy at revision 0, and defaults-version-1 notification intent at `2027-03-21T05:15:00Z` (one day before, 08:45 Tehran).

Farsi RTL and German 390 by 844 reminder panels were inspected, including scrolling lower controls beneath the stationary dialog header/footer. The language preference was restored to Farsi, and the viewport override was reset. Current screenshots and filtered SQL evidence are in the chat outputs, including `Calendar_Local_Acceptance_2026-11-01.json`. The raw current-source inspection is `.runtime/calendar-nov1-browser-final.json`; email queue evidence is `.runtime/calendar-nov1-email-queue-evidence.json`.

The compiled production server correctly refused the HTTP fixture because production authentication requires HTTPS. No authentication rule/configuration was weakened. Browser acceptance therefore used the normal HTTP development fixture, not a qualified production HTTPS deployment. Long earlier hot-reload work had caused startup timeouts and a stale/truncated chunk; the fresh source-frozen preview served the acceptance flow. Development reloads still required waiting for client readiness before actions. The existing fixture database remains intact and must not be recreated.

Current runtime handoff: private preview 3169 reached its planned 900-second acceptance cap and exited normally; the owned narrow worker was stopped afterward. The synthetic PostgreSQL fixture remains on 54673 (PID 15051 at the last ownership check). Task-owned tab 351774544 was closed after captures, and the older tab 351774526 no longer exists. Create a fresh task-owned tab for future acceptance, without claiming a peer/user tab.

During the user-authorized cross-chat recovery window, the verified ignored, non-symlink idle `.next/cache` was removed, reclaiming an observed 1,195,765,760 bytes (allocated size before 1,357,721,600 bytes). No tracked deletions occurred; production output, types, source, credentials/configuration and database data remain intact. Both finite calendar validation slots are terminal and released to the other queued owners. The goal remains active.

## Default-change integrity and current requalification

The source audit became an actual 29-case PostgreSQL RED: 17 assertions failed and 12 controls passed in 7.62 seconds, `.runtime/calendar-reminder-defaults-past-red.log`. It reproduced extra UUIDs, raw notifications and email after a past default change, stale queued-delivery cancellation and the old OAuth callback destination.

The implementation now records each rule's activation time and introduced defaults revision, retaining both for unchanged rules across later saves. `activities.reminderAuthoredAt` is stamped by semantic schedule/calendar/assignment changes and preserved for unrelated shared edits. Explicit personal policy writes provide their own opt-in time. Channel-aware admission handles newer defaults before rebuild; an inbox flag cannot authorize email. The migration preserves shared event versions while backfilling authorship from creation time. Existing historical policy remains: an unmatched obsolete delivered fire time can be cancelled and hidden; a retained same-fire receipt keeps only eligible requested channels.

Independent review found two further gaps. The three audit cases first failed as expected in `.runtime/calendar-reminder-defaults-implicit-red.log`: first persistence lost an overdue implicit version-0 UUID, and a denied handoff marker swallowed a later deliberate email opt-in. Retained implicit product rules now preserve epoch/revision zero; a denied current email channel is cleared before its processed marker is saved. The focused 32-case selection (22 reminder and 10 OAuth route cases) then passed in 7.88 seconds, `.runtime/calendar-reminder-defaults-past-green.log`.

The first affected-suite run stopped when its conservative overlap guard detected another campaign. Its four observed channel assertions were diagnostic, not a completed qualification. The activity test cluster left by SIGINT was explicitly stopped. The guard now permits the coordinator's standing project-unit/static exceptions while protecting the native lane and live 5 GiB floor. Accepted intent fire snapshots remain authoritative while policy revisions are unchanged; only a newer default requires matching against current rules and channel eligibility. With that compatibility correction, 120/120 tests across 13 affected reminder/receipt/outbox/privacy files passed in 18.42 seconds, `.runtime/calendar-reminder-activation-regression-green.log`.

Current full types and the original 28 UI/MCP boundary tests pass in `.runtime/calendar-activation-final-checks.log`. The translation audit reports zero catalog/source findings; Biome passed 36 files and typed ESLint passed 33 TypeScript files in `.runtime/calendar-reminder-activation-statics-final.log`. Two localized-heading unit REDs preceded the Farsi `تقویم Google` and German `Google-Kalender` copy correction. The current source also includes the planner helper extraction and a typed visibility-only activity adapter field required by the new schema.

The merged final selection passed 152/152 native cases across 17 affected/focused files in 27.52 seconds, `.runtime/calendar-reminder-activation-final-pg.log`. It includes the final compatibility/helper-refactor changes. Its owned process exited normally, and the disposable activity test cluster was stopped. No new production build was run or requested.

Migration `0090_calendar_reminder_activation.sql` also passed the populated-fixture preservation check in 0.19 seconds, `.runtime/calendar-browser-activation-migration.log`. All four events retained every shared field and versions 2, 3, 3 and 1; authorship was backfilled from original creation. The database was not recreated. Exact evidence is `.runtime/calendar-browser-activation-migration.json`, with a filtered `Calendar_Migration_0090_2026-11-01.json` in the chat outputs. The guarded script refuses a rerun so it cannot overwrite that original before/after receipt. The previous all-day/browser evidence retains its original source scope. Current Settings > Connections acceptance is recorded below.

Five `accountConnectionGeneration.integration.test.ts` cases first reproduced the credential/lifetime coupling after a competing native PID was verified terminal: two ordinary-refresh/reconnect assertions failed with conflict and three disconnect/replacement/reauthorization controls passed in 1.60 seconds, `.runtime/calendar-google-connection-generation-red.log`. The later combined ten-case selection produced three failures and seven passing controls in 4.19 seconds, `.runtime/calendar-google-connection-lifetime-red.log`. An older untargeted same-subject callback overwrote a newer grant, while local disconnect cancellation, stale refresh success/failure and unrelated different-subject connections remained protected. The review-only staging artifacts in `.runtime/google-connection-generation-draft/` preserve that preparation checkpoint; their unpromoted status is historical and does not describe the current source.

The source-only `.runtime/calendar-checkpoint-20261101-phase4/` snapshot preserves the earlier qualified reminder/UI milestone and then-unqualified provider regression work. Never apply a snapshot over the dirty worktree. The checks at that checkpoint were terminal; the preserved synthetic browser database remains intact.

## Connection lifetime and legacy-attempt migration

The connection-generation patch is now promoted into the local uncommitted source. Targeted attempts pin the selected connection generation, and every new attempt stores an owner-scoped account-ID/generation snapshot before provider HTTP. Consumption and binding validate that durable snapshot. An older untargeted same-subject callback cannot replace a newer connection, while an unrelated different-subject connection remains permitted. Ordinary token refresh retains the generation and continues to use credential-version CAS, including rotation committed while an OAuth callback exchanges its code. Disconnect, offboarding and reauthorization-required invalidation fence older callbacks and refresh results.

The generated local candidate `0091_calendar_connection_generation.sql` adds the account generation and nullable attempt pin/snapshot fields. Its first actual legacy-data migration run produced three failures and one passing preservation control in 2.49 seconds, `.runtime/calendar-google-generation-migration-red.log`. The migration then gained explicit retirement of every preexisting pending or consumed attempt and clears leftover verifier ciphertext, including already-cancelled rows with material remaining. Existing credential versions and encrypted refresh tokens are preserved; legacy pin/snapshot columns remain null rather than receiving an invented empty snapshot.

The final selection passed 55/55 real-PostgreSQL cases across nine files in 10.09 seconds, `.runtime/calendar-google-generation-all-pg.log`: 21 lifetime/snapshot cases, four actual legacy-migration cases and 30 existing authorization/token/HTTP/offboarding cases. The owned PostgreSQL campaign exited normally and its disposable cluster was stopped cleanly. Full types passed in `.runtime/calendar-google-generation-types.log` and again after the migration-test addition in `.runtime/calendar-google-generation-migration-types.log`. The final scoped ESLint receipt covered 13 TypeScript files and exited 0 with no diagnostics, `.runtime/calendar-google-generation-lint-receipt.log`.

This qualifies the stated local source, synthetic transports and migration-fixture boundaries. The preserved browser database then passed its guarded 0090-to-0091 one-shot upgrade in 0.21 seconds, `.runtime/calendar-browser-generation-migration.log`. The script verified exact fixture identity and prior migration hash, refused other clients or unexpected provider rows, and retained every shared field/version of all four events. Provider accounts and attempts remained zero; no database recreation or application restart occurred. `.runtime/calendar-browser-generation-migration.json` records the exact source hash and schema fields. This extends synthetic migration evidence; the earlier unconfigured Farsi/German browser evidence does not qualify configured provider lifecycles. No fresh production build, installed upgrade, real Google consent/refresh or provider synchronization is established. The 0091 number is an unreserved local candidate in a divergent migration history; it requires reconciliation with an accepted combined cut before integration. The [stopped-service cutover contract](../src/features/activities/providers/google/authorizationREADME.md#connection-generation-migration) does not authorize deployment or establish rolling old/new binary compatibility.

## Complete CalendarList transport collection

The new `calendarDiscovery.ts` collector fetches a full calendar-list snapshot and
returns its final sync token only after every page succeeds. Later errors or malformed
pages, duplicate calendar IDs, cyclic or mixed cursors and an over-1,000-page response
fail without exposing a partial catalog. Cancellation propagates before and after
awaiting each page. Unknown provider metadata remains preserved. The documented
`writerWithoutPrivateAccess` role is recognized by the read schema, while the existing
write gate deliberately continues to deny it pending a private-event authority adapter.

The initial 15-case RED reproduced the missing collector and restricted-role schema
rejection (14 failures, one conservative-write control). The first implementation
passed 15/15. The added finite-bound test then reproduced one failure with 16 controls
passing in 100 ms, `.runtime/calendar-google-discovery-bound-red.log`. After the bound,
17/17 passed in 112 ms, `.runtime/calendar-google-discovery-bound-green.log`. Biome and
typed ESLint passed on the three affected files. This is in-memory transport evidence
with synthetic HTTP responses, not a durable catalog, production discovery caller,
calendar binding, synchronization or real provider acceptance.

The full typecheck also passed after this collector and its final tests were added,
`.runtime/calendar-google-discovery-types.log`. Its guard exited 0 without a stop
reason. No production build or browser/server acceptance is re-aged by this check.

The earlier source-only `.runtime/calendar-checkpoint-20261101-phase5/` checkpoint captures
the then-qualified lifetime/migration and pure-discovery source with selected nonsecret
evidence logs and hashes. It excludes private environment files, database data,
dependencies and build outputs. Never apply it over the dirty worktree.

## Concurrent browser authorization and admission

The former singleton browser nonce cookie allowed one start response to replace
another attempt's browser binding, and an older terminal response could erase a
newer flow's cookie. The combined 14-case native RED reproduced 12 failures with two
passing controls in 2.91 seconds, `.runtime/calendar-google-browser-flows-red.log`.
This included all six missing owner-admission-cap cases, not just cookie isolation.

Each attempt now uses `CALENDAR_OAUTH_BROWSER_COOKIE_<sha256(state)>`. Its issued
cookie has only the persisted absolute Expires deadline, with no relative Max-Age
override, so a late response cannot extend the browser binding past that attempt.
A validated terminal callback clears only its own state-derived cookie; malformed
or duplicate callback inputs clear none. There is no fallback to the legacy singleton
cookie. Local cookie-jar tests cover reversed start responses, delayed callbacks,
denial, malformed input, cross-flow nonce substitution and the existing same-subject
generation fence. They use real migrated PostgreSQL and synthetic provider transport,
not an actual configured browser/provider consent flow.

Admission is serialized by the existing active-owner lock. A bounded owner/expiry
lookup permits eight unexpired attempts in total across browsers and includes pending,
consumed and cancelled rows because their responses may still be travelling. The
ninth start returns `rate_limited`; HTTP returns 429 without inserting an attempt or
issuing a cookie. Exact expiry frees capacity and another owner has an independent
allowance. Expired rows still await a separate retention sweep. The account card
currently shows its generic start-failure message for 429; contextual quota/retry
feedback remains a refinement, not delivered behavior.

The final combined native selection passed 69/69 cases across 11 files in 11.33 seconds,
`.runtime/calendar-google-browser-flows-all-pg.log`, including the previous 55 lifetime,
snapshot, actual migration, authorization/session/token/offboarding cases plus eight
HTTP cookie-jar and six owner-cap cases. Its owned process exited 0 and the disposable
PostgreSQL cluster was torn down. Full types passed in
`.runtime/calendar-google-browser-flows-types.log`. Scoped Biome and typed ESLint passed
the nine affected files in `.runtime/calendar-google-browser-flows-statics-final.log`
after a test-only abort-reason lint issue was corrected.

The preserved synthetic fixture remains at migration 0091 without an application
restart. The older 152-case reminder, 28-case UI/MCP, 17-case discovery and actual
unconfigured Farsi/German browser checkpoints retain their stated scopes. This phase
does not re-age their browser/build evidence or establish configured simultaneous
multi-flow browser consent, real Google acceptance, installed upgrade or a reconciled
migration cut. After a stopped-service cutover, legacy consent flows must restart;
old/new rolling coexistence remains unqualified. The full goal remains active.

The source-only `.runtime/calendar-checkpoint-20261101-phase6/` checkpoint preserves
this qualified source and selected nonsecret evidence with exact hashes. Phase 5
retains the preceding lifetime/discovery milestone. Neither archive should be applied
over the existing dirty worktree; private environment, database data, dependencies and
build outputs are excluded.

## Current account-card browser acceptance

The private 3169 preview used the preserved migrated fixture and the normal email/password sign-in plus `/auth/continue` path for the regular synthetic owner. It reached the settings page after bootstrap in 118.65 seconds, then served low-load inspection. The Farsi and German card displayed unconfigured workspace, no connected account, a disabled connect control, unavailable synchronization and the preserved authorized-app list. Desktop and 390 by 844 mobile views were inspected; lower controls remained readable through normal page scrolling. German copy was aligned with the surrounding settings page's formal register, then the translation audit and final 28 UI/MCP tests passed again in `.runtime/calendar-connections-final-unit.log`.

Screenshots are saved in the chat outputs as `calendar-google-connection-fa.png`, `calendar-google-connection-de.png`, `calendar-google-connection-fa-mobile.png` and `calendar-google-connection-de-mobile.png`. `Calendar_Connections_Acceptance_2026-11-01.json` contains the filtered post-acceptance SQL observation: active/nonadmin owner, restored Farsi/Persian/Asia-Tehran preferences, zero provider accounts and zero OAuth attempts, with the four shared event versions unchanged.

The viewport was reset and task tab 351774548 was closed. The exact 3169 process group 49956 was verified by arguments and cwd, then stopped; guard/session 17659 exited 0, with about 20.35 GB free afterward. There is no live Calendar preview or worker. A locale catalog edit caused development Fast Refresh and a delayed query compile; the same live process eventually served the complete state without an observation-timeout restart. The existing React script-tag development warning was observed. These are HTTP development-fixture results, not production HTTPS, configured OAuth, real provider or realtime qualification.

## Integration boundary

All Calendar source remains uncommitted on the existing owned branch; no accepted committed Calendar cut or Agency project/activity bridge is supplied by this checkpoint. Peer source review reports divergent post-0082 migration histories. A reconciled combined migration cut and any cross-project bridge need their own review/qualification before main integration. No dirty peer import, source merge, deployment or private-database use was performed.

## Next required work

Phase 7 is active. The new calendar metadata/storage boundary first produced 14
intended failures and three passing controls, then passed all 17 cases. The affected
return passed 34/34 cases across three unit files in 257 ms, including the earlier
collector controls. Evidence: `.runtime/calendar-google-catalog-schema-red.log`,
`calendar-google-catalog-schema-green.log` and
`calendar-google-catalog-boundaries-all-unit.log`. Calendar entries now have typed
hidden/title-override/ETag metadata, PostgreSQL-compatible Unicode/JSON checks and
64 KiB entry, 10,000-entry and 16 MiB aggregate-entry operational bounds. These are
Warpdrive limits, not assertions about Google's limits or HTTP body streaming.

The initial native selection ran all 58 cases across seven files in 8.75 seconds,
`.runtime/calendar-google-catalog-initial-red.log`, using
`.runtime/calendar-google-catalog-red-pg.config.mts`. It produced 56 failures and two
passing controls: 40 failures were missing-API structure, 14 were the absent provider
source column, and two actual access-grant assertions lacked authoritative account ID
and connection generation. This is not evidence of 56 semantic regressions. The
selection covers complete catalog/run ordering, abort/deadline/200-row-batch rollback,
dedicated selection/CAS/tombstones and native source guards with CRM controls.

Source candidates are now written: six catalog modules, two binding modules, the
catalog/binding schema, native source guards and new typed error IDs. The candidate
publisher uses a database-generated SHA-256 identifier hash, exact `COLLATE "C"`
identity comparison on conflict and returned-row counts that reject an incomplete
batch. Disposable PostgreSQL qualification now exercises long opaque identifiers,
exact identity guards and atomic rollback, including a witnessed 201st-row failure. The generated
`0092_calendar_provider_catalog.sql` and snapshot are local, unreserved migration
candidates. Migration 0092 has not been applied to the preserved fixture, which remains
at 0091 without an application restart.

The post-implementation native selection ran 59 cases across eight files in 10.03
seconds: 58 passed and the expired-refresh read-status regression failed for the intended
stale refreshing result. After its read-only deadline derivation was fixed, the
affected return passed all 150 actual cases across 24 files in 22.92 seconds,
including the expiry fix, prior Google controls and native calendar/CRM baselines.
The planned count was 146 because the privacy baseline was mistallied as three
rather than seven loop-expanded cases; file scope did not change. Evidence is
`.runtime/calendar-google-catalog-candidate-pg.log` and
`.runtime/calendar-google-catalog-affected-pg.log`. All 17 server-action boundary cases
passed in 199 ms after a structural missing-module RED. Full types and scoped
Biome/typed ESLint on 33 TypeScript files passed before the expiry-read fix and phase 8
sources. The compact account-row disclosure and protected saved-list query are now written.
The initial 20 cases failed before implementation. Review expanded the selection to
24 cases: 19 passed and five query/refetch/time-zone failures were observed, then all
24 passed after correction. The affected connection return passed 52 cases across
seven files in 2.26 seconds. Full types passed before lint-only null-case/test-mock
typing corrections; current translation audit, Biome on 44 TypeScript plus three
locale JSON files and typed ESLint on 44 files pass. Biome retains one informational
notice for the explicit null branch required by typed exhaustiveness. Browser
acceptance of this panel has not run. Earlier browser/build evidence is not re-aged.

The candidate contract is `.runtime/calendar-catalog-DESIGN.md`: a complete durable
catalog, independent latest-run authority, stable rows and explicit NEW dedicated
provider calendars. The candidate selection service creates a non-primary marked
provider calendar and stable binding together, with no existing personal/CRM-calendar
target. Source markers and selection tombstones must survive Remove/disconnect/deletion;
native owner/admin shortcuts must not grant provider authority. Until projection and
outbound adapters exist, source guards are intended to hide those internal calendars
and deny generic native read/write/sharing paths. This source is not a qualified sync,
event-import or Meet workflow. The full roadmap remains required, and no Google Cloud
app or synthetic provider-account setup is available.

Continue expired-attempt retention cleanup and qualification of the durable catalog/binding candidate before mirror/write/sync/conference state, using the locally tested connection generation to fence future background operations. Configured browser consent/reconnect/disconnect, simultaneous multi-flow browser acceptance and actual Google account-policy acceptance remain open; the former shared-cookie interference now has a local tested fix. Clearer quota/retry feedback can refine the current generic 429 start-failure state. Reconcile local candidates 0091 and 0092 and the rest of the divergent migration history before any accepted combined integration; local migration fixtures do not establish an installed upgrade. Recurrence and exceptions, Iranian recurrence, invitations/RSVP, resources/scheduling, attachments/sharing details, Microsoft/Teams, Zoom, ICS and special event lifecycles retain their full roadmap scope in `calendar-acceptance-register.md`.

The local candidate now has a complete account-scoped catalog and owner-only selection
into a stable dedicated local calendar in its tested scenarios. The 150-case return
establishes authoritative account/generation capture with an access grant and
independent discovery-run authority so an older run cannot restore stale permissions.
Only a fully collected catalog replaces the previous snapshot. Pagination-failure,
competing-run, reconnect/disconnect, stable binding identity and read-only/deleted-role
checks passed in this local scope. Event projection and external writes remain future
work. A separate source review found that OAuth consume/bind sample time before an
owner lock wait; two deterministic real-PostgreSQL regressions are frozen but unrun,
and no production correction has been made for that separate finding.
The current Activity creation repository generates new IDs and enables reminders by
default, so it is not an idempotent import adapter. A first-import package needs
external-event identity, raw payload/ETag, stable Activity linkage and an explicit
import reminder policy before it can project historical provider events.

The source-only phase 8 recovery checkpoint is `.runtime/calendar-checkpoint-20261101-phase8-local`: catalog/UI source and selected synthetic logs, excluding environment files, database data, dependencies and build outputs. Manifest/archive verification and exact counts are recorded in its `summary.json` and `SHA256SUMS`. Never apply a recovery archive over this dirty worktree.

After the phase 8 recovery capture, the guarded preserved-fixture 0092 upgrade passed in
0.196 seconds, retaining all original event/calendar fields and versions, native sources
and zero provider state. The original PostgreSQL process remains intact. The two
OAuth lock-wait regressions then failed semantically and passed in 0.915 seconds after
the clock callback moved inside the locks; the broader 152-case return and fresh types
remain pending. A new disconnect-cache unit regression failed as intended: confirmed
local disconnect left metadata visible after account-refetch failure. Its isolated UI
correction and 53-case affected return are in progress. The phase 8 archive remains the
earlier verified snapshot, not a capture of these later changes.

The final clock/cache return passed 152/152 native cases across 25 files in 25.31
seconds, with all 53 frozen source hashes unchanged and disposable PostgreSQL stopped.
The current affected unit return passed 53/53 across seven files in 2.21 seconds; fresh
full types, translation audit, Biome on 50 TypeScript plus three locale JSON files and
typed ESLint on 50 files pass. Independent source reviews found no concrete defect.
The source-only phase 9 recovery checkpoint is
`.runtime/calendar-checkpoint-20261101-phase9-local`; exact hashes, archive verification
and counts are recorded in its summary/checksums. Browser seed/preview/cleanup remain
unrun, and the mirror/retention packages remain future work.


## Actual synthetic catalog acceptance and restoration

The later browser window passed saved-catalog UI/server/PostgreSQL acceptance in Farsi and German at desktop 1512 by 771 and mobile 390 by 844, with no horizontal overflow. The unique `calendar-catalog-b06ded0c.localhost:3169` origin isolated the synthetic session cookies from protected previews. Normal sign-in used the existing regular synthetic owner. Disclosure opening read saved state without discovery. Availability-only Add was disabled. One Add, Remove and re-Add retained stable binding/dedicated-calendar identity and advanced versions 1/2/3. Selection persisted across navigation and locale change. One local Disconnect advanced account version/generation to 2, cleared the refresh bytes and hid catalog metadata. No provider connection, discovery, event synchronization, invitation or conferencing operation was invoked.

The original Farsi/Persian/Asia-Tehran preferences and 1512 by 771 viewport were restored, and the owned tab was closed. Exact cleanup restored the full original ten-table snapshot, all four event versions and the original environment, with zero provider accounts/attempts/catalog states/entries/bindings remaining. The 53 previously qualified source hashes stayed unchanged. The original PostgreSQL fixture remains intact, and no database was recreated. The entire execution/release window was 934.81 seconds, below its 1,200-second cap.

The preview wrapper exited 1 when its post-stop process-group liveness probe received EPERM. Fresh independent `ps` and listener inventories established group 96044 empty and port 3169 absent. There was no restart. `.runtime/calendar-catalog-preview-shutdown.json` is the terminal verification receipt; the earlier preview-state file is stale. The exact used guard bytes were preserved in `.runtime/calendar-catalog-preview-guard-used-20261101.py`. The corrected current guard uses ownership-checked process inventory, but has not been executed or qualified.

Filtered acceptance and five native screenshots are in the chat outputs as `Calendar_Catalog_Acceptance_2026-11-01.json` and `Calendar_Catalog_{FA,DE}_{Desktop,Mobile}_2026-11-01.jpg`, plus `Calendar_Catalog_FA_Disconnected_2026-11-01.jpg`. Seed/account rows used inert noncredentials and dummy Calendar configuration. This is local synthetic evidence, not real Google, production HTTPS/realtime, installed or combined migration-cut acceptance. The backend's disconnected local Remove remains distinct from a future offline binding-management UI.

The ignored `.runtime/google-event-sync-bounds-draft/` package produced nine intended RED failures and three passing preservation/abort controls in 197 ms, `.runtime/calendar-google-event-sync-bounds-red.log`. The candidate enforces operational page/event/entry/aggregate/depth bounds, exact duplicate-ID rejection and PostgreSQL-safe JSON while retaining raw recurrence/cancellation data and collector cursor/abort semantics. Its twelve-case GREEN is queued, no candidate is promoted, and no new app/database/provider campaign is authorized by this checkpoint.

The verified post-browser phase 10 recovery archive is `.runtime/calendar-checkpoint-20261101-phase10-browser`: 280 source files (60 changed tracked and 220 untracked), 65 selected evidence files and all five actual catalog screenshots. Source manifests, archive contents and checkpoint checksums were verified. Manifest SHA256 is `82eba48cbe2fd60a0d44007e7cab2e341eefbabc9b7eb1abb883c4fecddc5400`. It preserves the browser acceptance/restoration and staged event-bounds RED state before any promotion. Private environment files, database data, dependencies and build outputs are excluded. Never apply this snapshot over the existing dirty tree.

The expired OAuth-attempt cleanup now has a frozen, ignored eight-case real-PostgreSQL test draft in `.runtime/calendar-oauth-retention-draft/`. It covers exact expiry, preserving every unexpired lifecycle state, oldest-200 batches, skipped locks, concurrent disjoint sweeps, owner/account isolation, expired in-flight callbacks and abort rollback. No cleanup API, index, migration or job was implemented or executed. Its initial absent API is structural only; a future named native slot must establish semantic RED before implementation.

The reviewed 16-case ignored candidate run is now actual RED: four intended cursor-budget/Unicode assertion failures and twelve passing bounds/preservation controls, across two files in 392 ms. The canonical owned wrapper ended in 1.54 seconds with no stop, all 61 frozen inputs unchanged and group 13910 independently verified empty. The staged cursor correction is written after that RED; all test/fixture/config inputs and prior 53 application hashes are unchanged. Its same-16-case GREEN is separately queued. No promotion, database/application start or provider request occurred.

## Interim event-collector checkpoint before final checks

After the original nine policy failures and three preservation controls, the candidate's four new cursor regressions failed for the intended UTF8/retention/Unicode behavior. The same sixteen cases then passed in 384 ms, with all 61 frozen inputs unchanged and the owned process group empty. The collector, storage helper and regression fixture/tests were promoted locally. Policies are 1,000 pages, 50,000 events, 1 MiB per raw entry, 32 MiB aggregate entries, depth 32, 64 KiB per returned cursor and 1 MiB retained page-token text. Duplicate IDs and PostgreSQL-unsafe Unicode are rejected. Full/incremental query, sparse cancellation, recurrence data, error and abort preservation retain their stated tests. These are Warpdrive policies after JSON parsing, not provider limits or peak HTTP-body/validation memory bounds.

The first promoted-source static check found one synthetic fixture async-without-await error. That fixture was corrected; Biome and typed ESLint then passed on all five files in 6.06 seconds, with no guard stop and all 58 protected inputs unchanged. Three computed-key notices were informational. Formatting expanded the main test file to 309 lines, so its unchanged twelve bodies were split into 200-line collector and 132-line payload suites under the repository small-file convention. Together with the four cursor tests, the package still has sixteen regression cases across three files and six promoted source files. No production behavior changed during the split.

At the phase 11 capture, the two split test files still needed their static return, the seven-file 53-case affected return and a fresh full typecheck. Those checks have since passed as recorded below. The source is quiet; no Calendar test, native database, app, worker or build process is live. No event mirror, Activity import, background synchronization, invitation or Meet workflow is implemented by this collector. The goal remains active.

The ignored future packages are also preserved: eight real-PostgreSQL OAuth-retention cases (ordering strengthened with opposing expiry/hash cohorts) and eleven page-visitor authority/staging cases (empty and nonempty pages covered). Both are unexecuted. The cleanup has only an ignored fail-closed scaffold; the mirror visitor is absent. Structural missing-API status is separate from behavioral RED.

The phase 11 source-only recovery archive is `.runtime/calendar-checkpoint-20261101-phase11-event-bounds`: 285 source files (60 changed tracked, 225 untracked) and 94 selected evidence files. Archive contents, all source hashes and checkpoint checksums were verified; manifest SHA256 `60772df3365b313ae25696980afabacb6786ba1b08a0916c5f69c52d27b80454`. It preserves the promoted collector and exact pending split-test/app-return boundary. It excludes private environment, database data, dependencies and build outputs. Never apply it over the dirty worktree.

## Final pure-collector qualification

The promoted event collector now passed its final app-source return: **53/53 unit cases across seven files in 715 ms**, covering sixteen new bounds/cursor regressions and 37 existing client/path/transport/error controls. Scoped Biome and typed ESLint pass for all six current files, including the two split suites. Fresh full TypeScript passed in 3.04 seconds. Every protected input stayed unchanged; the owned groups were verified empty. Three computed-key Biome notices are informational.

[Event-collector proof](/Users/ali/Documents/Codex/2026-10-31/warpdrive-calendar-continuation/outputs/Calendar_Event_Sync_Bounds_2026-11-01.json) records operational limits, actual RED/GREEN results, current source hashes and exact scope. This is a pure transport qualification, without a durable mirror, import, background sync/watch, outbound event/Meet/invitation operation, new build/browser proof or real provider acceptance. The previous catalog/native/browser evidence retains its original scope.

The next local cleanup selection is nine unrun real-PostgreSQL cases across two files: the eight behavioral cases plus one physical expiry-first global-index assertion before any schema/index generation. Its owned finite native profile is being prepared, with no process or database start. The eleven page-visitor tests remain frozen and unrun. The full roadmap remains active.

The verified phase 12 recovery archive is `.runtime/calendar-checkpoint-20261101-phase12-event-bounds-qualified`: 285 source files (60 changed tracked and 225 untracked) and 115 selected evidence files, including the qualified collector receipts/proof, existing five catalog screenshots and prepared future profiles. Manifest SHA256 is `b7e769ecf4f46d1cfae0ce330015c3439aa6bdd781c2ef6e7f0b4ff97efb1a8e`. Source hashes, archive contents and checksums were verified. The page-visitor RED preparation is eleven unchanged cases across three focused files with 121 frozen inputs and an ignored fail-closed scaffold. The retention RED preparation is nine cases across two files with 373 frozen inputs, a 90-second cap and exact owned-PG/overlap/cleanup guards. Both are unexecuted; no functional visitor, cleanup API, new index or migration is implemented. The existing full roadmap and real-provider gates remain active. Snapshots exclude private environment, database data, dependencies and build outputs; never apply them over the dirty tree.
