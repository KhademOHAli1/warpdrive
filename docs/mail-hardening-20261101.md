# Local mail hardening checkpoint, 1 November 2026

This is an isolated source checkpoint on `codex/mail-platform-candidate`, not a release or an installed upgrade. The approved P0/P1 email and Iranian-integration goal remains active. Preserve the current UI, Gmail, native authentication, permissions and existing data.

Current follow-up to checkpoint `70bc46b19a8896104eccdc3d944cf4352f849224` contains
private-intake, reader and review work. The
[private-intake qualification record](mail-private-intake-20261101.md) supersedes
the historical pending pre-receipt, notification and reader-wiring statements
below. The current unit return passed 331 cases in 31 files; the broader native
return passed all 399 cases in 72 files. Ordinary database timestamp ordering and
protected-copy owner local-read/sync controls now pass. Current-source browser
workflows, whole-candidate builds, prompt PostgreSQL lock-wait cancellation and
installed-profile admission/restore remain unqualified.

## Behaviors under qualification

- Native IMAP MIME extraction supplies bounded decoded delivery-report parts. Immutable evidence belongs to the actual inbound source message. Public message IDs, report contents and user annotations never establish provider acceptance or change a send outcome.
- Delivery observations and recipient reviews are mailbox-owner-only. Reviews use ordinary full native sessions, current authorization, append-only revisions and exact target snapshots. Target deletion leaves the latest review unavailable instead of reviving an older association.
- The delivery-report HTTP boundary reuses native sessions, CSRF, atomic PostgreSQL rate limiting, streamed-body limits and bounded deadlines. Caller cancellation propagates without leaving an unhandled dispatch promise. No credential-freshness challenge is added to ordinary annotations.
- Notification rendering is frozen in Farsi, German or English on the original eligible mailbox. Opt-out, visibility and recipient changes are checked again immediately before submission. Suppressed intents remain suppressed on replay.
- Gmail notification acceptance requires the actual API ACK bound to the immutable intent. An RFC search match cannot supply that proof. Accepted notifications have separate private, unlinked CRM copies; SMTP notifications do not create a remote Sent APPEND.
- A known Gmail ACK can finish its local copy and notification marker after pause or disconnect without resolving credentials, calling Google or resending. Queue recovery uses the existing notification consumer, which retains the same intent and rechecks current policy.

## Local evidence

The disposable fixtures use real PostgreSQL and local synthetic mail transports or the existing Gmail protocol adapter. No external mailbox, Google account, SMS message, call or financial write is involved.

| Selection                                                                                                | Current result                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery schema, ingest, privacy, review races and target purge                                          | 47 passed across 7 files                                                                                                                |
| Notification binding/admission/contention/isolation/privacy/dispatch/recovery and FA/DE/EN job workflows | 56 passed across 16 files, combining the full selection with the corrected observer recheck                                             |
| Existing ordinary mail queue recovery                                                                    | 3 passed                                                                                                                                |
| Native delivery-review HTTP boundary                                                                     | 17 passed, including the reproduced pre-aborted-request regression                                                                      |
| Native IMAP report hook and existing sync regressions                                                    | 29 passed across 9 files, including report storage/replay and malformed/hint-only controls                                              |
| Distribution context and notices                                                                         | 2 passed; scoped Biome and typed ESLint passed                                                                                          |
| Combined current mail selection                                                                          | 152 passed across 34 files in 39.46 seconds, minimum observed free space 18,606,030,848 bytes                                           |
| Changed-source checks                                                                                    | Strict TypeScript, Biome and typed ESLint passed for 80 selected files; translation audit has zero findings; error-ID registry 5 passed |

The concurrency fixture now clears PostgreSQL's statistics snapshot before enumerating newly opened waiter backends. Its thresholds, timeout, owner-lock ordering, default change and immutable-intent assertions are unchanged. The first failure occurred before the default-change operation started. After the observer correction, all 18 binding/isolation/contention cases passed.

The cancellation regression separately captured an extra unhandled caller AbortError. Checking the combined signal before constructing the dispatch promise fixes the orphan while preserving caller-abort propagation and server-deadline responses.

Scoped source checks are incremental. No current-candidate whole-application build or browser acceptance is claimed by these results. Other chats' builds and test totals belong to their own source cuts.

Static historical-file verification retained all 180 prior SQL/snapshot files, all 92 prior journal entries and the raw journal prefix unchanged. Local92 SQL SHA-256 is `2f0e17fec225d54a39a3c549df63d661d0c67eba9ca155eacefa09cd09291883`; local93 is `58c694455cc4489f903e4f48c1eecdd64dc71071d9d888ad2c6936afc4ea6aa7`. This proves source identity, not an installed upgrade path.

## Resource boundary

The authorized cleanup removed 2,975,203,328 allocated bytes, approximately 2.77 GiB, from three inventoried generated build caches. This number is the removed allocation, not the total change in APFS free space. Owners can regenerate their caches. Source, active previews, private profiles and local databases were preserved.

Native PostgreSQL/S3 campaigns use one assigned lane, finite deadlines and a live 5 GiB free-space floor. Builds and installs have a separately named lane. Completed process groups release their slot before another native campaign starts. The protected existing previews are outside these cleanup and stop scopes.

## Historical gates at the committed checkpoint

Published main was independently verified at `a0490c16a9954d9a03c3bb22bfb69944db433a77`. Its Privacy83..85 lineage differs from this candidate's local history through93. The convergence proposal is unaccepted. Preserve every installed ledger and qualify full-ledger/catalog admission, upgrade, rerun and restore paths before applying a sequence to an installation. See [the migration qualification gate](mail-migration-qualification.md#current-lineage-gate-1-november-2026).

Pre-receipt Gmail sync remains a separate privacy gate: sync may arrive before the API ACK and provider ID are durably stored. The accepted-ID tests do not prove that earlier race safe. See [the specific proposal](../src/features/notifications/email/notificationCrmPrivacy.preReceipt.md). No public header may become acceptance authority as part of a fix.

The observation panel still needs its reader wiring and actual native browser workflow acceptance in Farsi, German and English. Main-source/UI convergence, migration and object/key restore, external provider qualification, shared CONN/EVT runtime adoption and the remaining approved Iranian integrations also remain open. Local test fixtures and source compilation cannot replace those gates.
