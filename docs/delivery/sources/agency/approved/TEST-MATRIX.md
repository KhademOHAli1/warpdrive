# Agency Projects: expected passing tests and evidence

31 October 2026. These 36 families specify expected behavior. They are not tests already implemented or passing. Each task's expected-passing-tests field names applicable families and its concrete invariant. Use meaningful test-first cases; database behavior uses real PostgreSQL, never DB mocks.

## Domain, authority and coordination

| Family | Required passing scenarios |
| --- | --- |
| T00 Source and task provenance | Exact base/owner SHAs and dirty boundaries recorded; no dirty source imported;96 unique task IDs and valid DAG; source manifest updates after adoption; no peer service touched; private runtime excluded; source/static/runtime/release evidence distinguishable. |
| T01 Boundary/schema validation | Invalid UUID/cross-project FK/unsupported version rejected; Unicode Farsi/German names preserved; bounded brief/comment/URL/JSON fields; null/unknown differs from empty/zero; malicious control/HTML/URL input safe; atomic rollback and stable idempotency key. |
| T02 Record visibility | Hidden project/customer/deal/contact remains hidden through direct ID, list, joins, counts, autocomplete, summaries, exports and references; adding contact/assignee never grants access; archived pipeline behavior preserved; indistinguishable missing/foreign denial. |
| T03 Current authority | Native session/CSRF/account policy enforced; suspended/invited/removed staff denied; current resource/field capability rechecked at execution; stale actor/grant/revision invalidates queued work; no client allow flag or admin-role-name bypass; MCP scope intersects CRM authority. |
| T04 Activity bridge | Project visibility intersects every activity list/calendar/get-edit/complete/search/feed/export/MCP/realtime path, including batch in-memory projections and parentless participants; no broadened parent fallback; one canonical state/due/reminder owner; linked task cleanup/reassignment cannot leak a private brief. |

## Client commitments, dates and assignments

| Family | Required passing scenarios |
| --- | --- |
| T05 Client-update semantics | Different contacts can have different channels/roles/cadences; draft/copy/reminder completion is not sent evidence; staff-recorded updates retain provenance; queue says last recorded update; missing WhatsApp history is not inferred complete; explicit cadence and recipient required. |
| T06 Commitment concurrency | Duplicate log requests create one record; complete/snooze/reassign races yield one current revision; original promised date/reason/history retained; recorded correction does not erase evidence; stale dashboard writes fail with actionable recovery. |
| T07 Regional date intent | Persian/Gregorian civil round-trip including Nowruz and leap boundaries; Persian/German digits accepted where intended; Asia/Tehran and Europe/Berlin DST/ambiguous/nonexistent instants; date-only does not drift on timezone/language switch; workweek/holiday rule is explicit; midnight/account-local default, unscheduled work and long offsets tested. |
| T08 Freelancer identity | Freelancer contact and internal producer user are distinct; same-name/shared-email people remain distinct; external assignment/acceptance record creates no auth user, workspace membership, credential or automatic outbound message; inactive producer and inaccessible contact rejected. |
| T09 Domain transitions | Every allowed/forbidden project/assignment transition tested; expected revision required; approved/canceled/reopened states retain history; status cannot advance from an unqualified external claim; actual racing edits have deterministic one-winner conflict behavior. |
| T10 Dependencies and deadlines | Internal freelancer deadline and client milestone remain distinct; missing dates/blockers are explicit; cyclic/cross-project dependencies rejected; date changes preview downstream impact; canceled/archived parents fence work; blocked state does not silently rewrite original promise. |

## Templates, feedback and approval

| Family | Required passing scenarios |
| --- | --- |
| T11 Template installation | Immutable manifest validation and exact preview; unresolved owner/contact/capability prevents apply; 100 concurrent retries create one intended instance/mapping; mid-install transaction failure leaves no partial effects; existing WF/activity commands reused; install does not activate sending. |
| T12 Template evolution | Installed version and overrides survive source changes; explicit diff/apply; completed tasks and recorded approvals retained; stale upgrade conflicts; deleted roles/actions handled; restored mappings prevent duplicate task creation. |
| T13 Feedback records | Bounded sanitized text, Farsi/German content and external version reference preserved; multiple reviewers and contradictions recorded; change-request conversion deduplicated; hidden project/reference inaccessible; no asset fetch/upload/render engine added. |
| T14 Review decisions | Decision binds exact deliverable/version and actor/method/evidence; staff-recorded approval never impersonates authenticated client/signature; new content/version does not inherit approval; concurrent approve/change fails safely; revoked reviewer and removed source do not expose history. |
| T15 Revision and commercial scope | Included, unknown and exhausted rounds distinguishable; requested change is not automatic charge; extra scope requires explicit reviewed financial handoff; reopen retains approval history; no invoice/payment/tax/accounting effect follows feedback. |

## Existing engines and external effects

| Family | Required passing scenarios |
| --- | --- |
| T16 Atomic admission and replay | Domain rollback emits no event/effect; durable intent and record commit atomically through accepted services; unavailable shared API stays disabled; no second engine/outbox; replay/import/restore/duplicate callbacks do not create external actions; template install versus activation explicit. |
| T17 Scheduling and recovery | Actual pg-boss queue missing/unavailable, process interruption, expired claim, reschedule, complete, archive and revoke cases; one logical reminder; queue nudge failure does not report committed save as unsaved; current snapshot checked before delivery; canceled historical intent never revives. |
| T18 MAIL and communication certainty | Use actual owner-selected capable mailbox and native/shared authority; paused/disconnected/invited-owner/opt-out and source-visibility revocation before dispatch; same effect binds one original attempt; accepted/partial/unknown holds never blindly retry; draft versus recorded versus accepted/delivered/replied labels; strict-TLS controlled native mail tests without external recipients. |

## Privacy and finance

| Family | Required passing scenarios |
| --- | --- |
| T19 Inventory coverage | Every agency table/writer/queue/cache/JSON/history/template/export/recipient registered; unknown boundary fails coverage; lifecycle capabilities supported only with adapter evidence, otherwise explicitly unavailable; no unreviewed fingerprint/claim auto-acceptance. |
| T20 Subject/lifecycle boundaries | Contact/author/assignee/email does not identify an entire project as one subject; third-party and financial redaction; current privacy case authority/verified recipient binding; real restriction/erasure fences rechecked by jobs; retention/hold/archive distinguished from verified erasure; restored restricted data cannot resume processing. |
| T21 Exact money | Canonical currency values and explicit quote/cost provenance;1,234,560 IRR=123,456 toman and 1 IRR=0.1 toman exactly; chosen unit survives German switch; decimal rate/quantity contract tested; no implicit FX or cross-currency sum; amount/unit label clear; unknown not zero. |
| T22 Bounded margin | Hand-calculated quote/commitment/actual fixtures agree; incomplete/unverified costs visible; revised quote cannot change approved baseline silently; negative/zero/missing values intentional; estimate/tracked margin not full profit, cash or accounting entry; no invented tax/revenue-recognition rule. |
| T23 Financial disclosure | Separate read/write financial capability; denied fields absent from DTO/HTML/serialized props/filter/count/export/notification/MCP/realtime/audit payload; ordinary producer/freelancer-contact visibility does not reveal agency margin/client pricing/other fees; current revocation fences cached/queued reads. |
| T24 Optional-module behavior | Server enablement and current capability gates for reads/writes/jobs/effects; disabled navigation alone insufficient; disable preserves history and prevents new effects; re-enable does not replay prior imports/history; old CRM journeys unchanged. |

## UI and operational acceptance

| Family | Required passing scenarios |
| --- | --- |
| T25 FA/DE/EN actual workflows | Native login; create/update/reload project; select contact and producer; client commitment; assign/submit/review freelancer work; template preview/install; feedback/new version/approval; denied/error/retry/conflict/read-only/archived states; independently selected calendar/timezone/digits/currency retained. Actual browser persistence required. |
| T26 Accessibility/current UI | Existing typography/tokens/adapters preserved; 390px mobile and desktop; light/dark; 200% zoom; keyboard/RTL navigation, dialog trap/Escape/return focus, clear labels, long German and mixed bidi names/URLs; no unintended overflow; reduced-motion behavior. No unmeasured accessibility claim. |
| T27 Scoped saved views | Existing Sales decoder/query authority reused; valid legacy definitions retain behavior; malformed/unsupported filter visibly unavailable; shared view never grants records; project and financial filtering cannot widen result scope. |
| T28 Bounded scale | Stable keyset/cursor paging with page cap and indexed due/owner/state lookups; declare synthetic workload and host; at least 200 projects / 1,000 assignments / 5,000 feedback records for first characterization; measure query/response p95 and memory; agree regression budgets from measured baseline, not invented throughput; cancellation bounds long exports. |
| T29 Audit and diagnostics | Successful mutations have correct actor/revision/correlation; rollback has no false success audit; external recorded decisions retain method; routine logs/error context contain no credentials, addresses, briefs, rates, hidden content or raw provider bodies; new error domain format/uniqueness test updated without weakening it. |
| T30 Migrations | Actual fresh SQL and supported retained-source upgrades; platform immutable0..84 plus owner-approved forward deltas and fresh timestamps; allocator reservation honored; no applied-ledger rename; preserve CRM/auth UUIDs/ciphertext and workflow SQL-only guards; final schema diff and intermediate backfills both checked; migrator rerun no-op. Unsupported divergent ledger explicitly rejected. |
| T31 Restore/restart | Matching-major pg_dump plus fresh pg_restore in owned DB; application keys/references/IDs and graph counts verified; canonical task/template/approval mappings retained; restrictions and uncertain-send holds preserved; no import/history replay sends; external asset-store restore not claimed by DB restore. |
| T32 Cross-branch regression | Existing login/MFA/recovery, pipeline/archive/create, saved views, customer/deal/contact reads, mailbox setup/send/status, calendar save/privacy/reminders, Settings forms and Privacy registry/case authority remain intact on the combined candidate. Historical peer suite results are not a new pass. |
| T33 Archive/reopen/cancel | Soft archive preserves history and forbids new work; explicit reopen checks current permission; archived parents/pipelines/calendar membership handled; assignment/user removal cancels stale intent; restore is permission-safe and not consent to send. |
| T34 References/import/export safety | No new asset upload/download/hosting surface; existing file grants remain authoritative; safe URL schemes and no SSRF preview; CSV formula/path/archive safety; explicit external-ID mapping and shared-name ambiguity; imported/history rows cannot create external effects. |
| T35 Delivery truth and documentation | Package/task/source hashes and statuses consistent; documented actions exist; operator/user FA/DE/EN guides; actual source/runtime/provider/pilot/production evidence distinct; no unsupported portal, invoice, WhatsApp-sync, privacy-erasure or profit claim; final goal remains open until required scope is accepted. |

## Per-release required checks

Use the pinned Bun version and current package scripts from the selected candidate. Typical commands, to be verified in that checkout:

```sh
bun install --frozen-lockfile
bun run i18n:check
bun run typecheck
bun run lint
bun run test:unit
bun run test:integration --maxWorkers=1
bun run build
bun run build:workers
bun run ui:audit
```

Run meaningful scoped red/green checks during each increment. Run consolidated relevant/full checks for a release after dependencies converge. Avoid repeating broad campaigns without new changes or unresolved concerns. A production app build and all declared worker bundles must pass for the exact candidate; unit/type success is insufficient.

Coordinate one finite heavy window with the platform owner. Verify available disk/memory and service ownership before phases; recent shared pressure caused ENOSPC and queue failures. Use distinct ignored local configuration and synthetic data. Never start a broad worker with real/imported provider rows, stop a peer process, print private logs or clean another chat's generated output.

## Evidence record per task/release

Record source SHA/dirty status, exact command/environment, actual start/end, exit status, test counts reported by the tool, artifact paths and remaining limitations. Red/green logs are bounded and sanitized. Browser captures record source/runtime hash, locale/calendar/timezone, viewport/theme and actual observed persistence. Real participant review is separate from automated tests; unavailable reviewers/providers do not become fabricated passes.

Expected tests are acceptance requirements. No family is marked passed by this planning document.
