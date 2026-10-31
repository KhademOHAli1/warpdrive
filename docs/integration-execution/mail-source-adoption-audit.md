# MAIL source adoption preparation

31 October 2026. Independent read-only source audit. **Prepared, not adopted or qualified.**
No application source, dependency, migration, tracker, peer file or running preview was
changed. No tests, installation, build, PostgreSQL, browser or provider operation was run.
This record does not extend programme scope or import the separate planning amendment.

## Immutable evidence and ancestry

Inspected Git objects from `/Users/ali/Developer/warpdrive-integrations`, rather than
copying its working tree. Its observed branch was `codex/local-integrations`, HEAD
`de74493999dfeac5dc8ebdbf3902e4b5022184ae`, with ten untracked paths. The separate
`/Users/ali/Developer/warpdrive-mail-platform` worktree was registered at `b8b2708` on
`codex/mail-platform-candidate`. Its mutable combined work is **not an accepted source**
and was not used to establish implementation or migration acceptance here.

| Anchor | Full commit | Actual parent | Audit treatment |
| --- | --- | --- | --- |
| Safety | `aab6c3d0d64eb014a526d270a9bada92a01dc5a8` | `a1a8f6da1ce366c35002900bf33508356dfbb995` | Eleven queue-observation/development-diagnostics paths; platform already reconciled this change. |
| MAIL | `297c1dd5dbff4e19f6d1559a16bb258cc3368577` | `aab6c3d0d64eb014a526d270a9bada92a01dc5a8` | Main implementation checkpoint: 466 changed paths, 315 added and 151 modified. |
| Send-status correction | `27326c6808f75645f086149beeaf1e9f89db9e7d` | `297c1dd5dbff4e19f6d1559a16bb258cc3368577` | One source path, `sendFailureOutcome.ts`; preserve this correction when selecting a cut. |
| Guides | `de74493999dfeac5dc8ebdbf3902e4b5022184ae` | `27326c6808f75645f086149beeaf1e9f89db9e7d` | Three FA/DE/EN guides, progress record and `.env.example`; no further runtime change. |

Each preceding commit is an actual ancestor of the following commit, verified with
`git merge-base --is-ancestor`. Safety precedes MAIL; it is not a later MAIL fix.
The comparison platform anchor is `bc40519b4f8f7147f6232897c26450bb8c478816` in
`/tmp/warpdrive-integrations-preview-20261031`. Platform copy patch is
`4099c9fdc079cce876430a1a8712a1442dde6188`; reconciled safety is
`6b71b771d921df8930eebc15259ec0648bff0b73`. Recheck any later platform head before adoption.

References below use `MAIL:path:line` for `297c1dd`, `SEND:path:line` for `27326c6`,
`GUIDE:path:line` for `de74493`, and `PLATFORM:path:line` for `bc40519`. Line numbers
refer to these immutable blobs, not to a moving peer checkout. The allocation ledger
is the platform owner's current source reservation, separately identified below.

## Checkpoint breadth and dependency delta

MAIL changes 320 paths under `src/features/email`, thirteen migration/metadata paths,
and shared authentication, settings, regional formatting, phone, contact, import,
composer, realtime, configuration and error/job registries. It also contains the pure
`src/features/sms/smsSegmentation.ts` and its test. Presence in this commit does not
authorize adopting new SMS domain/provider work or the separate task amendment. The
owner must select and review the intended adoption boundary explicitly.

The package delta from the actual MAIL parent is exact:

| Section | Added pinned dependency | Immutable reference |
| --- | --- | --- |
| Runtime | `imapflow` `2.10.0` | `MAIL:package.json:80` |
| Runtime | `libphonenumber-js` `1.13.15` | `MAIL:package.json:83` |
| Runtime | `mailparser` `3.14.1` | `MAIL:package.json:85` |
| Development | `smtp-server` `3.21.3` | `MAIL:package.json:144` |

No existing direct version, script, override or `packageManager` changes in MAIL;
Bun remains pinned to `bun@1.4.4`. Safety and the two follow-ups add no package delta.
Platform also has `@xyflow/react` `12.12.0`, absent from the MAIL package file. Replacing
the whole package or lock file would lose the adopted workflow dependency.

`bun.lock` adds four workspace declarations and **46 resolution entries**, removes
none, and changes two existing resolution entries. All 46 additions, including aliases,
are enumerated below to make the transitive delta reviewable:

```text
@pinojs/redact@0.4.0
@selderee/plugin-htmlparser2@0.12.0
@selderee/plugin-htmlparser2/domelementtype -> domelementtype@2.3.0
@selderee/plugin-htmlparser2/domhandler -> domhandler@5.0.3
@zone-eu/mailsplit@5.4.29
atomic-sleep@1.0.0
deepmerge-ts@8.0.2
dom-serializer/domelementtype -> domelementtype@2.3.0
dom-serializer/domhandler -> domhandler@5.0.3
domutils/dom-serializer -> dom-serializer@3.1.1
domutils/dom-serializer/entities -> entities@8.0.0
encoding-japanese@2.4.0
he@1.2.0
html-to-text@10.0.1
html-to-text/htmlparser2 -> htmlparser2@10.1.0
html-to-text/htmlparser2/domelementtype -> domelementtype@2.3.0
html-to-text/htmlparser2/domhandler -> domhandler@5.0.3
html-to-text/htmlparser2/domutils -> domutils@3.2.2
iconv-lite@0.7.3
imapflow@2.10.0
ipv6-normalize@1.0.1
leac@0.7.0
libbase64@1.4.1
libmime@5.6.3
libphonenumber-js@1.13.15
libqp@3.0.1
linkify-it@5.0.2
mailparser@3.14.1
on-exit-leak-free@2.1.2
parseley@0.13.1
peberminta@0.10.0
pino@10.3.1
pino-abstract-transport@3.0.0
pino-std-serializers@7.1.0
process-warning@5.1.1
punycode.js@2.3.1
quick-format-unescaped@4.0.4
real-require@0.2.0
safe-stable-stringify@2.5.0
selderee@0.12.0
smtp-server@3.21.3
sonic-boom@4.2.1
thread-stream@4.2.0
thread-stream/real-require -> real-require@1.0.0
tlds@1.261.0
uc.micro@2.1.0
```

The existing root `dom-serializer` resolution changes `3.1.1` to `2.0.0`
(`MAIL:bun.lock:1322`); its `dom-serializer/entities` alias changes `8.0.0` to `4.5.0`
(`MAIL:bun.lock:2400`). The new `domutils/dom-serializer` alias retains a `3.1.1`
resolution. This is graph reshaping, not evidence that every consumer was downgraded.
Representative new boundaries are `imapflow` at line 1520, `mailparser` at 1682,
`smtp-server` at 2032, and nested parser aliases at 2704 in that lock.

SHA-256 of exact inspected files:

| Anchor | `package.json` | `bun.lock` |
| --- | --- | --- |
| MAIL | `997c4ed2bdebd09f96302beb1bf03c225e30d8bc33a700d90cbbfcbc4487e37e` | `db4036dfbfef40a6d9853f8fac17a3aa2650f745efdf506473b9de69bc4633a2` |
| PLATFORM | `1c05429930084a2192d70c8d141f5634e109a2135cb73c6630bdbedb2276ac7f` | `529a9b6a87d9fc836c45a8e68f0da012ed8a111b0fc60b09a0e5c3c8bfbef0e4` |

The peer's dependency-security document is triage with pending remediation and frozen
install/runtime qualification, not a clean-security attestation
(`MAIL:docs/dependency-security-qualification.md:7`, `:71`, `:90`). Its recorded
unchanged baseline advisory set does not discharge those findings on an integrated graph.

## Shared seams and expected reconciliation

Against common baseline `8539fe8`, forty paths changed on both histories. Twenty-seven
have identical final blobs. The thirteen differing shared paths are `.env.example`,
`package.json`, `bun.lock`, `next.config.ts`, `src/config/env.ts`,
`src/constants/errorIds.ts`, `src/constants/jobNames.ts`, `src/db/schema/index.ts`,
`src/features/i18n/catalog.ts`, `src/server/worker.ts`, and the 0083/0084 snapshots plus
`drizzle/meta/_journal.json`. This identifies source overlap, not a prediction that every
three-way textual merge conflicts. Migration metadata requires structural review regardless.

| Seam | Source evidence and adoption consequence |
| --- | --- |
| Already reconciled safety | Nine of the eleven safety blobs match platform exactly. `next.config.ts` additionally retains workflow/integration message declarations on platform; `src/server/worker.ts` additionally imports/registers workflows. Preserve both additions, the redacted pg-boss observer, and private development diagnostics. Do not replace these files with the older peer versions. |
| Shared config/error/schema registries | MAIL adds `mailEnvShape` and protected `MAIL_INTERNAL_ENDPOINTS` file resolution (`MAIL:src/config/env.ts:5`, `:19`, `:37`), `email.recovery` (`MAIL:src/constants/jobNames.ts:13`) and mail schema exports. Merge additively with platform's Slack/integration/workflow entries. `GUIDE:.env.example:65` documents exact internal-endpoint grants; it does not grant any endpoint itself. |
| Endpoint primitive | `src/features/connections` is MAIL's DNS/address/TLS primitive, not a second connection registry. It uses abortable resolution and explicit internal address policy (`MAIL:src/features/connections/endpointPolicy.ts:37`, `:80`, `:111`). Preserve domain ownership and resolve future generic use through an agreed interface. |
| UI adapters and routes | MAIL replaces the personal email-sync screen with owner-scoped mailbox listing (`MAIL:src/app/(app)/settings/email-sync/page.tsx:18`, `:25`, `:35`). Setup uses the existing settings/Button/Dialog adapters (`MAIL:src/features/email/connections/MailboxConnectionsPanel.tsx:5`). Preserve current integration/workflow surfaces and existing shadcn customizations; source presence does not prove browser/focus/RTL behavior. |
| Localization and regional conventions | MAIL adds `dataConventions` to all three central catalogs and separate mailbox/composer FA/DE/EN dictionaries. Retain platform integration/workflow catalog namespaces and declaration generation. Language, calendar, numbering system, time zone and Iranian money unit remain separate preferences (`MAIL:src/features/i18n/preferences.ts:13`, `:30`, `:46`; `MAIL:src/features/i18n/LocaleProvider.tsx:49`). Also review contact/deal/custom-field/import/phone consumers rather than treating this as an email-only merge. |
| Native authority | HTTP writes resolve a fresh native session; reads resolve current native access (`MAIL:src/features/email/mailConnectionHttpAuth.ts:13`). Proof commit rechecks account/session/MFA/freshness under native locks, consumes a single-use proof, and checks identity/generation (`MAIL:src/features/email/mailConnectionProofContext.ts:25`; `MAIL:src/features/email/mailConnectionCommit.ts:129`, `:156`, `:191`). Future platform delegation cannot fabricate this context from an actor ID, MCP bearer or allow flag. |
| Private mailbox authority | Missing and foreign account IDs return the same ownership denial before credential effects (`MAIL:src/features/email/mailboxOwnership.ts:78`). Runtime credentials remain MAIL-owned, active-owner/account/generation fenced (`MAIL:src/features/email/mailConnectionRuntime.ts:32`, `:108`). Admin connection management grants no private mailbox content bypass. Multi-account adoption must preserve explicit account binding in drafts, attachment download, provider locators, replies and selected sender. |
| Offboarding and maintenance | MAIL adds native lock ordering, Gmail revocation recording, credential erasure and generation/version increments (`MAIL:src/features/auth/management/offboarding.ts:15`, `:40`, `:65`). Auth maintenance prunes proofs and retains remote revocation retries (`MAIL:src/features/auth/management/workers.ts:79`). Reconcile with current auth, rather than restoring older auth files or introducing ambient worker administration. |
| One worker stack | Platform registers workflow jobs in the central worker (`PLATFORM:src/server/worker.ts:20`, `:29`). MAIL extends its existing email registrations with the recovery queue and startup recovery (`MAIL:src/features/email/workerJobs.ts:100`). Keep these in one pg-boss stack; no new queue service or workflow engine is implied. |
| Domain recovery vs future EVT | MAIL recovers bounded sync/send candidates using existing attempts, receipts and account authority (`MAIL:src/features/email/mailJobRecovery.ts:22`, `:49`). `boss.send` is a separate call inside the domain DB transaction (`:27`, `:81`), not a transaction-bound canonical event admission API. Queue failure/rollback/ack and repeated recovery still need integrated crash evidence. Existing domain recovery does not implement the reviewed shared EVT outbox. |
| Realtime | `email_mailbox_changed` carries an account ID and invalidates inbox/thread queries (`MAIL:src/server/ws/payload.ts:68`; `MAIL:src/features/email/useInboxRealtime.ts:48`). Keep NOTIFY/WebSocket invalidation separate from durable shared events and effect completion. |

### Relationship to copy patch 4099c9f

There is **no direct path overlap** between the MAIL history and the six paths in
`4099c9f`: `ConnectionOverview.tsx`, two integration tests and the three integration
message dictionaries. Preserve its “saved connections”, “access check passed”, immediate
local disconnect/possible remote-revoke retry and explicitly planned marketplace language.
Those statements must not regress during UI reconciliation.

There is a semantic integration gap despite the absence of a textual conflict. The platform
hub currently takes one mailbox status and counts at most one mailbox
(`PLATFORM:src/features/integrations/IntegrationHub.tsx:29`, `:86`;
`PLATFORM:src/features/integrations/ConnectionOverview.tsx:15`, `:25`). Its catalog still
lists Gmail (`PLATFORM:src/features/integrations/catalog.ts:16`), while MAIL adds multiple
personal mailboxes and a deterministic default. MAIL's backward-compatible
`getActorMailboxStatus` returns a default/first account (`MAIL:src/features/email/mailboxOwnership.ts:44`).
Blind adoption could therefore present a non-Gmail default under Gmail copy and undercount
mailbox records. Define whether the hub projects a mailbox family or individual accounts,
then qualify provider labels, counts, status reasons, links and FA/DE/EN copy. Do not label
all saved accounts healthy or provider-validated. This is a later source change, not fixed here.

## Submission certainty and ownership boundaries

The MAIL attempt/outbox remains the single sender. Its SMTP path prepares attachment/MIME
artifacts and a semantic fingerprint, stamps through `beforeSubmission`, then distinguishes
retry-safe rejection from uncertainty and accepted/partial recipients
(`MAIL:src/features/email/smtpOutboxSubmit.ts:18`, `:53`, `:61`, `:69`, `:93`).
The transport treats failures after sending as uncertain unless a definite SMTP rejection
is established (`MAIL:src/features/email/providers/smtpWire.ts:12`).

Accepted or partial receipts route to copy repair; unknown or already-started attempts
remain pending or require review, rather than starting another submission
(`MAIL:src/features/email/smtpOutbox.ts:14`, `:35`). Accepted submission is not recipient
delivery or reading. Partial acceptance is not complete success. Sent-copy/CRM repair is
not another SMTP send. Cancellation, reconnect, generation replacement or queue retry
must not clear these holds. A future shared effect must bind uniquely to the same MAIL
attempt and preserve its immutable intent, receipt and native authority.

The follow-up at `SEND:src/features/email/sendFailureOutcome.ts:34` preserves a currently
claimed pending receipt before classifying a started attempt for review. Its fallback
update requires no start stamp and no claim (`:49`). Omitting this one-file follow-up
would drop an explicitly identified in-flight status correction. The accompanying
MAIL progress record reports scoped native TLS/real-PostgreSQL checkpoints and local
GreenMail/native-auth browser evidence, while retaining consolidated, browser, migration,
restore and external-provider gaps. These are peer-reported evidence boundaries; this
audit did not rerun or independently qualify them.

Canonical CONN identities/lifecycle/grant intersection/broker and EVT mutation outbox,
workflow admission and shared delivery binding remain reviewed **design contracts**.
The implemented seven-operation provider runner is not a scheduler, credential store or
SMTP sender (`PLATFORM:src/features/integrations/providers/contract.ts:25`). Do not encode
MAIL passwords as OAuth Bearer candidates, copy credentials into another store, or claim
the proposed hooks already exist. Current MAIL `gmail`/`imap_smtp` identities, account
UUIDs, generation fences and domain-private policy remain authoritative.

## Migration boundary

The common journal entries 0 through 82 and all 162 historical SQL/snapshot blobs present
through that boundary were compared and are identical. The common 0082 snapshot SHA-256
is `3b26d54e4602737812ca9af0637e812df9b5d7cf198f34e2c78cd28f979dd54a`.
MAIL local migrations cannot be copied over platform 0083/0084:

| Immutable local MAIL SQL | Material delta | Reserved integrated slot |
| --- | --- | --- |
| `0083_natural_deathstrike.sql:1` | Removes one-account-per-owner constraint; adds provider/default/pause/generation/credential/config/history/capability fields and backfills defaults. | 0085 |
| `0084_military_loki.sql:1` | Encrypted session-bound check proofs and account identity uniqueness. | 0086 |
| `0085_cooing_night_nurse.sql:1` | Folders/locators, nullable legacy Gmail IDs, provider identity/certainty fields, same-account foreign keys, Gmail identity/generation backfills. | 0087 |
| `0086_early_tomas.sql:1` | `payload_prepared` with legacy default true. | 0088 |
| `0087_cool_stryfe.sql:1` | Draft Bcc, attachment snapshot, stable send intent and tracking intent. | 0089 |
| `0088_skinny_slyde.sql:1` | Explicit remote-trash timestamp. | 0090 |

All SQL references in the table belong to MAIL's `drizzle/` directory. Integrated 0091
is reserved for the separate locator sourceFingerprint extension; it is not established
by these six SQL files. Integrated 0092 is reserved exclusively for MAIL delivery
observations, with design/source/DDL/qualification pending. Neither reservation is
implementation evidence. Untracked delivery-report parser files in the peer working tree
are outside these immutable cuts and were not adopted or qualified.

The canonical allocator ledger is `docs/integration-execution/migration-allocation.md`.
After this source inspection, the allocator also reserved 0093 for MAIL notification-purpose
binding. Consult that ledger for the current exclusive range and next unreserved number;
an older handoff's next-slot sentence must not allocate DDL. These reservations supersede
older prose in the immutable peer handoff that treated 0092 as available.
Reports remain untrusted account-scoped observations: an arbitrary Message-ID cannot
authorize association with private outbound content, resend, suppression or workflows.

Preserve platform SQL, snapshots and journal 0..84 byte-for-byte, including integration
and workflow custom safeguards. Merge disjoint cumulative MAIL deltas structurally against
actual common 0082 and platform 0084; stop on common-key conflicts. Generate fresh
snapshot IDs/prevId links and strictly increasing journal timestamps above
`1793452709228`. The six MAIL timestamps are `1793446537651`, `1793447063979`,
`1793448196423`, `1793451580903`, `1793451892308`, `1793452405456`, all earlier than
platform 0084. Renaming files alone would allow Drizzle to skip their upgrade.
Neither an isolated local88 database nor a clean install proves the actual platform84
upgrade. Never rewrite the live MAIL preview's divergent installed history.

## Required later adoption evidence

1. Pin the owner-provided immutable combined candidate and selected source commits,
   record a changed-path/hash manifest and resolve the thirteen shared seams above.
   Preserve already adopted safety/auth/workflows and copy patch 4099c9f. Explicitly
   disposition bundled regional/SMS source without importing additional programme tasks.
2. Reconcile package and lock graphs with the workflow dependency retained. Run frozen
   full/production installs in isolation under pinned Bun; inspect exact runtime/worker
   resolution, licenses/advisories and MIME/HTML sanitization regressions. Existing
   dependency triage is a starting record, not a waived release gate.
3. Review the integrated SQL/snapshot/journal chain, then run real-PostgreSQL clean install,
   actual platform84 upgrade and idempotent rerun. Assert historical hashes, custom workflow
   guards, UUID/ciphertext preservation, Gmail backfills, defaults, account-scoped foreign
   keys, pending/accepted/partial/unknown attempts and native-auth state. Qualify any
   divergent installed history separately with its owner.
4. Execute owned synthetic database dump/fresh restore plus private object/key restoration,
   verifying exact bytes, decryption and authorization. A database-only restore does not
   recover attachment objects or encryption keys. Follow MAIL's rehearsal plan, which at
   this immutable cut explicitly records unexecuted upgrade/restore gates
   (`MAIL:docs/mail-migration-qualification.md:3`, `:45`).
5. Run selected MAIL/native transport, auth/offboarding, Gmail, workflow, connection,
   provider-contract and full integrated regression gates on the final exact head. Include
   abort/revocation during I/O, stale generations, private-account switching, proof replay,
   missing/foreign equivalence, leased pending sends, lost enqueue/ack, recovery duplication,
   partial recipients, lost SMTP acknowledgment and accepted-copy repair without resend.
6. Qualify FA/DE/EN browser journeys using actual native verification, existing adapters,
   keyboard/focus/RTL behavior, multi-mailbox/default sender/draft continuity, honest
   saved/access-checked/healthy/provider-validated labels and independent regional settings.
   Guides describe intended implemented flows but do not establish browser coverage.
7. Record provider/server-specific acceptance separately from source/native/local-server
   evidence. No external credentials, live messages, domains, paid service or deployment
   authority is granted by this audit. Keep remaining MAIL and shared CONN/EVT tasks open
   until their owning acceptance evidence exists and the platform owner accepts adoption.

Decision: the immutable chain is reviewable input for a later controlled adoption. Source,
dependency, metadata and UI projection reconciliation remain necessary. This document
does not accept the mutable combined candidate, close MAIL/CONN/EVT implementation,
change the tracker or authorize another engine, credential store or sender.

Later owner handoff: clean combined candidate `571ba2c` at
`/Users/ali/Developer/warpdrive-mail-platform`, branch `codex/mail-platform-candidate`,
was supplied with `docs/mail-integrated-migration-map.md`. Its source metadata and
platform-0084 upgrade remain independently unqualified by this audit. No candidate source
was adopted here, and later MAIL follow-ups remain separate reviewable work.
