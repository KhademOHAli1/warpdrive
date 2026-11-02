# Private mail intake qualification

This is work in progress on `codex/mail-platform-candidate`, after local checkpoint
`70bc46b19a8896104eccdc3d944cf4352f849224`. It is not a main-branch, installed-profile,
browser-acceptance or release result.

## Problem reproduced

Actual Gmail sending can expose the remote notification to mailbox sync before
the send engine receives its API acknowledgement. Ordinary sync previously
inserted that notification into the provider's customer conversation. The same
public Message-ID cannot authorize association, acceptance or retry. An SMTP
notification delivered back to INBOX also previously acquired CRM links.

Two Farsi/German pre-receipt cases and five lost-receipt, copied-header, collision,
edited-content and SMTP self-delivery controls failed on these behaviors. The
records are `/tmp/warpdrive-mail-pre-receipt-red.log` and
`/tmp/warpdrive-mail-intake-privacy-controls-red.log`.

## Intended boundary

An untrusted hint can restrict treatment to a separate private copy. The ledger
records the actual opaque provider identity; the provisional message and thread
use an application-owned `private-intake:<UUID>` identity with no Gmail identity
or message fingerprint. Ordinary messages in the same batch must continue.

Only an exact canonical Gmail API acknowledgement may promote an unchanged,
exclusive owned copy. Promotion preserves local message/thread UUIDs, checks
immutable versioned baselines and conflicting provider identities, and establishes
the existing `notification:<attempt UUID>` thread identity. A colliding, linked,
shared or edited row must not be overwritten, reparented or adopted.

Local keep-private, dismiss and restore decisions are separate append-only
reviews. They cannot establish delivery, mark a notification sent, resend, unlock
reply, sharing or remote mailbox writes. Parent-copy deletion must clear duplicated
payload and preserve a minimal replay tombstone. Account deletion removes the
ledger and reviews through their real parent relationships.

## Candidate migration boundary

The integration programme reserved candidate-local migration `0094` for MAIL.
This is not a global number allocation or permission to apply to an installed
profile. The existing proposal for profile 93 rejects unknown 94.

The composed candidate migration contains two tables, pointer-only `SET NULL`
foreign keys, five versioned canonicalization functions and reviewed SQL-only
transition/history guards. Its SHA-256 is
`402ed79e5dd1aa466620b07cf3715ebb70f8bc975f1b2b46e0bc570a7f573d93`.
All 184 preceding SQL and snapshot files are unchanged; the journal retains its
old prefix and appends entry 94. This is still a local candidate, not an immutable
published profile admission or installed upgrade.

## Actual database evidence

The bounded native run on 1 November executed 21 schema/kernel cases:

- All 13 canonicalization cases passed, including time zone and DateStyle
  independence, microseconds, unrelated future columns, attachment ordering and
  rejection of cross-account metadata.
- Three schema cases passed. Five actual behavioral cases failed because the
  custom immutable-history, evidence and parent-cleanup guards were absent.

The initial receipt is `/tmp/warpdrive-mail-private-kernel-schema.log`. Subsequent
tests reproduced eight additional guard failures, eight actual mutation/capability
failures, missing reader projections and held Gmail attachment access. Their fixes
were then exercised against real PostgreSQL.

The separate detached delivery-report run passed 87 of 88 cases. The remaining
case exposed two submitted attempts claiming one Gmail copy. The source fix now
checks competing eligible attempts independently of the caller's ID filter. The
rerun passed all 88 cases in `/tmp/warpdrive-mail-detached-domain-green.log`.

The latest private-intake return passed all 77 cases across 13 files:

- 29 schema, canonicalization and guard cases.
- 36 mutation, final submission, remote-write, attachment and reader-DTO cases.
- 12 Gmail pre-receipt, IMAP replay/provenance and transaction-isolation cases.

The three receipts are
`/tmp/warpdrive-mail-private-guard-kernel-green-return2.log`,
`/tmp/warpdrive-mail-private-policy-reader-green-return2.log` and
`/tmp/warpdrive-mail-private-imap-isolation-return2.log`.
The campaign completed in 20.23 seconds, with 321 selected inputs unchanged and
no watchdog stop. Its minimum available space was 15,197,683,712 bytes; its owned
process group ended and the three pre-existing Docker containers were unchanged.

The actual RR-default regression first reproduced promotion after a concurrent
attachment insert. The copy transaction now explicitly uses READ COMMITTED; the
same test passes without changing its contention barrier or oracle. IMAP tests
also reproduced rebinding new bytes to an old private copy and attaching a new
DSN part to that old source. Both fixes preserve the original retained source.

Browser-only delivery transport passed 57 cases. Reader delivery-report wiring
passed 118 component/hook cases (49 new and 69 existing), and the isolated private
review panel passed 36 cases. These include Farsi, German and English. Scoped
types, Biome and typed ESLint passed for those sources; browser acceptance remains
separate.

The ordinary IMAP one-connection-pool case reproduced a nested checkout deadlock.
The final mutation check now uses the existing READ COMMITTED transaction and
does not borrow a second connection. That case and the five private dispatch
controls passed together in `/tmp/warpdrive-mail-pool-dispatch-green.log`.

The native private read/review service passed 19 cases after actual failing
authority, revision, lifecycle and contention cases. It holds the current native
session and account authority through commit, returns only the five-field summary,
and rolls back the revision if history insertion fails. The receipt is
`/tmp/warpdrive-mail-private-review-native-green.log`.

The strict HTTP boundary passed all 14 native cases in
`/tmp/warpdrive-mail-private-http-native-green.log`, including existing-session
authority, CSRF, bounded request bodies, cancellation and finite error responses.
These checks do not establish browser acceptance or permission to contact a
provider. The separate browser transport passed 56 unit cases in
`/tmp/warpdrive-private-intake-transport-final-green.log`.

Private-intake row, bulk-selection, workspace and sidebar controls passed 107
component cases across 15 files using the pinned Bun 1.4.4 runtime. This includes
45 current regression/control cases and 62 existing cases. Protected copies keep
a readable private indicator and cannot be shared or archived through the row;
mixed protected or disappeared selections cannot submit a bulk action. Ordinary
owners retain local linking and archiving when sending is unavailable. The
receipt is `/tmp/warpdrive-mail-private-affordance-green.log`; its 26 selected
inputs remained unchanged during the run.

The first affordance run recorded 28 real behavior failures and six selection
fixture errors. Correcting only the six fixtures' selection events, then fixing
the reproduced row, workspace and sidebar failures, left three real bulk-archive
failures. Those passed after the bulk policy fix. Both RED receipts are retained
as `/tmp/warpdrive-mail-private-affordance-red.log` and
`/tmp/warpdrive-mail-private-affordance-behavior-red.log`. At that point, final
scoped static checks and actual browser acceptance were still pending.

The subsequent combined UI return passed all 293 cases in 30 distinct files under
Bun 1.4.4, including the earlier 107-case selection. It preserves a private review
entry when a valid parent-message purge leaves a surviving thread without cards,
and uses provider send-acknowledgement wording for confirmed copies rather than
claiming that their ordinary controls remain restricted. Farsi, German and English
cover these cases. Strict TypeScript over 45 selected sources, typed ESLint over
27 changed sources and formatting checks passed. The 48 post-format inputs were
unchanged during the final 23.36-second unit run. Receipts:
`/tmp/warpdrive-mail-private-combined-static-return2.log` and
`/tmp/warpdrive-mail-private-combined-unit-return2-green.log`.

The eight owner projection cases passed. Twelve additional native surface cases
then reproduced seven actual failures in Search, Sent, Archive and the current
workspace feed; five controls passed. Their common batched projection and workspace
capability fixes now pass all twelve cases, including purged metadata, current
owner decisions, foreign-user denial and ordinary paused-mailbox behavior. The
final native receipt is `/tmp/warpdrive-mail-private-projection-surfaces-green.log`.
The candidate-wide translation audit also reports zero catalog issues and zero
new source findings in `/tmp/warpdrive-mail-private-i18n-final.log`.

## Remaining qualification

The first broader native return passed 378 of 379 cases. Its ordinary fresh-thread
read marker failure led to three deterministic database regressions: the provider
timestamp can lead the application clock, and an existing later read marker must
not move backwards. All three failed before the database-watermark fix. The
ordinary 13-case read selection then passed.

Fourteen further native cases reproduced eight local-read and sync failures, with
six controls passing. Held Gmail and IMAP copies now let only their current,
active, non-invited owner change the local read marker. This does not resolve
credentials, send a remote command or change the private ledger. Current user,
mailbox, thread and ledger locks remain held through commit. Remote IMAP flags
and source replay preserve the owner's local choice. Ordinary IMAP read/unread
still exercises the real remote STORE path.

The localized UI RED reproduced 15 failures with 57 controls passing. One shared
policy now enables the owner's local read action in the reader and bulk controls,
while keeping archive, sharing and remote writes restricted. The final unit return
passed 331 cases in 31 files, including Farsi, German, English and the 17 strict
schema cases. Receipt: `/tmp/warpdrive-mail-local-read-combined-unit-20261101-green.log`.
Only two integration-fixture helpers changed afterward; neither is imported by
these unit tests. Their typed timestamp projection retains exact microseconds
alongside JavaScript Dates instead of asserting Dates on raw PostgreSQL strings.

The final broader native return passed all 399 cases in 72 files under Bun 1.4.4.
It completed in 77.51 seconds, with all 798 selected inputs unchanged, no watchdog
stop, no surviving owned process group and the same three baseline containers.
Minimum available space was 16,996,171,776 bytes. Receipt:
`/tmp/warpdrive-mail-qualified-regression-local-read-20261101-green-r2.log`.
Formatting and typed ESLint passed for 19 changed sources; strict TypeScript passed
over 59 selected sources. All 62 post-format inputs remain unchanged. The fresh
translation audit reports zero catalog issues and zero new source findings.

1. Run whole-candidate application and worker builds, then visually inspect the
   frozen current source and complete owner/denied-user FA/DE/EN workflows in an
   isolated controlled-server browser profile.
2. Qualify prompt cancellation during PostgreSQL row-lock waits. Current commit
   fences prove authority safety; post-await signal checks do not prove prompt
   cancellation while a query is blocked. No lock-wait cancellation claim is made.
3. Publish an immutable migration cut and implement compatible installed-profile
   admission routes in both migration entry points; qualify upgrade and restore.

No external mailbox, message send, provider operation or installed migration is
qualified by these synthetic tests.
