# Local integrations implementation record

Approved 31 October 2026. Active goal: deliver the approved P0/P1 plan, beginning with independent email, preserving the current UI, Gmail, Better Auth, permissions and FA/DE/EN workflows. P2 remains deferred.

Original baseline: main `8539fe8c4aeb0b58b6d05e629710460ef90bbed4`. Current committed base includes exact latest auth refinement history at `a1a8f6da1ce366c35002900bf33508356dfbb995`. Work is isolated on `codex/local-integrations`; the main checkout and its preview are preserved.

## Current implementation

- IG-01: additive provider-neutral account/message/thread/attachment identifiers, multiple personal mailboxes and deterministic default sender. Existing Gmail UUIDs and identifiers are retained. Fresh-schema tests pass; migrated-installation and export/restore rehearsals remain required.
- IG-02: encrypted, short-lived credential checks bound to a verified fresh native session; safe endpoint/DNS/TLS policy; opaque single-use proofs; lifecycle management and FA/DE/EN setup UI. Gmail state now uses session-bound PKCE and the same fresh-authority fences. Security tests pass; full browser acceptance remains pending.
- IG-03: bounded historical/incremental IMAP sync, UIDVALIDITY recovery, folder cursors, metadata reconciliation, private lazy attachments, MIME sanitation and realtime invalidation. Native TLS and real PostgreSQL tests pass. Authoritative Trash/Junk folders are excluded from ordinary history; remote-operation tests are still being completed.
- IG-04: SMTP acceptance/partial/unknown outcomes, immutable attachment snapshots, durable receipts, safe Sent-copy append and idempotent CRM repair. Shared interactive and scheduled-worker paths work without Gmail credentials. Payload preparation is atomic and workers cannot send unprepared signature/tracking content. Native TLS/PostgreSQL tests pass; UI review and actual self-hosted server qualification remain pending.
- IG-05: active work on mailbox selection, complete draft continuity, reply account locking, read/unread/move/trash capability gates and Gmail regression coverage. Draft Bcc, attachments, tracking preferences and a stable send intent are persisted. Uncertain/partially accepted attempts cannot be canceled to bypass duplicate protection.
- IG-06: active work on selected-country phone normalization with original input retained and independent currency/unit preferences. Ali approved exact IRR/toman examples on 31 October 2026: 1,234,560 IRR becomes 123,456 toman; 1 IRR becomes 0.1 toman. Canonical IRR and exact arithmetic remain unchanged; no rounding or FX is introduced, and UI language never changes currency/unit.
- IG-07/08 and P1 implementation remain pending. Public provider access, real external messages/calls/financial writes, paid services and pilots have not been authorized. No live-provider operation, production readiness or pilot completion is claimed.

## Verified checkpoints

All database tests use disposable real PostgreSQL. Protocol tests use actual encrypted sockets and synthetic credentials, never a mocked database. Tests begin with failing behavior.

- Connection/OAuth/token/offboarding/maintenance security: 203 PostgreSQL tests across 37 files passed at the security checkpoint.
- SMTP outbox/attachment/recovery: 25 PostgreSQL and TLS cases passed before the additional preparation gate, which is covered by the shared preparation suite.
- Shared preparation/send/legacy outbox: 20 cases passed. Gmail generation fencing, storage-before-submission and existing send/attachment regressions: 27 cases passed.
- Provider routing and scheduled-send promotion passed without resolving Google credentials for independent mail.
- Complete draft copy/security: 14 cases passed; receipt-aware draft/cancellation/send checkpoint: 7 cases passed.
- IMAP/stored download: 19 PostgreSQL cases and four Unicode download-header cases passed; subsequent invited-owner fencing passed through actual in-flight I/O.
- FA/DE/EN setup/fresh-auth UI: 65 cases passed. Composer review/autosave tests are still being expanded.

These are scoped checkpoints, not a final consolidated test count. Final typing, lint, translation checks, application/worker builds, browser workflows, migration/restore rehearsal and provider qualification are still required before acceptance. Tests travel with the implementation; private environments, secrets and disposable test logs are excluded.

## Coordination and local acceptance update

Ali authorized coordination with the parallel platform goal. The agreed handoff is `mail-platform-reconciliation.md`: platform owns shared CONN/EVT, MAIL retains its working domain/security/UI. Integrated migrations85..91 are reserved for mail; the running disposable local88 preview is preserved, and a separate combined source/database candidate must qualify the merged metadata and upgrades. No SMS credentials, registry or dispatch engine is duplicated.

Actual native signup, email verification, password login, TOTP enrollment and fresh identity confirmation passed through the Farsi UI. Strict-TLS independent mailbox setup, sender switching with a retained original draft, SMTP acceptance, one recipient IMAP delivery, one explicit Sent append, Persian/German sender-name wire/CRM preservation and one CRM copy passed against the controlled GreenMail2.1.15 server. This is local-server evidence, not external mailbox qualification. German/English follow-up flows and final source-snapshot comparison remain pending.

Host disk exhaustion interrupted later browser checks. Only stopped, ignored preview cache was removed (about772MiB); source, databases, objects, private auth/session material and other previews were preserved. QA resumes in an isolated private shadow project and heavy checks are serialized with the platform owner. A genuine unhandled pg-boss error-event crash was fixed with a redacted observer while preserving native retries and fatal startup behavior; targeted real-PG recovery tests pass. Final application/worker builds and consolidated gates remain pending.

The SMS pure estimator has133 passing tests and preserves original FA/DE text with explicit encoding/billing uncertainty. Kavenegar remains qualification/design only until the shared connection/effect interfaces are available. The dependency audit retains nine baseline findings across six packages; `dependency-security-qualification.md` records current reachability, incompatible blind-override risks and required follow-up qualification. No new dependency advisory was introduced.

## Frozen source follow-up

The final narrow transport checkpoint passed 76 native TLS/MIME cases (42 IMAP, 11 MIME, 23 SMTP). IMAP now bounds unsolicited FETCH rows/literal bytes and total session traffic through public streaming APIs; overflow during a mutation remains uncertain. The worker/startup checkpoint passed 18 unit and 3 real-PostgreSQL cases, including killed owned connections and native retry recovery. Custom monetary entry labels passed 144 related UI/unit cases, including FA/DE toman display with explicit canonical IRR input.

Two actual regressions were reproduced before fixes: tracking tokens remained disabled after a safe same-intent retry, and an actively leased SMTP submission appeared abandoned while waiting for acknowledgment. The tracking retry cases passed; the first five-file PostgreSQL rerun was21/22 with the active-status case still failing. Its source correction and public-projection unit cases are now passing, while the updated PostgreSQL rerun remains pending the serialized validation window. Next development logging of server-action arguments is disabled, with a failing-then-passing configuration check, to avoid logging credentials, CSRF values or private content.

Structured delivery-status/bounce observations remain an explicit IG-04 acceptance gap. SMTP acceptance is not recipient delivery, and an unauthenticated message/report cannot authorize resubmission or silently overwrite submission certainty. This source checkpoint does not close that gap or the remaining browser, combined-migration/restore, build and external-provider gates.

The expanded active-lease regression reproduced a second premature-review branch in the failure projection. Its isolated correction is committed as `27326c6`. The final five-file real-PostgreSQL/native-TLS rerun passed 22/22 cases, including tracking retry, active send/status/failure reads, receipts, snapshots and concurrency. Source cuts are `aab6c3d` (queue/logging) and `297c1dd` (mail/regional checkpoint). This does not imply the broader release checks passed.

IG-08 review also found that notification email still selects a legacy single mailbox and sends through the Gmail-only system primitive. Provider-neutral dispatch, deterministic active/default mailbox selection and uncertain-retry preservation need a real-PostgreSQL/native-SMTP regression before this Google-free workflow can be accepted. Existing visibility, opt-out and recipient-language checks must remain intact.
